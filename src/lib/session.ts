// Session composer (spec "Session composer"): which card comes next and with which exercise.
// Pure: the screen passes the current cards and the time, so it runs in the node unit tests.
import {
  articleOf, buildMatch, clozeOf, familyOf, MATCH_MAX, modesFor, pairFor,
  type CardLike, type MatchMode, type MweLike, type Pair, type Rand,
} from './exercises.ts';
import { phaseOf, type Phase } from './srs.ts';
import type { CardRow } from './db';

// Listen & type is left out on purpose (Enes, 2026-10-21). Own sentence comes with Gemini (M8),
// verb forms and synonym/antonym with milestone 10.
export type ExerciseKind = 'flash-de' | 'flash-tr' | 'match' | 'artikel' | 'cloze' | 'production' | 'family';
export const EXERCISE_LABEL: Record<ExerciseKind, string> = {
  'flash-de': 'Kart', 'flash-tr': 'Kart', match: 'Eşleştirme', artikel: 'Artikel & Plural', cloze: 'Boşluk',
  production: 'Üretim', family: 'Kelime ailesi',
};
export const DRILLS: ExerciseKind[] = ['match', 'artikel', 'cloze', 'family', 'production'];

export type SessionCard = CardLike & Pick<CardRow, 'fsrs' | 'due' | 'createdAt'>;

export interface Context {
  cards: SessionCard[];
  mwes: MweLike[]; // expressions from downloaded texts (matching fillers)
  known: ReadonlySet<string>; // real words: never offered as invented word-family forms
  rand: Rand;
}

export interface Item {
  kind: ExerciseKind;
  cardIds: string[]; // cards this exercise answers for
  pairs?: Pair[];
  mode?: MatchMode;
  repeat?: boolean; // the end-of-session repeat of a wrong card
}

export interface SessionConfig {
  minutes: number; // 0 = "all due"
  newLeft: number; // today's remaining new-card limit
  reviewsLeft: number; // today's remaining review limit
  drill?: ExerciseKind; // practise one exercise type (Kelimeler → Alıştırma)
}

export interface SessionState {
  config: SessionConfig;
  startedAt: number;
  count: number;
  introduced: Set<string>; // new cards started in this session
  reviewed: number; // review-state cards answered (count against the daily limit)
  last: Map<string, boolean>; // last result per card in this session
  repeated: Set<string>;
}

/** A new card waits at most this long for its next learning step; Anki's "learn ahead" limit. */
export const LEARN_AHEAD_MS = 20 * 60_000;
export const DRILL_ITEMS = 8;
const DRILL_MATCH_ROUNDS = 2;

export function startSession(config: SessionConfig, now: number): SessionState {
  return { config, startedAt: now, count: 0, introduced: new Set(), reviewed: 0, last: new Map(), repeated: new Set() };
}

export function eligible(card: SessionCard, kind: ExerciseKind, ctx: Context): boolean {
  switch (kind) {
    case 'flash-de':
      return true;
    case 'flash-tr':
    case 'production':
      return !!card.meaning_tr;
    case 'match':
      return modesFor(card).length > 0;
    case 'artikel':
      return !!articleOf(card);
    case 'cloze':
      return !!clozeOf(card);
    case 'family':
      return !!familyOf(card, 0, ctx.known);
  }
}

const BY_PHASE: Record<Exclude<Phase, 'learning'>, ExerciseKind[]> = {
  new: ['flash-de'],
  young: ['cloze', 'artikel', 'match'],
  mature: ['production', 'family', 'cloze'],
};

/**
 * Spec: new cards flashcard → matching → cloze (the FSRS learning steps), young cards cloze /
 * artikel / matching, mature cards production / word family (cloze when neither fits). Rotates
 * by review count, so a card meets a different exercise each time.
 */
