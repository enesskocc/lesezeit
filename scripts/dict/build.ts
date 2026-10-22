// Dictionary importer. Run once on the PC:  npm run dict:build
//
// Downloads (cached outside OneDrive, ~420 MB):
//   de.wiktionary extract  — grammar, German definitions, Turkish translations, synonyms, family
//   en.wiktionary German   — English glosses, full inflection tables, Rektion hints
//   OpenSubtitles 2018 frequency list (hermitdave/FrequencyWords) — frequency ranks
// Writes public/dict/{manifest.json, forms/*.json, lemmas/*.json}.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { lemmaId, normalizeKey, shardFile, type LemmaEntry, type Manifest, type PosCode } from '../../shared/dict.ts';
import {
  buildShards,
  candidateForms,
  extractDe,
  extractEn,
  isFormOfEntry,
  isKeptLemma,
  keepForm,
  mergeLemma,
  posCode,
  rankLemmas,
  type RawEntry,
} from './lib.ts';

const SHARD_LIMIT = 250_000; // bytes, spec: "under about 300 KB"
const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'public', 'dict');
const CACHE = process.env.LESEZEIT_DICT_CACHE ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'lesezeit-dict-cache');

// CC BY-SA 4.0 requires the notice to travel with the redistributed data.
const LICENSE_TEXT = `# Lesezeit dictionary data

These JSON files are derived from Wiktionary and are licensed under the
Creative Commons Attribution-ShareAlike 4.0 International License
(https://creativecommons.org/licenses/by-sa/4.0/).

Sources:
- German Wiktionary (https://de.wiktionary.org) and English Wiktionary (https://en.wiktionary.org),
  © Wiktionary contributors, extracted by kaikki.org / wiktextract (Tatu Ylonen).
- Frequency ranks computed from FrequencyWords by Hermit Dave
  (https://github.com/hermitdave/FrequencyWords), OpenSubtitles 2018, CC BY-SA 4.0.

Changes: entries were filtered, shortened, merged across both Wiktionaries, re-structured
into lemma and inflected-form shards, and given frequency ranks. Built {date}
by scripts/dict/build.ts in https://github.com/enesskocc/lesezeit.
`;

const SOURCES = {
  de: { file: 'de-extract.jsonl.gz', url: 'https://kaikki.org/dictionary/downloads/de/de-extract.jsonl.gz' },
  en: { file: 'en-de.jsonl.gz', url: 'https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz' },
  freq: { file: 'de_full.txt', url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_full.txt' },
};

async function ensure({ file, url }: { file: string; url: string }): Promise<string> {
  const target = path.join(CACHE, file);
  if (existsSync(target)) return target;
  await fs.mkdir(CACHE, { recursive: true });
  console.log(`Downloading ${url} …`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${url} (HTTP ${res.status})`);
  const tmp = `${target}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  await fs.rename(tmp, target);
  return target;
}

// JSONL lines split on "\n" only. node:readline also breaks on a bare "\r" and on U+2028,
// which appear inside Wiktionary example sentences and would cut a JSON object in half.
async function* lines(file: string): AsyncGenerator<string> {
  const input = file.endsWith('.gz') ? createReadStream(file).pipe(createGunzip()) : createReadStream(file);
  input.setEncoding('utf8');
  let rest = '';
  for await (const chunk of input as AsyncIterable<string>) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop()!;
    for (const p of parts) if (p.trim()) yield p.replace(/\r$/, '');
  }
  if (rest.trim()) yield rest.replace(/\r$/, '');
}

interface Pending {
  w: string;
  p: PosCode;
  de?: Partial<LemmaEntry>;
  en?: Partial<LemmaEntry>;
  forms: Set<string>;
}

/** Entries that describe the same word sense group: keep first scalars, union arrays. */
function combine(a: Partial<LemmaEntry> | undefined, b: Partial<LemmaEntry>): Partial<LemmaEntry> {
  if (!a) return b;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    if (cur === undefined) out[k] = v;
    else if (Array.isArray(cur) && Array.isArray(v)) out[k] = [...new Set([...cur, ...v])].slice(0, 8);
  }
  return out as Partial<LemmaEntry>;
}

