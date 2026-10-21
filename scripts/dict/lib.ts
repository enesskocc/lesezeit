// Pure helpers for the dictionary importer. No file I/O here, so everything is unit-testable.
import { normalizeKey, translit, type LemmaEntry, type PosCode } from '../../shared/dict.ts';

// --- kaikki.org (wiktextract) JSONL shapes, only the fields we read ---------------------------
export interface RawForm {
  form: string;
  tags?: string[];
  raw_tags?: string[];
  source?: string;
}
export interface RawSense {
  glosses?: string[];
  tags?: string[];
  form_of?: { word: string }[];
}
export interface RawEntry {
  word: string;
  pos: string;
  lang_code?: string;
  tags?: string[];
  senses?: RawSense[];
  forms?: RawForm[];
  translations?: Related[];
  synonyms?: Related[];
  antonyms?: Related[];
  derived?: Related[];
}
interface Related {
  word?: string;
  lang_code?: string;
  sense_index?: string; // "1", "1, 2", "2a" — which numbered sense the item belongs to
}

/** Sense numbers an item belongs to: "1, 2" → [1, 2], "2a" → [2]. */
const senseNumbers = (idx: string) => idx.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => !Number.isNaN(n));

/**
 * Items for the main senses (default: sense 1) when de.wiktionary numbers them; unnumbered items
 * always count. With fallback, an entry with no main-sense items returns everything instead.
 */
function mainSense(items: Related[] | undefined, senses: number[] = [1], fallback = false): Related[] {
  const all = items ?? [];
  const main = all.filter((x) => !x.sense_index || senseNumbers(x.sense_index).some((n) => senses.includes(n)));
  return main.length || !fallback ? main : all;
}

const POS_MAP: Record<string, PosCode> = {
  noun: 'n',
  verb: 'v',
  adj: 'a',
  adv: 'd',
  prep: 'p',
  postp: 'p',
  conj: 'c',
  pron: 'r',
  det: 't',
  article: 't',
  num: 'm',
  particle: 'x',
  intj: 'i',
};
export const posCode = (pos: string): PosCode | null => POS_MAP[pos] ?? null;

const has = (tags: string[] | undefined, ...want: string[]) => !!tags && want.some((t) => tags.includes(t));
const hasAll = (tags: string[] | undefined, ...want: string[]) => !!tags && want.every((t) => tags.includes(t));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const uniq = (xs: (string | undefined)[], max: number) =>
  [...new Set(xs.map((x) => x?.trim()).filter((x): x is string => !!x))].slice(0, max);

const ARCHAIC = ['archaic', 'outdated', 'obsolete'];

export function isFormOfEntry(e: RawEntry): boolean {
  if (has(e.tags, 'form-of')) return true;
  const senses = e.senses ?? [];
  return senses.length > 0 && senses.every((s) => !!s.form_of?.length || has(s.tags, 'form-of'));
}

/** True when the entry is a German dictionary lemma we want to keep. */
export function isKeptLemma(e: RawEntry): boolean {
  if (e.lang_code !== 'de' || !posCode(e.pos)) return false; // drops names, abbreviations, affixes, phrases
  // Single words only; hyphens inside are fine (E-Mail), leading/trailing ones are affixes.
  if (!e.word || /[\s.]/.test(e.word) || /^[-–\d]|[-–]$/.test(e.word)) return false;
  if (isFormOfEntry(e)) return false;
  const senses = e.senses ?? [];
  if (senses.length > 0 && senses.every((s) => has(s.tags, ...ARCHAIC))) return false;
  return true;
}

const GENDER = { masculine: 'm', feminine: 'f', neuter: 'n' } as const;

/** First listed gender: "der/das Kiefer" (tags masculine, neuter) → m, the usual one. */
export function nounGender(tags: string[] | undefined): LemmaEntry['g'] {
  const first = tags?.find((t): t is keyof typeof GENDER => t in GENDER);
  return first ? GENDER[first] : undefined;
}

function auxOf(forms: RawForm[]): LemmaEntry['aux'] {
  // Only plain "auxiliary" rows. Regional/colloquial alternatives carry extra tags (en) or
  // raw_tags such as "süddeutsch" (de) and are ignored.
  const plain = (f: RawForm) => !f.raw_tags?.length && (f.tags ?? []).every((t) => t === 'auxiliary' || t === 'perfect');
  const aux = new Set(
    forms
      .filter((f) => has(f.tags, 'auxiliary') && plain(f))
      .map((f) => f.form)
      .filter((f) => f === 'haben' || f === 'sein'),
  );
  if (aux.size === 2) return 'haben/sein';
  return aux.has('haben') ? 'haben' : aux.has('sein') ? 'sein' : undefined;
}

// Some table cells include an article or pronoun ("des Falls", "er/sie/es fiel vor"); the app adds its own.
const LEADING_WORD = /^(der|die|das|des|dem|den|ich|du|er|sie|es|wir|ihr|er\/sie\/es)\s+/;
export const cleanForm = (form: string) => form.trim().replace(/!$/, '').replace(LEADING_WORD, '');
const firstForm = (forms: RawForm[], pred: (f: RawForm) => boolean) => {
  const f = forms.find(pred);
  return f ? cleanForm(f.form) : undefined;
};