export function exerciseFor(card: SessionCard, ctx: Context): ExerciseKind {
  const phase = phaseOf(card.fsrs);
  let options: ExerciseKind[];
  if (phase !== 'learning') options = BY_PHASE[phase];
  else if (card.fsrs.state === 1) options = card.fsrs.reps <= 1 ? ['match'] : ['cloze'];
  else options = ['cloze', 'flash-tr']; // relearning after a lapse
  const ok = options.filter((k) => eligible(card, k, ctx));
  if (!ok.length) return phase === 'new' ? 'flash-de' : 'flash-tr';
  return ok[(card.fsrs.reps + card.fsrs.lapses) % ok.length]!;
}

/**
 * Matching modes to try for this card, best first: its expression mode, then the others rotated by
 * review count. The caller takes the first one that yields 5 pairs — a mode most cards can't fill
 * (e.g. "Wort ↔ Definition") must not cancel the matching step.
 */
function matchModes(card: SessionCard): MatchMode[] {
  const modes = modesFor(card);
  const mwe = modes.filter((m) => m === 'nv' || m === 'vp');
  const rest = modes.filter((m) => m !== 'nv' && m !== 'vp');
  const k = rest.length ? (card.fsrs.reps + card.fsrs.lapses) % rest.length : 0;
  return [...mwe, ...rest.slice(k), ...rest.slice(0, k)];
}

const byDue = (a: SessionCard, b: SessionCard) => a.due - b.due;
const isLearning = (c: SessionCard) => c.fsrs.state === 1 || c.fsrs.state === 3;

function itemFor(card: SessionCard, s: SessionState, ctx: Context, now: number): Item {
  const kind = exerciseFor(card, ctx);
  if (kind !== 'match') return { kind, cardIds: [card.id] };
  for (const mode of matchModes(card)) {
    // Other due cards whose turn is matching too join the same round, within today's review limit.
    let reviewRoom = s.config.reviewsLeft - s.reviewed - (card.fsrs.state === 2 ? 1 : 0);
    const others = ctx.cards
      .filter((c) => c.id !== card.id && c.due <= now && c.fsrs.state !== 0 && pairFor(c, mode) && exerciseFor(c, ctx) === 'match')
      .sort(byDue)
      .filter((c) => c.fsrs.state !== 2 || reviewRoom-- > 0)
      .slice(0, MATCH_MAX - 1);
    const rated = [card, ...others];
    const pairs = buildMatch(mode, rated, ctx.cards.filter((c) => !rated.includes(c)), ctx.mwes, ctx.rand);
    if (pairs) return { kind, cardIds: pairs.flatMap((p) => (p.cardId ? [p.cardId] : [])), pairs, mode };
  }
  return { kind: phaseOf(card.fsrs) === 'new' ? 'flash-de' : 'flash-tr', cardIds: [card.id] };
}

function repeatWrong(s: SessionState, ctx: Context, now: number): Item | null {
  for (const [id, ok] of s.last) {
    if (ok || s.repeated.has(id)) continue;
    const card = ctx.cards.find((c) => c.id === id);
    if (!card) continue;
    // A drill repeats with its own exercise type; a session picks by the card's new state.
    const drill = s.config.drill;
    if (drill === 'match') {
      const others = ctx.cards.filter((c) => c.id !== id);
      for (const mode of matchModes(card)) {
        const pairs = buildMatch(mode, [card], others, ctx.mwes, ctx.rand);
        if (pairs) return { kind: drill, cardIds: [id], pairs, mode, repeat: true };
      }
      continue;
    }
    if (drill) return { kind: drill, cardIds: [id], repeat: true };
    return { ...itemFor(card, s, ctx, now), repeat: true };
  }
  return null;
}