async function main() {
  const t0 = Date.now();
  const files = { de: await ensure(SOURCES.de), en: await ensure(SOURCES.en), freq: await ensure(SOURCES.freq) };

  // "w:p" → buckets. Nouns get one bucket per gender/plural, so homographs such as
  // die Steuer (tax) / das Steuer (wheel) or Bank/Bänke / Bank/Banken stay separate.
  const pending = new Map<string, Pending[]>();
  const formOf: { key: string; base: string }[] = [];
  const bucketFor = (base: string, w: string, p: PosCode, x: Partial<LemmaEntry>, source: 'de' | 'en'): Pending => {
    let buckets = pending.get(base);
    if (!buckets) pending.set(base, (buckets = []));
    const facts = (b: Pending) => ({ g: b.de?.g ?? b.en?.g, pl: b.de?.pl ?? b.en?.pl });
    let hit: Pending | undefined;
    if (p !== 'n') hit = buckets[0];
    else {
      hit = buckets.find((b) => facts(b).g === x.g && facts(b).pl === x.pl); // exact gender + plural
      const sameGender = buckets.filter((b) => facts(b).g === x.g);
      if (!hit && x.g && sameGender.length === 1 && (!x.pl || !facts(sameGender[0]!).pl)) hit = sameGender[0];
      if (!hit && !x.g) hit = buckets[0]; // unknown gender: attach to the main entry
      // en sometimes spells a plural differently; de entries with another plural are real homographs.
      if (!hit && source === 'en' && x.g && sameGender.length === 1) hit = sameGender[0];
    }
    if (!hit) buckets.push((hit = { w, p, forms: new Set() }));
    return hit;
  };

  for (const source of ['de', 'en'] as const) {
    let n = 0;
    for await (const line of lines(files[source])) {
      if (++n % 200_000 === 0) console.log(`  ${source}: ${n.toLocaleString('de-DE')} lines`);
      const e = JSON.parse(line) as RawEntry;
      if (e.lang_code !== 'de') continue;
      const p = posCode(e.pos);
      if (!p) continue;
      if (isKeptLemma(e)) {
        const x = source === 'de' ? extractDe(e) : extractEn(e);
        const rec = bucketFor(lemmaId({ w: e.word, p }), e.word, p, x, source);
        rec[source] = combine(rec[source], x);
        for (const f of candidateForms(e)) rec.forms.add(f);
      } else if (isFormOfEntry(e) && !/\s/.test(e.word)) {
        for (const s of e.senses ?? [])
          for (const t of s.form_of ?? []) formOf.push({ key: normalizeKey(e.word), base: lemmaId({ w: t.word, p }) });
      }
    }
  }
  console.log(`Read sources: ${pending.size.toLocaleString('de-DE')} lemmas (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  // Merge sources → final entries; build form → ids index.
  const entries = new Map<string, LemmaEntry>();
  const forms = new Map<string, Set<string>>();
  const addForm = (key: string, id: string) => {
    let s = forms.get(key);
    if (!s) forms.set(key, (s = new Set()));
    s.add(id);
  };
  const idsByBase = new Map<string, string[]>();
  for (const [base, buckets] of pending) {
    buckets.forEach((rec, i) => {
      const entry = mergeLemma(rec.w, rec.p, rec.de ?? {}, rec.en ?? {});
      if (buckets.length > 1) entry.h = i + 1;
      const id = lemmaId(entry);
      entries.set(id, entry);
      idsByBase.set(base, [...(idsByBase.get(base) ?? []), id]);
      const own = normalizeKey(rec.w);
      for (const f of rec.forms) if (f !== own && keepForm(f, entry.sep)) addForm(f, id);
    });
  }
  for (const { key, base } of formOf) {
    for (const id of idsByBase.get(base) ?? []) if (key !== normalizeKey(entries.get(id)!.w)) addForm(key, id);
  }
  const homographs = [...pending.values()].filter((b) => b.length > 1).length;
  console.log(`Noun homographs split: ${homographs.toLocaleString('de-DE')}`);

  // Frequency ranks.
  const byLemmaKey = new Map<string, string[]>();
  for (const [id, e] of entries) {
    const k = normalizeKey(e.w);
    byLemmaKey.set(k, [...(byLemmaKey.get(k) ?? []), id]);
  }
  const freq: [string, number][] = [];
  for await (const line of lines(files.freq)) {
    const m = line.match(/^(\S+) (\d+)$/);
    if (m) freq.push([m[1]!, Number(m[2])]);
  }
  const ranks = rankLemmas(freq, (k) => [...(byLemmaKey.get(k) ?? []), ...(forms.get(k) ?? [])]);
  for (const [id, rank] of ranks) entries.get(id)!.rank = rank;

  // Turkish meanings Claude wrote where de.wiktionary has none (scripts/dict/translate-tr.ts).
  const TR_FILE = path.join(ROOT, 'scripts', 'dict', 'tr-claude.json');
  if (existsSync(TR_FILE)) {
    const extra = (JSON.parse(await fs.readFile(TR_FILE, 'utf8')) as { tr: Record<string, string[]> }).tr;
    let added = 0;
    for (const [id, tr] of Object.entries(extra)) {
      const e = entries.get(id);
      if (!e || e.tr?.length || !tr.length) continue;
      e.tr = tr;
      e.trAi = true;
      added++;
    }
    console.log(`Turkish meanings from Claude: ${added.toLocaleString('de-DE')}`);
  }

  // Shard maps.
  const byRank = (a: string, b: string) => (entries.get(a)?.rank ?? Infinity) - (entries.get(b)?.rank ?? Infinity);
  const lemmaMap = new Map<string, LemmaEntry[]>();
  for (const [k, ids] of byLemmaKey) lemmaMap.set(k, ids.sort(byRank).map((id) => entries.get(id)!));
  const formMap = new Map<string, string[]>();
  for (const [k, ids] of forms) formMap.set(k, [...ids].sort(byRank));

  const lemmaShards = buildShards(lemmaMap, SHARD_LIMIT);
  const formShards = buildShards(formMap, SHARD_LIMIT);

  // Write into a temp folder first, then swap it in: an EBUSY from OneDrive or a dev server
  // halfway through must never leave public/dict half-deleted.
  const TMP = `${OUT}.tmp`;
  await fs.rm(TMP, { recursive: true, force: true, maxRetries: 5 });
  let bytes = 0;
  let largest = { name: '', size: 0 };
  const hashes: Record<'lemmas' | 'forms', Record<string, string>> = { lemmas: {}, forms: {} };
  for (const [kind, shards] of [['lemmas', lemmaShards], ['forms', formShards]] as const) {
    await fs.mkdir(path.join(TMP, kind), { recursive: true });
    for (const prefix of [...shards.keys()].sort()) {
      const json = JSON.stringify(shards.get(prefix));
      const size = Buffer.byteLength(json);
      bytes += size;
      if (size > largest.size) largest = { name: `${kind}/${prefix}`, size };
      hashes[kind][prefix] = createHash('sha1').update(json).digest('hex').slice(0, 10);
      await fs.writeFile(path.join(TMP, kind, `${shardFile(prefix)}.json`), json);
    }
  }
  const manifest: Manifest = {
    version: 2,
    builtAt: new Date().toISOString(),
    sources: [
      'de.wiktionary.org via kaikki.org (CC BY-SA 4.0)',
      'en.wiktionary.org via kaikki.org (CC BY-SA 4.0)',
      'FrequencyWords, OpenSubtitles 2018 (CC BY-SA 4.0)',
    ],
    counts: { lemmas: entries.size, forms: formMap.size },
    forms: hashes.forms,
    lemmas: hashes.lemmas,
  };
  await fs.writeFile(path.join(TMP, 'manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(TMP, 'LICENSE.md'), LICENSE_TEXT.replace('{date}', manifest.builtAt.slice(0, 10)));
  await fs.rm(OUT, { recursive: true, force: true, maxRetries: 5 });
  await fs.rename(TMP, OUT);

  console.log(`\nLemmas: ${entries.size.toLocaleString('de-DE')} · forms: ${formMap.size.toLocaleString('de-DE')}`);
  console.log(`Shards: ${lemmaShards.size} lemma + ${formShards.size} form · total ${(bytes / 1e6).toFixed(1)} MB`);
  console.log(`Largest shard: ${largest.name} ${(largest.size / 1000).toFixed(0)} KB`);
  for (const probe of ['fing', 'häusern', 'angefangen']) {
    console.log(`  ${probe} → ${[...(forms.get(probe) ?? [])].join(', ') || '(not found)'}`);
  }
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

await main();
