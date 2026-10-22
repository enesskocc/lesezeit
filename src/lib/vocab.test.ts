// Milestone 6 logic: FSRS, matching and the session composer (matching only, Enes 2026-10-22). Synthetic cards only.
//   npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildMatch, splitMwe, tokenSpans,
  type CardLike,
} from './exercises.ts';
import { dueCounts, isRated, nextItem, recordItem, startSession, type Context, type SessionCard } from './session.ts';
import { dayStart, formatInterval, lemmaOfDisplay, newFsrs, phaseOf, schedule, type Grade4 } from './srs.ts';

const T0 = Date.parse('2026-10-22T08:00:00Z');
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function card(id: string, over: Partial<SessionCard> = {}): SessionCard {
  const fsrs = newFsrs(new Date(T0 - 3600_000));
  const lemma = over.lemma ?? id;
  return {
    id: `w:${id.toLowerCase()}`, kind: 'lemma', display: lemma, lemma, meaning_tr: `tr-${id}`,
    contexts: [{ textId: 't1', date: '2026-10-21', s: 0, sentence: `Hier steht ${lemma} im Satz.`, tokens: [2], forms: [lemma] }],
    createdAt: new Date(T0 - 3600_000).toISOString(), fsrs, due: Date.parse(fsrs.due), ...over,
  };
}

// ---------------------------------------------------------------- srs

test('FSRS: a new card goes through the 5 min / 10 min steps, then days; Again brings it back fast', () => {
  const now = new Date(T0);
  let f = newFsrs(now);
  assert.equal(phaseOf(f), 'new');
  f = schedule(f, now, 3);
  assert.equal(phaseOf(f), 'learning');
  assert.equal(Date.parse(f.due) - T0, 5 * 60_000, 'Good on a new card → 5 min');
  f = schedule(f, new Date(Date.parse(f.due)), 3);
  assert.equal(f.state, 1, 'still learning: one more step');
  f = schedule(f, new Date(Date.parse(f.due)), 3);
  assert.equal(f.state, 2, 'graduated to review');
  assert.ok(Date.parse(f.due) - T0 >= 86_400_000, 'next review at least a day later');
  const lapse = schedule(f, new Date(Date.parse(f.due)), 1);
  assert.equal(lapse.state, 3);
  assert.equal(lapse.lapses, 1);
  assert.equal(Date.parse(lapse.due) - Date.parse(f.due), 10 * 60_000, 'relearning step 10 min');
});

test('day starts at 04:00 local time; intervals in Turkish; lemma from display', () => {
  const lateNight = new Date(2026, 9, 22, 2, 30);
  assert.equal(dayStart(lateNight).getDate(), 21);
  assert.equal(dayStart(new Date(2026, 9, 22, 9, 0)).getHours(), 4);
  assert.equal(formatInterval(60_000), '1 dk');
  assert.equal(formatInterval(3 * 86_400_000), '3 g');
  assert.equal(formatInterval(400 * 86_400_000), '1,1 yıl');
  assert.equal(lemmaOfDisplay('der Plan'), 'Plan');
  assert.equal(lemmaOfDisplay('sich beschweren'), 'beschweren');
  assert.equal(lemmaOfDisplay('sich verlassen auf'), 'sich verlassen auf');
});

// ---------------------------------------------------------------- exercises

test('saved positions point at the tapped occurrence of a repeated word', () => {
  const sentence = 'Die Frau sagt, die Frau habe recht.';
  const toks = ['Die', 'Frau', 'sagt', ',', 'die', 'Frau', 'habe', 'recht', '.'].map((s) => ({ s }));
  assert.deepEqual(tokenSpans(sentence, toks, [5]), [[19, 23]]);
  assert.deepEqual(tokenSpans('Er fängt morgen an.', ['Er', 'fängt', 'morgen', 'an', '.'].map((s) => ({ s })), [3, 1]), [[3, 8], [16, 18]]);
  assert.equal(tokenSpans('Kurz.', [{ s: 'Lang' }], [0]), undefined, 'tokens that do not fit the sentence give no positions');
});

