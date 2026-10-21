import {
  FormShardSchema,
  LemmaShardSchema,
  ManifestSchema,
  lemmaId,
  normalizeKey,
  parseLemmaId,
  shardFile,
  shardFor,
  type LemmaEntry,
  type Manifest,
} from '../../shared/dict';

// Dictionary shards are static files on Pages (public/dict). Loaded shards stay in memory;
// the service worker also keeps them (runtime cache), so looked-up words work offline.
const DICT_URL = `${import.meta.env.BASE_URL}dict/`;
// A home-screen app can stay open for days; re-read the manifest now and then so a new
// dictionary build is noticed (shards are re-split on every build).
const MANIFEST_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface LookupHit {
  entry: LemmaEntry;
  /** "lemma" when the query is the dictionary form itself, "form" for an inflected form. */
  via: 'lemma' | 'form';
}

class MissingShardError extends Error {}

async function fetchJson(path: string, cache: RequestCache = 'default'): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${DICT_URL}${path}`, { cache });
  } catch {
    throw new Error('Sözlük dosyası yüklenemedi. İnternet bağlantını kontrol et.');
  }
  if (res.status === 404) throw new MissingShardError(`Sözlük dosyası bulunamadı (${path}).`);
  if (!res.ok) throw new Error(`Sözlük dosyası yüklenemedi (${path}, HTTP ${res.status}).`);
  return res.json();
}

interface LoadedManifest {
  manifest: Manifest;
  forms: Set<string>;
  lemmas: Set<string>;
  loadedAt: number;
}
let manifestPromise: Promise<LoadedManifest> | null = null;

function loadManifest(forceReload = false): Promise<LoadedManifest> {
  if (forceReload) manifestPromise = null;
  manifestPromise ??= fetchJson('manifest.json', 'no-cache')
    .then((raw) => {
      const manifest = ManifestSchema.parse(raw);
      return {
        manifest,
        forms: new Set(Object.keys(manifest.forms)),
        lemmas: new Set(Object.keys(manifest.lemmas)),
        loadedAt: Date.now(),
      };
    })
    .catch((e: unknown) => {
      manifestPromise = null; // allow a retry after a network error
      throw e;
    });
  return manifestPromise;
}

// Keyed by URL, which contains the shard's content hash: a rebuilt shard is a new entry.
const shardCache = new Map<string, Promise<Record<string, unknown[]>>>();

function loadShard(kind: 'forms' | 'lemmas', prefix: string, hash: string) {
  const url = `${kind}/${shardFile(prefix)}.json?v=${hash}`;
  let p = shardCache.get(url);
  if (!p) {
    const schema = kind === 'forms' ? FormShardSchema : LemmaShardSchema;
    p = fetchJson(url)
      .then((raw) => schema.parse(raw) as Record<string, unknown[]>)
      .catch((e: unknown) => {
        shardCache.delete(url);
        throw e;
      });
    shardCache.set(url, p);
  }
  return p;
}

/** Own-property read: keys like "constructor" or "__proto__" must not hit Object.prototype. */
function own<T>(obj: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

async function shardValue<T>(m: LoadedManifest, kind: 'forms' | 'lemmas', key: string): Promise<T[]> {
  const prefix = shardFor(key, m[kind]);
  if (!prefix) return [];
  const shard = await loadShard(kind, prefix, m.manifest[kind][prefix]!);
  return (own(shard, key) as T[] | undefined) ?? [];
}

async function lookupWith(m: LoadedManifest, query: string): Promise<LookupHit[]> {
  const key = normalizeKey(query);
  const direct = await shardValue<LemmaEntry>(m, 'lemmas', key);
  const hits: LookupHit[] = direct.map((entry) => ({ entry, via: 'lemma' }));

  for (const id of await shardValue<string>(m, 'forms', key)) {
    const { w } = parseLemmaId(id);
    const entry = (await shardValue<LemmaEntry>(m, 'lemmas', normalizeKey(w))).find((e) => lemmaId(e) === id);
    if (entry && !hits.some((h) => h.entry === entry)) hits.push({ entry, via: 'form' });
  }

  const typed = query.normalize('NFC').trim();
  const score = (h: LookupHit) => (h.via === 'lemma' ? 0 : 2) + (h.via === 'lemma' && h.entry.w !== typed ? 1 : 0);
  return hits.sort((a, b) => score(a) - score(b) || (a.entry.rank ?? Infinity) - (b.entry.rank ?? Infinity));
}

/**
 * form → lemma → grammar data. "Häusern" → Haus, "fing" → fangen, "angefangen" → anfangen.
 * Exact dictionary forms come first (same capitalisation before other), then inflected-form
 * matches; within each group more frequent lemmas first.
 */
export async function lookup(query: string): Promise<LookupHit[]> {
  if (!normalizeKey(query)) return [];
  let m = await loadManifest();
  if (Date.now() - m.loadedAt > MANIFEST_MAX_AGE_MS) m = await loadManifest(true).catch(() => m);
  try {
    return await lookupWith(m, query);
  } catch (e) {
    // The dictionary was rebuilt since the manifest was loaded: shard names changed.
    if (!(e instanceof MissingShardError)) throw e;
    return lookupWith(await loadManifest(true), query);
  }
}