const CASE: Record<string, string> = { accusative: 'Akk.', dative: 'Dat.', genitive: 'Gen.' };

/** "[with über (+ accusative) …]" → "über + Akk."; "(+ dative)" → "+ Dat." (en.wiktionary glosses). */
export function parseRektion(glosses: string[]): string[] {
  const out: string[] = [];
  for (const g of glosses) {
    for (const m of g.matchAll(/\bwith ([a-zäöüß]+) \(\+ (accusative|dative|genitive)\)/g)) out.push(`${m[1]} + ${CASE[m[2]!]}`);
    for (const m of g.matchAll(/(?<!\bwith [a-zäöüß]+ )\(\+ (accusative|dative|genitive)\)/g)) out.push(`+ ${CASE[m[1]!]}`);
  }
  return uniq(out, 3);
}

/** Grammar + meanings from de.wiktionary (German definitions, Turkish translations, relations). */
export function extractDe(e: RawEntry): Partial<LemmaEntry> {
  const p = posCode(e.pos)!;
  const forms = e.forms ?? [];
  const senses = (e.senses ?? []).filter((s) => !has(s.tags, ...ARCHAIC, 'no-gloss'));
  const out: Partial<LemmaEntry> = {};
  if (p === 'n') {
    out.g = nounGender(e.tags);
    if (!has(e.tags, 'no-plural')) out.pl = firstForm(forms, (f) => hasAll(f.tags, 'nominative', 'plural'));
    out.gen = firstForm(forms, (f) => hasAll(f.tags, 'genitive', 'singular'));
  }
  if (p === 'v') {
    out.prt = firstForm(forms, (f) => has(f.tags, 'past') && !has(f.tags, 'subjunctive-ii', 'participle-2'));
    out.pp = firstForm(forms, (f) => has(f.tags, 'participle-2'));
    out.aux = auxOf(forms);
    if (senses.some((s) => has(s.tags, 'reflexive'))) out.refl = true;
  }
  if (p === 'a' || p === 'd') {
    out.cmp = firstForm(forms, (f) => f.tags?.length === 1 && f.tags[0] === 'comparative');
    out.sup = firstForm(forms, (f) => f.tags?.length === 1 && f.tags[0] === 'superlative');
  }
  const def = senses.find((s) => s.glosses?.[0])?.glosses?.[0];
  if (def) out.de = clip(def, 140);
  const tr = uniq(mainSense((e.translations ?? []).filter((t) => t.lang_code === 'tr'), [1], true).map((t) => t.word), 5);
  if (tr.length) out.tr = tr;
  const syn = uniq(mainSense(e.synonyms, [1, 2]).map((s) => s.word), 6);
  if (syn.length) out.syn = syn;
  const ant = uniq(mainSense(e.antonyms, [1, 2]).map((s) => s.word), 4);
  if (ant.length) out.ant = ant;
  const fam = uniq((e.derived ?? []).map((s) => s.word).filter((w) => w && !/\s/.test(w)), 8);
  if (fam.length) out.fam = fam;
  return out;
}

/** Grammar + English glosses from en.wiktionary. Only the headword forms are used for grammar. */
export function extractEn(e: RawEntry): Partial<LemmaEntry> {
  const p = posCode(e.pos)!;
  const head = (e.forms ?? []).filter((f) => !f.source);
  const senses = (e.senses ?? []).filter((s) => !s.form_of?.length && !has(s.tags, ...ARCHAIC, 'form-of'));
  const out: Partial<LemmaEntry> = {};
  if (p === 'n') {
    out.g = nounGender(senses[0]?.tags);
    out.pl = firstForm(head, (f) => has(f.tags, 'plural') && !has(f.tags, 'diminutive', 'alternative'));
    out.gen = firstForm(head, (f) => has(f.tags, 'genitive') && !has(f.tags, 'with-article', 'alternative'));
  }
  if (p === 'v') {
    out.prt = firstForm(head, (f) => f.tags?.length === 1 && f.tags[0] === 'past');
    out.pp = firstForm(head, (f) => hasAll(f.tags, 'participle', 'past'));
    out.aux = auxOf(head);
    if (senses.some((s) => has(s.tags, 'reflexive'))) out.refl = true;
    const rek = parseRektion(senses.flatMap((s) => s.glosses ?? []));
    if (rek.length) out.rek = rek;
  }
  if (p === 'a' || p === 'd') {
    out.cmp = firstForm(head, (f) => f.tags?.length === 1 && f.tags[0] === 'comparative');
    out.sup = firstForm(head, (f) => f.tags?.length === 1 && f.tags[0] === 'superlative');
  }
  const en = uniq(senses.map((s) => s.glosses?.[0] && clip(s.glosses[0], 90)), 3);
  if (en.length) out.en = en;
  return out;
}

