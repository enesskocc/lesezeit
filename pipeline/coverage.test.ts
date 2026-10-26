// Milestone 7: known words from the phone's backup steer the daily pick. Synthetic data only.
//   npm run test:unit
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { knownLemmas, type ProgressBackup } from '../shared/backup.ts';
import type { IndexEntry } from '../shared/texts.ts';
import { coverageOf, coverageScore, readKnown } from './coverage.ts';
import { orderPool } from './daily.ts';

const BAND = [0.95, 0.99] as const;

/** Every word is its own lemma; "Xyz…" words are unknown to the dictionary (like names). */
const dict = {
  info: (w: string) => (w.startsWith('Xyz') ? { known: false, entries: [] } : { known: true, entries: [{ w, p: 'n' as const }] }),
};

const card = (id: string, state: number, scheduled_days: number) =>
  ({ id, kind: 'lemma', due: 0, fsrs: { state, scheduled_days, due: '2026-10-26T00:00:00.000Z' } }) as ProgressBackup['cards'][number];

test('known lemmas: marked known or ignored, or a mature word card — not learning cards or expressions', () => {
  const known = knownLemmas({
    wordStatus: [
      { key: 'w:haus', state: 'known', updatedAt: '' },
      { key: 'w:berlin', state: 'ignored', updatedAt: '' },
      { key: 'w:schätzen', state: 'learning', updatedAt: '' },
      { key: 'm:eine entscheidung treffen', state: 'known', updatedAt: '' },
    ],
    cards: [card('w:anfangen', 2, 30), card('w:schämen', 2, 5), card('w:morgen', 1, 0)],
  });
  assert.deepEqual([...known].sort(), ['anfangen', 'berlin', 'haus']);
});

test('readKnown reads backup/progress.json; no or broken backup → null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-cov-'));
  assert.equal(readKnown(dir), null);
  fs.mkdirSync(path.join(dir, 'backup'));
  fs.writeFileSync(path.join(dir, 'backup/progress.json'), JSON.stringify({ version: 1 }));
  assert.equal(readKnown(dir), null, 'invalid backup is ignored');
  const backup: ProgressBackup = {
    version: 1, exportedAt: '2026-10-26T08:00:00.000Z', reviewLog: [], readingLog: [], cards: [],
    wordStatus: [{ key: 'w:haus', state: 'known', updatedAt: '2026-10-26T08:00:00.000Z' }],
  };
  fs.writeFileSync(path.join(dir, 'backup/progress.json'), JSON.stringify(backup));
  assert.deepEqual([...readKnown(dir)!], ['haus']);
});

test('coverage counts dictionary words only; score prefers the middle of the band', () => {
  const known = new Set(['eins', 'zwei', 'drei']);
  assert.equal(coverageOf(['eins zwei drei vier', 'Xyzname eins'], dict, known), 4 / 5);
  assert.equal(coverageOf(['Xyzname'], dict, known), null);
  assert.ok(coverageScore(0.97, BAND) < coverageScore(0.95, BAND));
  assert.ok(coverageScore(0.95, BAND) < coverageScore(1, BAND), 'inside the band beats too easy');
  assert.ok(coverageScore(0.9, BAND) < coverageScore(0.5, BAND));
  assert.equal(coverageScore(null, BAND), 2);
});

// Spec M7 "Done when: a word marked known on the phone lowers its weight in the next day's picks."
test('ACCEPTANCE: marking one word known changes the next pick', () => {
  const twenty = (prefix: string) => Array.from({ length: 20 }, (_, i) => `${prefix}${String.fromCharCode(97 + i)}`);
  // A: 18 known words + "gemeinsam" + one more unknown. B: 19 known words + "gemeinsam".
  const a = [...twenty('alpha').slice(0, 18), 'gemeinsam', 'neuwort'];
  const b = [...twenty('beta').slice(0, 19), 'gemeinsam'];
  const known = new Set([...a.slice(0, 18), ...b.slice(0, 19)]);
  const texts: Record<string, string[]> = { A: [a.join(' ')], B: [b.join(' ')] };
  const entry = (id: string, date: string) => ({ id, date, level: 'B2', levelHeuristic: 'B2' }) as IndexEntry;
  const pool = [entry('A', '2026-10-26'), entry('B', '2026-10-25')];
  const pick = (k: Set<string>) => orderPool(pool, 'B2', (e) => coverageOf(texts[e.id]!, dict, k), BAND)[0]!.id;

  assert.equal(coverageOf(texts.A!, dict, known), 0.9);
  assert.equal(coverageOf(texts.B!, dict, known), 0.95);
  assert.equal(pick(known), 'B', 'B is in the 95–99 % band, A is too hard');

  known.add('gemeinsam'); // Enes taps "Biliyorum" on "gemeinsam"
  assert.equal(coverageOf(texts.A!, dict, known), 0.95);
  assert.equal(coverageOf(texts.B!, dict, known), 1);
  assert.equal(pick(known), 'A', 'B is now too easy, A moved into the band');

  // Without a backup the pick is by level and date only (newest first), as before milestone 7.
  assert.equal(orderPool(pool, 'B2', () => null, BAND)[0]!.id, 'A');
});
