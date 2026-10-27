// Milestone 10 stats. Times are built in local time, so the tests pass in any time zone.
//   npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newFsrs, type FsrsCard } from './srs.ts';
import { dayKey, phaseCounts, retention, reviewsPerDay, streak, weekKey, wordsPerWeek } from './stats.ts';

/** Local time: October 2026 (month 9), day `d`, hour `h`. Tuesday 27 October 2026 is "today". */
const at = (d: number, h = 10, month = 9) => new Date(2026, month, d, h);
const NOW = at(27, 20);
const review = (d: Date, rating: 1 | 2 | 3 | 4 = 3, stateBefore: 0 | 1 | 2 | 3 = 2, practice?: boolean) => ({
  at: d.toISOString(), rating, stateBefore, practice,
});
const reading = (d: Date, words?: number) => ({ finishedAt: d.toISOString(), words });

test('a learning day starts at 04:00; weeks start on Monday', () => {
  assert.equal(dayKey(at(27, 3)), '2026-10-26', '03:00 still belongs to the evening before');
  assert.equal(dayKey(at(27, 4)), '2026-10-27');
  assert.equal(weekKey(at(27)), '2026-10-26');
  assert.equal(weekKey(at(26, 3)), '2026-10-19', 'Monday 03:00 is still Sunday → the week before');
  assert.equal(weekKey(at(1, 10, 10)), '2026-10-26', 'Sunday 1 November');
});

test('cards by state', () => {
  const f = (o: Partial<FsrsCard>) => ({ fsrs: { ...newFsrs(at(1)), ...o } });
  const counts = phaseCounts([f({}), f({ state: 1 }), f({ state: 3 }), f({ state: 2, scheduled_days: 5 }), f({ state: 2, scheduled_days: 21 })]);
  assert.deepEqual(counts, { new: 1, learning: 2, young: 1, mature: 1 });
});

test('reviews per day: last 30 days, practice left out, across the DST change on 25 October', () => {
  const days = reviewsPerDay(
    [review(at(27)), review(at(27, 2)), review(at(25, 12)), review(at(24), 3, 2, true), review(at(20, 10, 8))],
    NOW,
  );
  assert.equal(days.length, 30);
  assert.equal(days.at(-1)!.day, '2026-10-27');
  assert.equal(days[0]!.day, '2026-09-28');
  assert.equal(new Set(days.map((d) => d.day)).size, 30, 'no day twice or missing around the clock change');
  const n = Object.fromEntries(days.map((d) => [d.day, d.n]));
  assert.equal(n['2026-10-27'], 1);
  assert.equal(n['2026-10-26'], 1, '02:00 on the 27th counts for the 26th');
  assert.equal(n['2026-10-25'], 1);
  assert.equal(n['2026-10-24'], 0, 'free practice is not a review');
  assert.equal(days.reduce((s, d) => s + d.n, 0), 3, '20 September is outside the 30 days');
});

test('retention: only graduated cards, Hard/Good/Easy = remembered, no practice', () => {
  assert.equal(retention([], NOW), null);
  const r = retention(
    [
      review(at(27), 3), review(at(26), 2), review(at(25), 4), review(at(24), 1),
      review(at(27), 1, 1), // learning step: left out
      review(at(27), 1, 2, true), // free practice: left out
      review(at(1, 10, 8), 1), // 1 September: too old
    ],
    NOW,
  );
  assert.deepEqual(r, { rate: 0.75, n: 4 });
});

test('streak: days in a row ending today; no study yet today keeps yesterday’s streak', () => {
  // Active learning days: 27, 26, 24 (02:00 on the 25th), 23 (a finished text). The 25th is missing.
  const reviews = [review(at(27)), review(at(26, 23)), review(at(25, 2))];
  const readings = [reading(at(23, 9))];
  assert.equal(streak(reviews, readings, NOW), 2);
  assert.equal(streak(reviews, readings, at(28, 20)), 2, 'nothing yet on the 28th: the streak is still alive');
  assert.equal(streak(reviews, readings, at(29, 20)), 0, 'the 28th passed without study');
  assert.equal(streak([...reviews, review(at(25, 18), 1, 0, true)], readings, NOW), 5, 'free practice on the 25th fills the gap');
  assert.equal(streak([], [], NOW), 0);
});

test('words read per week: 8 weeks from Monday, old rows without a word count add nothing', () => {
  const weeks = wordsPerWeek(
    [reading(at(27), 300), reading(at(26, 9), 200), reading(at(25), 100), reading(at(20), undefined), reading(at(1, 10, 8), 999)],
    NOW,
  );
  assert.equal(weeks.length, 8);
  assert.deepEqual(weeks.at(-1), { week: '2026-10-26', words: 500 });
  assert.deepEqual(weeks.at(-2), { week: '2026-10-19', words: 100 });
  assert.equal(weeks[0]!.week, '2026-09-07');
  assert.equal(weeks.reduce((s, w) => s + w.words, 0), 600, '1 September is outside the 8 weeks');
});
