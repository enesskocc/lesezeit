// Spec "Stats": cards by state, reviews per day, retention, streak, words read per week. Pure: the
// screen passes the rows and the time, so it runs in the node unit tests. Days start at 04:00 like
// the review limits, so a session after midnight still counts for the evening before.
import type { ReadingLogRow, ReviewLogRow } from './db';
import { dayStart, phaseOf, type FsrsCard, type Phase } from './srs.ts';

type Review = Pick<ReviewLogRow, 'at' | 'rating' | 'stateBefore' | 'practice'>;
type Reading = Pick<ReadingLogRow, 'finishedAt' | 'words'>;

/** "2026-10-27" for the learning day `d` belongs to (local time, day starts 04:00). */
export function dayKey(d: Date): string {
  const s = dayStart(d);
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
}

/** Learning-day keys from `days - 1` days ago up to today, oldest first. */
function lastDays(now: Date, days: number): string[] {
  const start = dayStart(now);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() - (days - 1 - i));
    return dayKey(d);
  });
}

export function phaseCounts(cards: { fsrs: FsrsCard }[]): Record<Phase, number> {
  const out: Record<Phase, number> = { new: 0, learning: 0, young: 0, mature: 0 };
  for (const c of cards) out[phaseOf(c.fsrs)]++;
  return out;
}

/** Rated reviews per learning day (free practice does not count, like the daily limit). */
export function reviewsPerDay(reviews: Review[], now: Date, days = 30): { day: string; n: number }[] {
  const counts = new Map(lastDays(now, days).map((d) => [d, 0]));
  for (const r of reviews) {
    if (r.practice) continue;
    const k = dayKey(new Date(r.at));
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return [...counts].map(([day, n]) => ({ day, n }));
}

/**
 * Share of reviews of graduated cards (FSRS state Review before the answer) that were remembered
 * (Hard, Good or Easy) in the last `days` days; null without such reviews. Learning steps and free
 * practice are left out: they would make the number look better than memory is.
 */
export function retention(reviews: Review[], now: Date, days = 30): { rate: number; n: number } | null {
  const from = new Set(lastDays(now, days));
  let n = 0;
  let kept = 0;
  for (const r of reviews) {
    if (r.practice || r.stateBefore !== 2 || !from.has(dayKey(new Date(r.at)))) continue;
    n++;
    if (r.rating >= 2) kept++;
  }
  return n ? { rate: kept / n, n } : null;
}

/**
 * Days in a row with any study (a review, free practice or a finished text), ending today. A day
 * without study yet today does not break the streak until the day is over.
 */
export function streak(reviews: Pick<Review, 'at'>[], readings: Reading[], now: Date): number {
  const active = new Set([...reviews.map((r) => dayKey(new Date(r.at))), ...readings.map((r) => dayKey(new Date(r.finishedAt)))]);
  const d = dayStart(now);
  if (!active.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (active.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** Monday of the learning week `d` belongs to, as a day key. */
export function weekKey(d: Date): string {
  const s = dayStart(d);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return dayKey(s);
}

/** Words of finished texts per week (Monday start), the last `weeks` weeks, oldest first. */
export function wordsPerWeek(readings: Reading[], now: Date, weeks = 8): { week: string; words: number }[] {
  const keys = Array.from({ length: weeks }, (_, i) => {
    const d = dayStart(now);
    d.setDate(d.getDate() - 7 * (weeks - 1 - i));
    return weekKey(d);
  });
  const sums = new Map(keys.map((k) => [k, 0]));
  for (const r of readings) {
    const k = weekKey(new Date(r.finishedAt));
    if (sums.has(k)) sums.set(k, sums.get(k)! + (r.words ?? 0));
  }
  return [...sums].map(([week, words]) => ({ week, words }));
}