/** de.wiktionary wins for grammar; en.wiktionary fills gaps and provides English glosses + Rektion. */
export function mergeLemma(w: string, p: PosCode, de: Partial<LemmaEntry>, en: Partial<LemmaEntry>): LemmaEntry {
  const pick = <K extends keyof LemmaEntry>(k: K) => (de[k] ?? en[k]) as LemmaEntry[K];
  const entry: LemmaEntry = { w, p };
  for (const k of ['g', 'pl', 'gen', 'prt', 'pp', 'aux', 'refl', 'cmp', 'sup', 'de', 'tr', 'syn', 'ant', 'fam'] as const) {
    const v = pick(k);
    if (v !== undefined) (entry as Record<string, unknown>)[k] = v;
  }
  // de lists regional "sein" as a plain second helper (anfangen, stehen); trust en when it is unambiguous.
  if (de.aux === 'haben/sein' && en.aux && en.aux !== 'haben/sein') entry.aux = en.aux;
  if (en.en) entry.en = en.en;
  if (en.rek) entry.rek = en.rek;
  // Separable prefix: last word of a two-word Präteritum ("fing an" → "an").
  const sepMatch = entry.prt?.match(/^\S+ (\S+)$/);
  if (p === 'v' && sepMatch && w.toLocaleLowerCase('de-DE').startsWith(sepMatch[1]!)) entry.sep = sepMatch[1];
  return entry;
}

const BAD_FORM_TAGS = [
  'abbreviation', 'diminutive', 'variant', 'alternative', 'obsolete', 'archaic', 'table-tags',
  'inflection-template', 'class', 'auxiliary', 'romanization', 'misspelling',
];

/**
 * Inflected forms a reader can meet in a text: single words and two-word forms ("fing an").
 * Two-word forms are only kept later if the second word is the separable prefix (keepForm).
 */
export function candidateForms(e: RawEntry): string[] {
  const out = new Set<string>();
  for (const f of e.forms ?? []) {
    if (has(f.tags, ...BAD_FORM_TAGS)) continue;
    const form = cleanForm(f.form);
    if (!form || /[()/,;]/.test(form) || form === '—' || form === '-') continue;
    if (form.split(/\s+/).length <= 2) out.add(normalizeKey(form));
  }
  return [...out];
}

/** "fing an" is kept for anfangen (sep "an"); "angefangen haben", "zu beschweren" are not. */
export function keepForm(form: string, sep: string | undefined): boolean {
  const words = form.split(' ');
  return words.length === 1 || (words.length === 2 && !!sep && words[1] === sep);
}

/**
 * Splits a key → value map into shards whose serialized size stays under `limit` bytes.
 * Shards start at one letter and get one more letter until they fit. A prefix may hold only
 * the keys exactly equal to it while longer keys live in child shards; lookup always uses the
 * longest existing prefix (see shardFor in shared/dict.ts).
 */
export function buildShards<V>(map: Map<string, V>, limit: number, maxDepth = 8): Map<string, Record<string, V>> {
  const items = [...map].map(([key, value]) => ({
    key,
    value,
    t: translit(key),
    size: Buffer.byteLength(JSON.stringify(key)) + Buffer.byteLength(JSON.stringify(value)) + 2,
  }));
  const shards = new Map<string, Record<string, V>>();
  const emit = (prefix: string, group: typeof items) => {
    if (!group.length) return;
    const obj: Record<string, V> = {};
    for (const it of group.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) obj[it.key] = it.value;
    shards.set(prefix, obj);
  };
  const split = (prefix: string, group: typeof items) => {
    const size = group.reduce((n, it) => n + it.size, 0);
    if (size <= limit || prefix.length >= maxDepth) return emit(prefix, group);
    const exact = group.filter((it) => it.t.length <= prefix.length);
    emit(prefix, exact);
    const children = new Map<string, typeof items>();
    for (const it of group) {
      if (it.t.length <= prefix.length) continue;
      const c = prefix + it.t[prefix.length];
      let g = children.get(c);
      if (!g) children.set(c, (g = []));
      g.push(it);
    }
    for (const [c, g] of children) split(c, g);
  };
  const top = new Map<string, typeof items>();
  for (const it of items) {
    const c = it.t[0] ?? '_';
    let g = top.get(c);
    if (!g) top.set(c, (g = []));
    g.push(it);
  }
  for (const [c, g] of top) split(c, g);
  return shards;
}

/**
 * Frequency rank per lemma id: every occurrence count of a word form is credited to each lemma
 * that form can belong to, then lemmas are ranked by total (1 = most frequent).
 */
export function rankLemmas(
  freq: Iterable<[string, number]>,
  idsForKey: (key: string) => Iterable<string>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [word, count] of freq) {
    for (const id of idsForKey(normalizeKey(word))) totals.set(id, (totals.get(id) ?? 0) + count);
  }
  const ranked = [...totals].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return new Map(ranked.map(([id], i) => [id, i + 1]));
}
