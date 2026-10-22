// Pure exercise logic (spec "Exercise types", narrowed by Enes 2026-10-22 to matching only):
// matching pairs, saved word positions, text folding. No UI and no IndexedDB, so it runs in the node unit tests.
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
