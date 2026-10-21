// FSRS scheduling (spec "Vocabulary trainer") on top of ts-fsrs, plus the exercise result → rating
// mapping. Pure: no IndexedDB, so it runs in the node unit tests.
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card, type Grade, type State } from 'ts-fsrs';

/** A ts-fsrs card with dates as ISO strings, so it survives IndexedDB and the JSON backup unchanged. */
export interface FsrsCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3; // New / Learning / Review / Relearning
  last_review?: string;
}

export type Grade4 = 1 | 2 | 3 | 4; // Again / Hard / Good / Easy
export type Phase = 'new' | 'learning' | 'young' | 'mature';

/** Anki's convention: a card is mature once its interval reaches 21 days. */
export const MATURE_DAYS = 21;
/** The learning day starts at 04:00 local time, so a late-night session still counts as "today". */
export const DAY_START_HOUR = 4;

// Short-term steps: Good on a new card → 5 min → 10 min → days, so it is shown three times in one
// session (flashcard → matching → cloze). Again → 1 min. Relearning once after 10 min. Fuzz spreads
// long intervals so cards saved together do not stay together.
const scheduler = fsrs(
  generatorParameters({ enable_fuzz: true, learning_steps: ['1m', '5m', '10m'], relearning_steps: ['10m'] }),
);

function toStored(c: Card): FsrsCard {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as FsrsCard['state'],
    ...(c.last_review ? { last_review: c.last_review.toISOString() } : {}),
  };
}

function toCard(f: FsrsCard): Card {
  return { ...f, due: new Date(f.due), state: f.state as State, last_review: f.last_review ? new Date(f.last_review) : undefined };
}

export function newFsrs(now = new Date()): FsrsCard {
  return toStored(createEmptyCard(now));
}

export function phaseOf(f: FsrsCard): Phase {
  if (f.state === 0) return 'new';
  if (f.state === 1 || f.state === 3) return 'learning';
  return f.scheduled_days >= MATURE_DAYS ? 'mature' : 'young';
}

export function schedule(f: FsrsCard, now: Date, rating: Grade4): FsrsCard {
  return toStored(scheduler.next(toCard(f), now, rating as Grade).card);
}

/** Time until the next review for each button (flashcard: "Tekrar 1 dk · İyi 10 dk …"). */
export function previewIntervals(f: FsrsCard, now: Date): Record<Grade4, number> {
  const p = scheduler.repeat(toCard(f), now);
  const ms = (r: Grade4) => p[r as Grade].card.due.getTime() - now.getTime();
  return { 1: ms(Rating.Again), 2: ms(Rating.Hard), 3: ms(Rating.Good), 4: ms(Rating.Easy) };
}

export interface ExerciseResult {
  correct: boolean;
  hinted?: boolean; // used the hint ("ipucu")
  partial?: boolean; // typo, or the right word with the wrong article
  ms: number;
}

/** Answer slower than this counts as "slow" (Hard). Typing takes longer than tapping. */
export const SLOW_MS = { choice: 10_000, typing: 20_000 } as const;
const FAST_MS = { choice: 4_000, typing: 8_000 } as const;

/** Spec: wrong = Again, slow or hinted = Hard, correct = Good, correct and fast on a mature card = Easy. */
export function ratingFor(r: ExerciseResult, phase: Phase, input: keyof typeof SLOW_MS): Grade4 {
  if (!r.correct) return 1;
  if (r.hinted || r.partial || r.ms > SLOW_MS[input]) return 2;
  if (phase === 'mature' && r.ms < FAST_MS[input]) return 4;
  return 3;
}

export function dayStart(now: Date): Date {
  const d = new Date(now);
  d.setHours(DAY_START_HOUR, 0, 0, 0);
  if (now < d) d.setDate(d.getDate() - 1);
  return d;
}

/** "1 dk", "10 dk", "5 sa", "3 g", "2 ay", "1,5 yıl". */
export function formatInterval(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} dk`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} sa`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} g`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} ay`;
  return `${(d / 365).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} yıl`;
}

/** "der Plan" → "Plan", "sich beschweren" → "beschweren"; multi-word expressions stay as they are. */
export function lemmaOfDisplay(display: string): string {
  return display.replace(/^(der|die|das|sich) (?=\S+$)/, '');
}
