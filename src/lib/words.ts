// Word knowledge per lemma (spec "Word coloring": new / learning / known / ignored) and saved cards.
import { useLiveQuery } from 'dexie-react-hooks';
import { ARTICLE, normalizeKey, type LemmaEntry } from '../../shared/dict';
import type { Mwe, TextFile, Token } from '../../shared/texts';
import { db, type CardRow, type WordState } from './db';

export type TokenState = 'new' | WordState;

export const lemmaKey = (lemma: string) => `w:${normalizeKey(lemma)}`;
export const mweKey = (m: Pick<Mwe, 'de'>) => `m:${normalizeKey(m.de)}`;

/** Tappable reading word: letters with a lemma from the annotation. */
export const isWord = (t: Token) => t.k === 'w' && !!t.l;

/** All saved states as a map (a few thousand rows at most), live-updating. */
export function useWordStates(): Map<string, WordState> | undefined {
  return useLiveQuery(async () => new Map((await db.wordStatus.toArray()).map((r) => [r.key, r.state] as const)), []);
}

/** Names are ignored automatically (spec: "Ignored (names, numbers): plain"). */
export function stateOf(t: Token, states: Map<string, WordState>): TokenState | null {
  if (!isWord(t)) return null;
  if (t.pos === 'PROPN') return 'ignored';
  return states.get(lemmaKey(t.l!)) ?? 'new';
}

/**
 * State used for colouring: a word that is still new but belongs to an expression saved as a
 * card ("eine Entscheidung treffen") shows as learning too.
 */
export function displayState(t: Token, states: Map<string, WordState>, mweStates?: Map<string, WordState>): TokenState | null {
  const st = stateOf(t, states);
  if (st === 'new' && t.mwe && mweStates?.get(t.mwe) === 'learning') return 'learning';
  return st;
}

/** Expression id in this text → saved state of that expression. */
export function mweStatesOf(text: TextFile, states: Map<string, WordState>): Map<string, WordState> {
  const out = new Map<string, WordState>();
  for (const m of text.mwes ?? []) {
    const st = states.get(mweKey(m));
    if (st) out.set(m.id, st);
  }
  return out;
}

export async function setWordState(key: string, state: WordState): Promise<void> {
  await db.wordStatus.put({ key, state, updatedAt: new Date().toISOString() });
}

/** "Rest als bekannt markieren": every lemma still new in this text becomes known. Returns the keys (for undo). */
export async function markRestKnown(text: TextFile, states: Map<string, WordState>): Promise<string[]> {
  const keys = new Set<string>();
  for (const s of text.sentences) for (const t of s.tok ?? []) if (stateOf(t, states) === 'new') keys.add(lemmaKey(t.l!));
  const now = new Date().toISOString();
  await db.wordStatus.bulkPut([...keys].map((key) => ({ key, state: 'known' as const, updatedAt: now })));
  return [...keys];
}

/** Undo of markRestKnown: those lemmas become new again. */
export async function undoMarkKnown(keys: string[]): Promise<void> {
  await db.wordStatus.bulkDelete(keys);
}

/** Known-word coverage in % (spec: shown on the home list), or null without annotations. */
export function coverage(text: TextFile, states: Map<string, WordState>): number | null {
  let total = 0;
  let known = 0;
  for (const s of text.sentences) {
    for (const t of s.tok ?? []) {
      const st = stateOf(t, states);
      if (!st || st === 'ignored') continue;
      total++;
      if (st === 'known') known++;
    }
  }
  return total ? Math.round((known / total) * 100) : null;
}

/** "der Plan", "sich beschweren", "anfangen" — the form shown on a card and in the sheet. */
export function displayLemma(t: Token, entry?: LemmaEntry): string {
  const g = t.g ?? entry?.g;
  if (t.pos === 'NOUN' && g) return `${ARTICLE[g]} ${t.l}`;
  if (t.refl && t.pos === 'VERB') return `sich ${t.l}`;
  return t.l ?? t.s;
}

/** Saves a word/expression with this sentence as context; it becomes "learning" (yellow). */
export async function addCard(c: {
  key: string;
  kind: CardRow['kind'];
  display: string;
  pos?: string;
  meaning_tr: string;
  text: TextFile;
  s: number;
  tokens: number[];
  via: CardRow['via'];
}): Promise<void> {
  const context = { textId: c.text.id, date: c.text.date, s: c.s, sentence: c.text.sentences[c.s]!.t, tokens: c.tokens };
  await db.transaction('rw', db.cards, db.wordStatus, async () => {
    const existing = await db.cards.get(c.key);
    if (existing) {
      if (!existing.contexts.some((x) => x.textId === context.textId && x.s === context.s)) existing.contexts.unshift(context);
      await db.cards.put(existing);
    } else {
      await db.cards.put({
        id: c.key, kind: c.kind, display: c.display, pos: c.pos, meaning_tr: c.meaning_tr,
        contexts: [context], createdAt: new Date().toISOString(), via: c.via,
      });
    }
    await db.wordStatus.put({ key: c.key, state: 'learning', updatedAt: new Date().toISOString() });
  });
}