test('matching: 5–6 unique pairs, rated cards first, expression fillers for Nomen ↔ Verb', () => {
  const cards = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((x) => card(x));
  const pairs = buildMatch('tr', cards.slice(0, 2), cards.slice(2), [], rand)!;
  assert.equal(pairs.length, 6);
  assert.deepEqual(pairs.filter((p) => p.cardId).map((p) => p.cardId), ['w:a', 'w:b'], 'only the rated cards carry a cardId');
  assert.equal(buildMatch('tr', cards.slice(0, 4), [], [], rand), null, 'fewer than 5 pairs → no matching');
  const dup = [...cards.slice(0, 4), card('X', { meaning_tr: 'tr-A' })];
  assert.equal(buildMatch('tr', dup, [], [], rand), null, 'two cards with the same meaning are not both used');

  assert.deepEqual(splitMwe('eine Entscheidung treffen'), ['eine Entscheidung', 'treffen']);
  const nvv: CardLike = { ...card('x'), id: 'm:eine entscheidung treffen', kind: 'mwe', display: 'eine Entscheidung treffen', lemma: 'eine Entscheidung treffen', mweKind: 'nvv' };
  const mwes = ['Abschied nehmen', 'in Kraft treten', 'Bescheid geben', 'zur Verfügung stellen', 'Rücksicht nehmen'].map((de) => ({ de, tr: de, kind: 'nvv' as const }));
  const nv = buildMatch('nv', [nvv], [], mwes, rand)!;
  assert.equal(nv.length, 5, '"nehmen" twice → one of them is left out');
  assert.deepEqual(nv[0], { id: nvv.id, cardId: nvv.id, left: 'eine Entscheidung', right: 'treffen', rightLang: 'de' });
});

// ---------------------------------------------------------------- session

const ctxOf = (cards: SessionCard[]): Context => ({ cards, mwes: [], rand });

/** Answers an item like the session screen does: each card gets `rating` (or `rating(id)`). */
function answer(cards: SessionCard[], item: ReturnType<typeof nextItem>, rating: Grade4 | ((id: string) => Grade4), now: number) {
  const before = new Map<string, SessionCard['fsrs']['state']>();
  const results = new Map<string, boolean>();
  for (const id of item!.cardIds) {
    const i = cards.findIndex((c) => c.id === id);
    const g = typeof rating === 'function' ? rating(id) : rating;
    before.set(id, cards[i]!.fsrs.state);
    results.set(id, g > 1);
    const fsrs = schedule(cards[i]!.fsrs, new Date(now), g);
    cards[i] = { ...cards[i]!, fsrs, due: Date.parse(fsrs.due) };
  }
  return { before, results };
}

test('a session is matching rounds only: a new card meets three rounds, then waits days', () => {
  const cards = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Eps'].map((x) => card(x));
  const ctx = ctxOf(cards);
  const s = startSession({ minutes: 0, newLeft: 15, reviewsLeft: 150 }, T0);
  const kinds = new Map<string, string[]>();
  let now = T0;
  for (let n = 0; n < 50; n++) {
    const item = nextItem(s, ctx, now);
    if (!item) break;
    for (const id of item.cardIds) kinds.set(id, [...(kinds.get(id) ?? []), 'match']);
    const { before, results } = answer(cards, item, 3, now);
    recordItem(s, item, results, before);
    now += 30_000;
  }
  for (const c of cards) {
    assert.deepEqual(kinds.get(c.id), ['match', 'match', 'match'], c.id);
    assert.equal(c.fsrs.state, 2);
    assert.ok(c.due - now > 12 * 3600_000, 'graduated: due tomorrow or later');
  }
});

test('daily limits: no more new cards than allowed, no more reviews than allowed', () => {
  const fresh = Array.from({ length: 6 }, (_, i) => card(`N${i}`));
  const due = Array.from({ length: 4 }, (_, i) => {
    const f = { ...newFsrs(new Date(T0 - 10 * 86_400_000)), state: 2 as const, scheduled_days: 3, reps: 3, due: new Date(T0 - 1000).toISOString() };
    return card(`R${i}`, { fsrs: f, due: T0 - 1000 });
  });
  assert.deepEqual(dueCounts([...fresh, ...due], T0, 2, 3), { learning: 0, reviews: 3, fresh: 2, total: 5 });
  const cards = [...fresh, ...due];
  const s = startSession({ minutes: 0, newLeft: 2, reviewsLeft: 3 }, T0);
  const ctx = ctxOf(cards);
  let now = T0;
  for (let n = 0; n < 60; n++) {
    const item = nextItem(s, ctx, now);
    if (!item) break;
    const { before, results } = answer(cards, item, 3, now);
    recordItem(s, item, results, before);
    now += 20_000;
  }
  assert.equal(s.introduced.size, 2);
  assert.equal(s.reviewed, 3);
  assert.equal(cards.filter((c) => c.fsrs.state === 0).length, 4, 'four new cards stay for tomorrow');
});

