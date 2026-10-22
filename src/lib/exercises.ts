// Pure exercise logic (spec "Exercise types", narrowed by Enes 2026-10-22 to matching + word family):
// matching pairs, word family, text folding. No UI and no IndexedDB, so it runs in the node unit tests.
import { ARTICLE } from '../../shared/dict.ts';
import type { CardRow } from './db';

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

// ---------------------------------------------------------------- text

/** Lenient form for comparing words (search, unique tiles): case, punctuation, spaces and ä/ae, ö/oe, ü/ue, ß/ss don't matter. */
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

// ---------------------------------------------------------------- saved positions

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
