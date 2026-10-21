// Pure exercise logic (spec "Exercise types"): answer checking, cloze gaps, matching pairs, article &
// plural, word family. No UI and no IndexedDB, so it runs in the node unit tests.
import { ARTICLE } from '../../shared/dict.ts';
import type { CardContext, CardRow } from './db';

export type CardLike = Pick<CardRow, 'id' | 'kind' | 'display' | 'lemma' | 'pos' | 'meaning_tr' | 'contexts' | 'entry' | 'mweKind'>;
export type Rand = () => number;

export function shuffle<T>(items: readonly T[], rand: Rand = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------------------------------------------------------------- typed answers

/** Lenient form for comparing typed answers: case, punctuation, spaces and ä/ae, ö/oe, ü/ue, ß/ss don't matter. */
export function fold(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[.,!?;:„“”"'‚‘’«»()…–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

export type Verdict = 'exact' | 'typo' | 'wrong';

/** Like fold, but umlauts lose their dots: "Mütter" and "Mutter" become the same. */
const bare = (s: string) => fold(s.replace(/[äÄ]/g, 'a').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u'));

/**
 * One wrong letter is a typo (counts as correct but Hard), two for long words; none below 5 letters
 * (Haus ≠ Maus). Never a typo when only the ending differs (macht/machte, Lampe/Lampen) or only an
 * umlaut is missing (schon/schön, Mutter/Mütter): those are grammar or a different word.
 */
export function checkTyped(input: string, expected: string): Verdict {
  const a = fold(input);
  const b = fold(expected);
  if (!a) return 'wrong';
  if (a === b) return 'exact';
  if (bare(input) === bare(expected)) return 'wrong';
  let common = 0;
  while (common < a.length && a[common] === b[common]) common++;
  if (common >= b.length - 2) return 'wrong'; // the difference is in the last two letters: the ending
  const allowed = b.length >= 10 ? 2 : b.length >= 5 ? 1 : 0;
  return distance(a, b) <= allowed ? 'typo' : 'wrong';
}

export interface Outcome {
  correct: boolean;
  partial?: boolean;
  note?: string; // Turkish explanation shown with the answer
}

const fromVerdict = (v: Verdict): Outcome =>
  v === 'wrong' ? { correct: false } : v === 'typo' ? { correct: true, partial: true, note: 'Küçük bir yazım hatası var.' } : { correct: true };

// ---------------------------------------------------------------- article & plural

export function articleOf(card: CardLike): 'der' | 'die' | 'das' | undefined {
  if (card.kind !== 'lemma') return undefined;
  const fromDisplay = /^(der|die|das) \S+$/.exec(card.display)?.[1] as 'der' | 'die' | 'das' | undefined;
  if (fromDisplay) return fromDisplay;
  return card.entry?.p === 'n' && card.entry.g ? ARTICLE[card.entry.g] : undefined;
}

/** Plural from the dictionary, if it is a real form ("Häuser"), not "?" or empty. */
export function pluralOf(card: CardLike): string | undefined {
  const pl = card.entry?.pl;
  return pl && /^\p{L}[\p{L}:\- ]*$/u.test(pl) ? pl : undefined;
}

/** The plural must be exact (after folding): one letter is the whole point here (Mutter → Mütter). "die Häuser" is fine too. */
export function checkPlural(input: string, card: CardLike): Outcome {
  const typed = fold(input.replace(/^\s*die\s+/i, ''));
  return { correct: typed !== '' && typed === fold(pluralOf(card) ?? '') };
}

// ---------------------------------------------------------------- production (TR → DE with article)

export function checkProduction(input: string, card: CardLike): Outcome {
  const art = articleOf(card);
  if (!art) {
    const full = checkTyped(input, card.display);
    if (full !== 'wrong') return fromVerdict(full);
    // "beschweren" for "sich beschweren": right verb, missing "sich".
    if (card.display !== card.lemma && checkTyped(input, card.lemma) !== 'wrong') {
      return { correct: true, partial: true, note: `Tam hali: ${card.display}` };
    }
    return { correct: false };
  }
  const words = fold(input).split(' ');
  const typedArt = ['der', 'die', 'das'].includes(words[0]!) ? words[0] : undefined;
  const word = checkTyped(typedArt ? words.slice(1).join(' ') : input, card.lemma);
  if (word === 'wrong') return { correct: false };
  if (typedArt !== art) return { correct: true, partial: true, note: `Artikel: ${art} ${card.lemma}` };
  return fromVerdict(word);
}

// ---------------------------------------------------------------- cloze

export interface Cloze {
  parts: (string | number)[]; // text, or the index of a gap
  answers: string[]; // the gap texts as written in the sentence
  ctx: CardContext;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Character ranges of the chosen tokens in their sentence. Every token is located in order, so a
 * word that occurs twice ("die Frau … die Frau") gets the occurrence that was actually tapped.
 */
export function tokenSpans(sentence: string, toks: readonly { s: string }[], indices: readonly number[]): [number, number][] | undefined {
  const at: [number, number][] = [];
  let pos = 0;
  for (const t of toks) {
    const i = sentence.indexOf(t.s, pos);
    if (i < 0) return undefined;
    at.push([i, i + t.s.length]);
    pos = i + t.s.length;
  }
  const out = [...indices].sort((a, b) => a - b).map((i) => at[i]);
  return out.length && out.every(Boolean) ? (out as [number, number][]) : undefined;
}

function blankSpans(sentence: string, spans: [number, number][]): Omit<Cloze, 'ctx'> | null {
  const parts: (string | number)[] = [];
  const answers: string[] = [];
  let pos = 0;
  for (const [from, to] of spans) {
    if (from < pos || to > sentence.length || to <= from) return null;
    if (from > pos) parts.push(sentence.slice(pos, from));
    parts.push(answers.length);
    answers.push(sentence.slice(from, to));
    pos = to;
  }
  if (pos < sentence.length) parts.push(sentence.slice(pos));
  return answers.length ? { parts, answers } : null;
}

/** Cards without saved positions: search the forms in order, exact case first ("Weg" ≠ "weg"). */
function blankForms(sentence: string, forms: string[]): Omit<Cloze, 'ctx'> | null {
  const spans: [number, number][] = [];
  let pos = 0;
  for (const f of forms) {
    const re = (flags: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(f)}(?![\\p{L}\\p{N}])`, flags).exec(sentence.slice(pos));
    const m = re('u') ?? re('iu');
    if (!m) return null;
    spans.push([pos + m.index, pos + m.index + f.length]);
    pos += m.index + f.length;
  }
  return blankSpans(sentence, spans);
}

/** The saved sentence with the word blanked ("Er ___ morgen ___."), or null if it can't be found. */
export function clozeOf(card: CardLike): Cloze | null {
  for (const ctx of card.contexts) {
    const forms = ctx.forms?.length ? ctx.forms : card.kind === 'lemma' ? [card.lemma] : [];
    const r = (ctx.spans?.length ? blankSpans(ctx.sentence, ctx.spans) : null) ?? (forms.length ? blankForms(ctx.sentence, forms) : null);
    if (r) return { ...r, ctx };
  }
  return null;
}

export const checkCloze = (input: string, cloze: Cloze): Outcome => fromVerdict(checkTyped(input, cloze.answers.join(' ')));

// ---------------------------------------------------------------- matching

export type MatchMode = 'tr' | 'def' | 'syn' | 'nv' | 'vp';
export const MATCH_MODE_LABEL: Record<MatchMode, string> = {
  tr: 'DE ↔ TR', def: 'Wort ↔ Definition', syn: 'Synonym ↔ Synonym', nv: 'Nomen ↔ Verb', vp: 'Verb ↔ Präp.',
};

export interface Pair {
  id: string;
  left: string; // always German
  right: string;
  rightLang: 'tr' | 'de';
  cardId?: string; // rated pair; fillers have none
}

export interface MweLike {
  de: string;
  tr: string;
  kind: NonNullable<CardRow['mweKind']>;
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(' ', max - 1);
  return `${s.slice(0, cut > 20 ? cut : max - 1)}…`;
}

/** "eine Entscheidung treffen" → ["eine Entscheidung", "treffen"]; "sich verlassen auf" → ["sich verlassen", "auf"]. */
export function splitMwe(de: string): [string, string] | null {
  const w = de.trim().split(/\s+/);
  return w.length < 2 ? null : [w.slice(0, -1).join(' '), w.at(-1)!];
}

function synonymOf(card: CardLike): string | undefined {
  return card.entry?.syn?.find((s) => !/\s/.test(s) && fold(s) !== fold(card.lemma));
}

export function modesFor(card: CardLike): MatchMode[] {
  const modes: MatchMode[] = [];
  if (card.mweKind === 'nvv') modes.push('nv');
  if (card.mweKind === 'vprep') modes.push('vp');
  if (card.meaning_tr) modes.push('tr');
  if (card.kind === 'lemma' && card.entry?.de) modes.push('def');
  if (card.kind === 'lemma' && synonymOf(card)) modes.push('syn');
  return modes;
}

export function pairFor(card: CardLike, mode: MatchMode): Pair | null {
  const base = { id: card.id, cardId: card.id };
  switch (mode) {
    case 'tr':
      return card.meaning_tr ? { ...base, left: card.display, right: card.meaning_tr, rightLang: 'tr' } : null;
    case 'def':
      return card.kind === 'lemma' && card.entry?.de ? { ...base, left: card.display, right: shorten(card.entry.de, 80), rightLang: 'de' } : null;
    case 'syn': {
      const syn = card.kind === 'lemma' ? synonymOf(card) : undefined;
      return syn ? { ...base, left: card.display, right: syn, rightLang: 'de' } : null;
    }
    case 'nv':
    case 'vp': {
      if (card.mweKind !== (mode === 'nv' ? 'nvv' : 'vprep')) return null;
      const s = splitMwe(card.display);
      return s ? { ...base, left: s[0], right: s[1], rightLang: 'de' } : null;
    }
  }
}

function mwePair(m: MweLike, mode: MatchMode, i: number): Pair | null {
  if (m.kind !== (mode === 'nv' ? 'nvv' : 'vprep')) return null;
  const s = splitMwe(m.de);
  return s ? { id: `x${i}`, left: s[0], right: s[1], rightLang: 'de' } : null;
}

export const MATCH_MIN = 5;
export const MATCH_MAX = 6;

/**
 * 5–6 pairs: the rated (due) cards first, then other cards and — for the expression modes —
 * expressions from downloaded texts as unrated fillers (Enes, 2026-10-21). Left and right texts
 * are unique, so every tile has exactly one partner. Null when fewer than 5 pairs can be built.
 */
export function buildMatch(mode: MatchMode, rated: CardLike[], fillers: CardLike[], mwes: MweLike[] = [], rand: Rand = Math.random): Pair[] | null {
  const pairs: Pair[] = [];
  const lefts = new Set<string>();
  const rights = new Set<string>();
  const add = (p: Pair | null) => {
    if (!p || pairs.length >= MATCH_MAX || lefts.has(fold(p.left)) || rights.has(fold(p.right))) return;
    lefts.add(fold(p.left));
    rights.add(fold(p.right));
    pairs.push(p);
  };
  for (const c of rated) add(pairFor(c, mode));
  for (const c of shuffle(fillers, rand)) {
    const p = pairFor(c, mode);
    add(p && { ...p, cardId: undefined });
  }
  if (mode === 'nv' || mode === 'vp') shuffle(mwes, rand).forEach((m, i) => add(mwePair(m, mode, i)));
  return pairs.length >= MATCH_MIN ? pairs : null;
}

// ---------------------------------------------------------------- word family

export interface Suffix {
  suf: string;
  cls: 'n' | 'a'; // noun / adjective
  g?: 'm' | 'f' | 'n';
  rule: string; // Turkish, shown after answering (spec: "-ung → always die")
}

// Derivational suffixes with a reliable gender / word class. Sorted longest first for stemming.
export const SUFFIXES: Suffix[] = ([
  { suf: 'ung', cls: 'n', g: 'f', rule: '-ung ile biten isimler her zaman die.' },
  { suf: 'heit', cls: 'n', g: 'f', rule: '-heit ile biten isimler her zaman die.' },
  { suf: 'keit', cls: 'n', g: 'f', rule: '-keit ile biten isimler her zaman die.' },
  { suf: 'igkeit', cls: 'n', g: 'f', rule: '-keit ile biten isimler her zaman die.' },
  { suf: 'lichkeit', cls: 'n', g: 'f', rule: '-keit ile biten isimler her zaman die.' },
  { suf: 'barkeit', cls: 'n', g: 'f', rule: '-keit ile biten isimler her zaman die.' },
  { suf: 'schaft', cls: 'n', g: 'f', rule: '-schaft ile biten isimler her zaman die.' },
  { suf: 'ion', cls: 'n', g: 'f', rule: '-ion ile biten isimler her zaman die.' },
  { suf: 'ität', cls: 'n', g: 'f', rule: '-ität ile biten isimler her zaman die.' },
  { suf: 'erei', cls: 'n', g: 'f', rule: '-ei/-erei ile biten isimler die.' },
  { suf: 'erin', cls: 'n', g: 'f', rule: '-in kadın halini yapar, her zaman die.' },
  { suf: 'er', cls: 'n', g: 'm', rule: 'Fiilden gelen -er çoğunlukla yapan kişi ya da alettir, der.' },
  { suf: 'ling', cls: 'n', g: 'm', rule: '-ling ile biten isimler der.' },
  { suf: 'ismus', cls: 'n', g: 'm', rule: '-ismus ile biten isimler her zaman der.' },
  { suf: 'chen', cls: 'n', g: 'n', rule: '-chen küçültme ekidir, her zaman das.' },
  { suf: 'lein', cls: 'n', g: 'n', rule: '-lein küçültme ekidir, her zaman das.' },
  { suf: 'tum', cls: 'n', g: 'n', rule: '-tum ile biten isimler çoğunlukla das.' },
  { suf: 'ment', cls: 'n', g: 'n', rule: '-ment ile biten isimler çoğunlukla das.' },
  { suf: 'nis', cls: 'n', g: 'f', rule: '-nis ile biten isimler çoğunlukla die (bazen das).' },
  { suf: 'bar', cls: 'a', rule: '-bar „-ebilir“ anlamında sıfat yapar (machbar: yapılabilir).' },
  { suf: 'lich', cls: 'a', rule: '-lich sıfat yapar.' },
  { suf: 'ig', cls: 'a', rule: '-ig sıfat yapar.' },
  { suf: 'isch', cls: 'a', rule: '-isch sıfat yapar (çoğunlukla „-e ait“).' },
  { suf: 'sam', cls: 'a', rule: '-sam eğilim bildiren sıfat yapar (sparsam: tutumlu).' },
  { suf: 'haft', cls: 'a', rule: '-haft „-gibi, -li“ anlamında sıfat yapar.' },
  { suf: 'los', cls: 'a', rule: '-los „-sız“ anlamında sıfat yapar.' },
  { suf: 'end', cls: 'a', rule: '-end şimdiki zaman ortacıdır („-an/-en“).' },
] satisfies Suffix[]).sort((a, b) => b.suf.length - a.suf.length);

const VERB_ENDINGS = ['ieren', 'eln', 'ern', 'en', 'n'];
const STEM_ENDINGS = [...SUFFIXES.map((s) => s.suf), ...VERB_ENDINGS].sort((a, b) => b.length - a.length);

/** "Entscheidung" / "entscheiden" → "entscheid". */
export function stemOf(lemma: string): string {
  const l = lemma.toLowerCase();
  for (const e of STEM_ENDINGS) if (l.endsWith(e) && l.length - e.length >= 3) return l.slice(0, -e.length);
  return l;
}

export interface FamilyMember {
  word: string;
  suffix?: Suffix;
}

const isCapital = (w: string) => w[0] !== w[0]!.toLowerCase();

/**
 * Family members from the dictionary's (noisy) list, kept only when they are the stem plus a known
 * suffix or verb ending — "Entscheidung, Entscheider, entscheidbar" but not compounds like "hausbacken".
 */
export function membersOf(card: CardLike): FamilyMember[] {
  if (card.kind !== 'lemma') return [];
  const stem = stemOf(card.lemma);
  const seen = new Set<string>();
  const out: FamilyMember[] = [];
  for (const w of [card.lemma, ...(card.entry?.fam ?? [])]) {
    const l = w.toLowerCase();
    if (/[\s-]/.test(w) || seen.has(l) || !l.startsWith(stem)) continue;
    const rem = l.slice(stem.length);
    const suffix = SUFFIXES.find((s) => s.suf === rem);
    const verb = VERB_ENDINGS.includes(rem) && !isCapital(w);
    if (rem && !suffix && !verb) continue;
    if (suffix && (suffix.cls === 'n') !== isCapital(w)) continue;
    seen.add(l);
    out.push({ word: w, suffix });
  }
  return out;
}

export interface Family {
  base: string;
  members: FamilyMember[];
  target: FamilyMember & { suffix: Suffix };
  prompt: string; // "die …" or "Sıfat: …"
  options: string[]; // target + 3 invented forms
}

/**
 * Spec "Word family": a base word, one derived form asked with 4 options; the distractors are the
 * same stem with wrong suffixes of the same word class (same gender first, so the article gives
 * nothing away). `known` = real words that must never be offered as wrong answers.
 */
export function familyOf(card: CardLike, pick = 0, known: ReadonlySet<string> = new Set(), rand: Rand = Math.random): Family | null {
  const members = membersOf(card);
  const targets = members.filter((m): m is FamilyMember & { suffix: Suffix } => !!m.suffix && m.word !== card.lemma);
  if (!targets.length) return null;
  const target = targets[pick % targets.length]!;
  const stem = stemOf(card.lemma);
  const taken = new Set([...members.map((m) => fold(m.word)), ...[...known].map(fold)]);
  const form = (s: Suffix) => (s.cls === 'n' ? stem[0]!.toUpperCase() + stem.slice(1) : stem) + s.suf;
  const candidates = SUFFIXES.filter((s) => s.cls === target.suffix.cls && s.suf !== target.suffix.suf && !taken.has(fold(form(s))));
  const sameGender = candidates.filter((s) => s.g === target.suffix.g);
  const others = candidates.filter((s) => s.g !== target.suffix.g);
  const distractors = [...new Set([...shuffle(sameGender, rand), ...shuffle(others, rand)].map(form))].slice(0, 3);
  if (distractors.length < 3) return null;
  const prompt = target.suffix.cls === 'n' ? `${ARTICLE[target.suffix.g!]} …` : 'Sıfat: …';
  return { base: card.lemma, members, target, prompt, options: shuffle([target.word, ...distractors], rand) };
}