test('time limit ends the session; a wrong card is asked once more at the end', () => {
  const cards = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Eps', 'Zeta'].map((x) => card(x));
  const ctx = ctxOf(cards);
  const s = startSession({ minutes: 5, newLeft: 15, reviewsLeft: 150 }, T0);
  let now = T0;
  const seen: { id: string; repeat?: boolean; at: number }[] = [];
  for (let n = 0; n < 100; n++) {
    const item = nextItem(s, ctx, now);
    if (!item) break;
    item.cardIds.forEach((id) => seen.push({ id, repeat: item.repeat, at: now }));
    // "Alpha" is always wrong, everything else right.
    const { before, results } = answer(cards, item, (id) => (id === 'w:alpha' ? 1 : 3), now);
    recordItem(s, item, results, before);
    now += 40_000;
  }
  const repeats = seen.filter((x) => x.repeat);
  assert.equal(repeats.filter((x) => x.id === 'w:alpha').length, 1, 'wrong card repeated once at the end');
  assert.ok(repeats.every((x) => x.at >= T0 + 5 * 60_000), 'repeats come after the time is up');
  assert.ok(seen.filter((x) => !x.repeat).every((x) => x.at < T0 + 5 * 60_000), 'nothing new starts after 5 minutes');
});

test('free practice: only due, already started cards are rated; new or not-due cards are practice', () => {
  const s = startSession({ minutes: 0, newLeft: 15, reviewsLeft: 150, free: true }, T0);
  const review = { ...newFsrs(new Date(T0)), state: 2 as const };
  assert.equal(isRated(s, { fsrs: review, due: T0 - 1 }, T0), true);
  assert.equal(isRated(s, { fsrs: review, due: T0 + 1 }, T0), false);
  assert.equal(isRated(s, { fsrs: newFsrs(new Date(T0)), due: T0 - 1 }, T0), false, 'new card keeps its learning start');
  assert.equal(isRated(startSession({ minutes: 10, newLeft: 15, reviewsLeft: 150 }, T0), { fsrs: newFsrs(), due: T0 }, T0), true);
  // Free practice respects today's review limit too.
  const full = startSession({ minutes: 0, newLeft: 15, reviewsLeft: 2, free: true }, T0);
  assert.equal(isRated(full, { fsrs: review, due: T0 - 1 }, T0, 1), true);
  assert.equal(isRated(full, { fsrs: review, due: T0 - 1 }, T0, 2), false);
});

test('free practice repeats a wrong card with another matching round', () => {
  const cards = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Eps', 'Zeta'].map((x) => card(x));
  const ctx = ctxOf(cards);
  const s = startSession({ minutes: 0, newLeft: 15, reviewsLeft: 150, free: true }, T0);
  const round = nextItem(s, ctx, T0)!; // all six cards in one round, so the drill moves on to its repeats
  recordItem(s, round, new Map(round.cardIds.map((id) => [id, id !== 'w:alpha'])), new Map());
  const repeat = nextItem(s, ctx, T0)!;
  assert.equal(repeat.repeat, true);
  assert.deepEqual(repeat.cardIds, ['w:alpha']);
  assert.ok(repeat.pairs!.length >= 5);
  recordItem(s, repeat, new Map([['w:alpha', true]]), new Map());
  assert.equal(nextItem(s, ctx, T0), null);
});

test('matching falls back to another mode when the rotated one has fewer than 5 pairs (CI failure 2026-10-22)', () => {
  // Only this card has a German definition and a synonym: "Wort ↔ Definition" and "Synonym" can't be
  // filled, so its matching step must use DE ↔ TR instead of dropping to a flashcard.
  const rich = card('Alpha', { entry: { w: 'Alpha', p: 'n', de: 'erster Buchstabe', syn: ['Anfang'] } });
  rich.fsrs = { ...schedule(rich.fsrs, new Date(T0 - 600_000), 3) };
  rich.due = T0 - 1;
  const cards = [rich, ...['Beta', 'Gamma', 'Delta', 'Eps', 'Zeta'].map((x) => card(x))];
  const s = startSession({ minutes: 10, newLeft: 0, reviewsLeft: 150 }, T0);
  const item = nextItem(s, ctxOf(cards), T0)!;
  assert.equal(item.mode, 'tr');
  assert.deepEqual(item.cardIds, ['w:alpha']);
});

test('fewer than 5 matchable cards: no round; cards without any pair are left out', () => {
  const four = ['A', 'B', 'C', 'D'].map((x) => card(x));
  assert.equal(nextItem(startSession({ minutes: 10, newLeft: 15, reviewsLeft: 150 }, T0), ctxOf(four), T0), null);
  const bare = card('Leer', { meaning_tr: '' });
  assert.equal(dueCounts([...four, bare], T0, 15, 150).fresh, 4, 'a card with nothing to match is not counted');
  const item = nextItem(startSession({ minutes: 10, newLeft: 15, reviewsLeft: 150 }, T0), ctxOf([...four, card('E'), bare]), T0)!;
  assert.ok(item.pairs.length >= 5);
  assert.ok(!item.cardIds.includes('w:leer'));
});
