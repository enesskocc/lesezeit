// Dictionary format shared by the importer (scripts/dict), the app (src/lib/dict.ts)
// and the pipeline (milestone 3+). Files live in public/dict/ and are served by Pages.
//
//   manifest.json            shard prefixes → content hash
//   forms/<file>.json        { "häusern": ["Haus:n"] }      inflected form → lemma ids
//   lemmas/<file>.json       { "haus": [LemmaEntry, …] }      lemma key → entries
//
// A lemma id is "<lemma>:<pos code>", plus ":<h>" for noun homographs that differ in
// gender or plural: "Haus:n", "anfangen:v", "Steuer:n:1" (die Steuer), "Steuer:n:2" (das Steuer).
import { z } from 'zod';

export const POS_CODES = {
  n: 'Nomen',
  v: 'Verb',
  a: 'Adjektiv',
  d: 'Adverb',
  p: 'Präposition',
  c: 'Konjunktion',
  r: 'Pronomen',
  t: 'Artikel',
  m: 'Numerale',
  x: 'Partikel',
  i: 'Interjektion',
} as const;
export type PosCode = keyof typeof POS_CODES;

export const LemmaEntrySchema = z.object({
  w: z.string(), // lemma as written: "Haus", "anfangen", "beschweren" (+ refl)
  p: z.enum(Object.keys(POS_CODES) as [PosCode, ...PosCode[]]),
  h: z.number().int().positive().optional(), // homograph number when one lemma has several nouns
  g: z.enum(['m', 'f', 'n']).optional(), // noun gender → der / die / das
  pl: z.string().optional(), // nominative plural, without article
  gen: z.string().optional(), // genitive singular, without article
  prt: z.string().optional(), // Präteritum, 3rd person singular, without pronoun ("fing an")
  pp: z.string().optional(), // Partizip II ("angefangen")
  aux: z.enum(['haben', 'sein', 'haben/sein']).optional(),
  sep: z.string().optional(), // separable prefix ("an")
  refl: z.boolean().optional(), // (also) used with "sich"
  rek: z.array(z.string()).optional(), // governed case / preposition, e.g. ["+ Dat."], ["auf + Akk."]
  cmp: z.string().optional(), // comparative
  sup: z.string().optional(), // superlative ("am schnellsten")
  rank: z.number().int().positive().optional(), // frequency rank, 1 = most frequent
  en: z.array(z.string()).optional(), // English glosses (en.wiktionary)
  de: z.string().optional(), // German definition (de.wiktionary), first sense
  tr: z.array(z.string()).optional(), // Turkish translations (de.wiktionary, or Claude when trAi)
  trAi: z.boolean().optional(), // tr written by Claude (scripts/dict/tr-claude.json): Wiktionary had none
  syn: z.array(z.string()).optional(),
  ant: z.array(z.string()).optional(),
  fam: z.array(z.string()).optional(), // derived / related words for "word family"
});
export type LemmaEntry = z.infer<typeof LemmaEntrySchema>;

export const LemmaShardSchema = z.record(z.string(), z.array(LemmaEntrySchema));
export const FormShardSchema = z.record(z.string(), z.array(z.string()));

export const ManifestSchema = z.object({
  version: z.literal(2),
  builtAt: z.string(),
  sources: z.array(z.string()),
  counts: z.object({ lemmas: z.number(), forms: z.number() }),
  // shard prefix (transliterated, e.g. "ge", "gea", "_") → short content hash used as ?v=
  forms: z.record(z.string(), z.string()),
  lemmas: z.record(z.string(), z.string()),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export function lemmaId(e: Pick<LemmaEntry, 'w' | 'p' | 'h'>): string {
  return e.h ? `${e.w}:${e.p}:${e.h}` : `${e.w}:${e.p}`;
}

export function parseLemmaId(id: string): { w: string; p: PosCode; h?: number } {
  const [w = '', p = '', h] = id.split(':');
  return h ? { w, p: p as PosCode, h: Number(h) } : { w, p: p as PosCode };
}

/**
 * Lookup key: NFC (pasted text may use decomposed umlauts), no invisible characters
 * (zero-width spaces/joiners from keyboard suggestions, soft hyphens from web text),
 * Turkish dotless ı / dotted İ → i (a Turkish keyboard; German has neither), trimmed,
 * lowercased, single spaces.
 */
export function normalizeKey(s: string): string {
  return s
    .normalize('NFC')
    .replace(/\p{Cf}/gu, '') // invisible format characters: zero-width space, soft hyphen, LRM/RLM, BOM…
    .replace(/[ıİ]/g, 'i')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('de-DE');
}

/** ASCII form of a key, used only for shard prefixes (ä→ae, ß→ss; anything else → "_"). */
export function translit(key: string): string {
  return key
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z]/g, '_');
}

// Windows cannot store files named like these devices (any extension), so git add fails on them.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/** File name (without .json) of a shard prefix. */
export function shardFile(prefix: string): string {
  return RESERVED.test(prefix) ? `${prefix}~` : prefix;
}

/**
 * The shard holding `key` is the longest listed prefix of translit(key).
 * Keys starting with a non-letter live in the "_" shard.
 */
export function shardFor(key: string, prefixes: ReadonlySet<string>): string | null {
  const t = translit(key);
  for (let n = t.length; n >= 1; n--) {
    const p = t.slice(0, n);
    if (prefixes.has(p)) return p;
  }
  return prefixes.has('_') ? '_' : null;
}

export const ARTICLE: Record<'m' | 'f' | 'n', 'der' | 'die' | 'das'> = { m: 'der', f: 'die', n: 'das' };