function nextDrill(s: SessionState, ctx: Context, now: number): Item | null {
  const kind = s.config.drill!;
  if (s.count >= (kind === 'match' ? DRILL_MATCH_ROUNDS : DRILL_ITEMS)) return repeatWrong(s, ctx, now);
  // Due cards first, then the ones due soonest. Cards that are not due are practised without
  // changing their schedule (see isRated).
  const pool = ctx.cards.filter((c) => !s.last.has(c.id) && eligible(c, kind, ctx)).sort(byDue);
  if (kind === 'match') {
    const modes = (['tr', 'def', 'syn', 'nv', 'vp'] as const).filter((m) => buildMatch(m, pool, [], ctx.mwes, ctx.rand));
    if (!modes.length) return repeatWrong(s, ctx, now);
    const mode = modes[s.count % modes.length]!;
    const pairs = buildMatch(mode, pool, [], ctx.mwes, ctx.rand)!;
    return { kind, cardIds: pairs.flatMap((p) => (p.cardId ? [p.cardId] : [])), pairs, mode };
  }
  return pool[0] ? { kind, cardIds: [pool[0].id] } : repeatWrong(s, ctx, now);
}

/** The next exercise, or null when the session is over. */
export function nextItem(s: SessionState, ctx: Context, now: number): Item | null {
  if (s.config.drill) return nextDrill(s, ctx, now);
  const timeUp = s.config.minutes > 0 && now - s.startedAt >= s.config.minutes * 60_000;
  if (!timeUp) {
    const learning = ctx.cards.filter((c) => isLearning(c) && c.due <= now).sort(byDue);
    const reviews =
      s.reviewed < s.config.reviewsLeft ? ctx.cards.filter((c) => c.fsrs.state === 2 && c.due <= now).sort(byDue) : [];
    const fresh =
      s.introduced.size < s.config.newLeft
        ? ctx.cards.filter((c) => c.fsrs.state === 0 && !s.introduced.has(c.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : [];
    // Learning steps first; otherwise one new card after every three reviews.
    let pick = learning[0];
    if (!pick) pick = fresh.length && (!reviews.length || s.count % 4 === 3) ? fresh[0] : reviews[0];
    // Nothing due right now: pull this session's learning cards forward instead of waiting.
    pick ??= ctx.cards.filter((c) => isLearning(c) && s.last.has(c.id) && c.due <= now + LEARN_AHEAD_MS).sort(byDue)[0];
    if (pick) return itemFor(pick, s, ctx, now);
  }
  return repeatWrong(s, ctx, now);
}

/**
 * Drill answers on new cards or cards that are not due are practice only: the schedule stays as it
 * is (a new card keeps its flashcard → matching → cloze start for a real session). Due reviews in a
 * drill still respect today's review limit; `pending` = reviews already rated in this same answer.
 */
export function isRated(s: SessionState, card: Pick<SessionCard, 'due' | 'fsrs'>, now: number, pending = 0): boolean {
  if (!s.config.drill) return true;
  if (card.fsrs.state === 0 || card.due > now) return false;
  return card.fsrs.state !== 2 || s.reviewed + pending < s.config.reviewsLeft;
}

/**
 * Updates the session after an answer. `before` = the FSRS state before this answer of each card
 * whose schedule changed (practice answers are left out, so they count neither as new nor as review).
 */
export function recordItem(s: SessionState, item: Item, results: Map<string, boolean>, before: Map<string, SessionCard['fsrs']['state']>): void {
  s.count++;
  for (const [id, ok] of results) {
    s.last.set(id, ok);
    if (item.repeat) s.repeated.add(id);
    const st = before.get(id);
    if (st === 0) s.introduced.add(id);
    if (st === 2) s.reviewed++;
  }
}

/** Cards a session would show now: learning + due reviews (within the limit) + new (within the limit). */
export function dueCounts(cards: SessionCard[], now: number, newLeft: number, reviewsLeft: number) {
  const learning = cards.filter((c) => isLearning(c) && c.due <= now).length;
  const reviews = Math.min(reviewsLeft, cards.filter((c) => c.fsrs.state === 2 && c.due <= now).length);
  const fresh = Math.min(newLeft, cards.filter((c) => c.fsrs.state === 0).length);
  return { learning, reviews, fresh, total: learning + reviews + fresh };
}
