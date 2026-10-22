// Session composer (spec "Session composer"): which cards come next. Pure: the screen passes the
// current cards and the time, so it runs in the node unit tests.
import { buildMatch, MATCH_MAX, modesFor, pairFor, type CardLike, type MatchMode, type MweLike, type Pair, type Rand } from './exercises.ts';
import type { CardRow } from './db';

// Enes, 2026-10-22: vocabulary practice is matching only — no flashcard, cloze, artikel,
// production, word family or listen & type. New words go straight into matching rounds.

export type SessionCard = CardLike & Pick<CardRow, 'fsrs' | 'due' | 'createdAt'>;

export interface Context {
  cards: SessionCard[];
  mwes: MweLike[]; // expressions from downloaded texts (matching fillers)
  rand: Rand;
}

/** One matching round. */
export interface Item {
  cardIds: string[]; // rated cards (the pairs that have a cardId)
  pairs: Pair[];
  mode: MatchMode;
  repeat?: boolean; // the end-of-session repeat of a wrong card
}

export interface SessionConfig {
  minutes: number; // 0 = "all due"
  newLeft: number; // today's remaining new-card limit
  reviewsLeft: number; // today's remaining review limit
  free?: boolean; // free practice (Kelimeler → Serbest eşleştirme): any cards, schedule changes only for due ones
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

/** A learning card waits at most this long for its next step; Anki's "learn ahead" limit. */
export const LEARN_AHEAD_MS = 20 * 60_000;
const FREE_ROUNDS = 2;

export function startSession(config: SessionConfig, now: number): SessionState {
  return { config, startedAt: now, count: 0, introduced: new Set(), reviewed: 0, last: new Map(), repeated: new Set() };
}

/** A card can take part in matching (it has a Turkish meaning, a definition, a synonym or an expression split). */
export const matchable = (card: CardLike): boolean => modesFor(card).length > 0;

/**
 * Matching modes to try for a round, best first: the first card's expression mode, then the others
 * rotated by review count. The first mode that yields 5 pairs wins — a mode most cards can't fill
 * (e.g. "Wort ↔ Definition") must not cancel the round.
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

/**
 * One matching round: up to 6 of `cands` (in priority order) as rated pairs, filled up to 5–6 with
 * other cards and text expressions as unrated pairs. Null when not even 5 pairs can be built.
 */
function round(cands: SessionCard[], ctx: Context, repeat = false): Item | null {
  const first = cands[0];
  if (!first) return null;
  for (const mode of matchModes(first)) {
    const rated = cands.filter((c) => pairFor(c, mode)).slice(0, MATCH_MAX);
    const pairs = buildMatch(mode, rated, ctx.cards.filter((c) => !rated.includes(c)), ctx.mwes, ctx.rand);
    if (pairs) return { cardIds: pairs.flatMap((p) => (p.cardId ? [p.cardId] : [])), pairs, mode, ...(repeat ? { repeat } : {}) };
  }
  return null;
}

/** At the end, every card that was wrong in its last round comes back once in one more round. */
function repeatWrong(s: SessionState, ctx: Context): Item | null {
  for (const [id, ok] of s.last) {
    if (ok || s.repeated.has(id)) continue;
    const card = ctx.cards.find((c) => c.id === id);
    const item = card && round([card], ctx, true);
    if (item) return item;
  }
  return null;
}

/**
 * The next matching round, or null when the session is over. Learning steps first, then due reviews
 * with one new card after every three, within today's limits. A new card meets three rounds in one
 * session (FSRS steps 5 min → 10 min → days) before it waits for tomorrow.
 */
export function nextItem(s: SessionState, ctx: Context, now: number): Item | null {
  const cards = ctx.cards.filter(matchable);
  if (s.config.free) {
    if (s.count >= FREE_ROUNDS) return repeatWrong(s, ctx);
    // Due cards first, then the ones due soonest; cards that are not due are practice (see isRated).
    const pool = cards.filter((c) => !s.last.has(c.id)).sort(byDue);
    return round(pool, ctx) ?? repeatWrong(s, ctx);
  }
  const timeUp = s.config.minutes > 0 && now - s.startedAt >= s.config.minutes * 60_000;
  if (!timeUp) {
    const learning = cards.filter((c) => isLearning(c) && c.due <= now).sort(byDue);
    const reviews = cards
      .filter((c) => c.fsrs.state === 2 && c.due <= now)
      .sort(byDue)
      .slice(0, Math.max(0, s.config.reviewsLeft - s.reviewed));
    const fresh = cards
      .filter((c) => c.fsrs.state === 0 && !s.introduced.has(c.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(0, s.config.newLeft - s.introduced.size));
    const mixed: SessionCard[] = [];
    let r = 0;
    let f = 0;
    while (r < reviews.length || f < fresh.length) {
      const takeNew = f < fresh.length && (r >= reviews.length || mixed.length % 4 === 3);
      mixed.push(takeNew ? fresh[f++]! : reviews[r++]!);
    }
    let cands = [...learning, ...mixed];
    // Nothing due right now: pull this session's learning cards forward instead of waiting.
    if (!cands.length) cands = cards.filter((c) => isLearning(c) && s.last.has(c.id) && c.due <= now + LEARN_AHEAD_MS).sort(byDue);
    const item = round(cands, ctx);
    if (item) return item;
  }
  return repeatWrong(s, ctx);
}

/**
 * Free practice on new cards or cards that are not due is practice only: the schedule stays as it is
 * (a new card keeps its learning start for a real session). Due reviews still respect today's review
 * limit; `pending` = reviews already rated in this same round.
 */
export function isRated(s: SessionState, card: Pick<SessionCard, 'due' | 'fsrs'>, now: number, pending = 0): boolean {
  if (!s.config.free) return true;
  if (card.fsrs.state === 0 || card.due > now) return false;
  return card.fsrs.state !== 2 || s.reviewed + pending < s.config.reviewsLeft;
}

/**
 * Updates the session after a round. `before` = the FSRS state before this round of each card whose
 * schedule changed (practice answers are left out, so they count neither as new nor as review).
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
export function dueCounts(all: SessionCard[], now: number, newLeft: number, reviewsLeft: number) {
  const cards = all.filter(matchable);
  const learning = cards.filter((c) => isLearning(c) && c.due <= now).length;
  const reviews = Math.min(reviewsLeft, cards.filter((c) => c.fsrs.state === 2 && c.due <= now).length);
  const fresh = Math.min(newLeft, cards.filter((c) => c.fsrs.state === 0).length);
  return { learning, reviews, fresh, total: learning + reviews + fresh };
}
