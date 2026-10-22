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

/** Edit distance, giving up early once it is certainly above `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...next) > max) return max + 1;
    row = next;
  }
  return row[b.length]!;
}

/**
 * Words to offer when a query found nothing (2026-10-23, Enes: "vorbeikommen" not found on the
 * iPhone although the dictionary has it). First the query without spaces — a keyboard suggestion can
 * split "vorbei kommen" — then lemmas of the same shard that start like it or are one or two letters
 * off; more frequent words first.
 */
export async function suggest(query: string, max = 6): Promise<string[]> {
  const key = normalizeKey(query);
  if (!key) return [];
  const m = await loadManifest();
  const joined = key.replace(/ /g, '');
  const found: { d: number; e: LemmaEntry }[] = [];
  if (joined !== key) for (const h of await lookupWith(m, joined)) found.push({ d: -1, e: h.entry });
  const prefix = shardFor(joined, m.lemmas);
  if (prefix) {
    const shard = (await loadShard('lemmas', prefix, m.manifest.lemmas[prefix]!)) as Record<string, LemmaEntry[]>;
    for (const [k, entries] of Object.entries(shard)) {
      const d = k.startsWith(joined) && k.length - joined.length <= 4 ? 0.5 : distance(k, joined, 2);
      if (d <= 2) for (const e of entries) found.push({ d, e });
    }
  }
  found.sort((a, b) => a.d - b.d || (a.e.rank ?? Infinity) - (b.e.rank ?? Infinity));
  return [...new Set(found.map((f) => f.e.w))].filter((w) => normalizeKey(w) !== key).slice(0, max);
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
