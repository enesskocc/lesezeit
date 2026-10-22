// Turkish meanings from Claude: entry selection and answer checks. Synthetic entries only.
//   npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LemmaEntry } from '../../shared/dict.ts';
import { acceptAnswer, candidates, promptLine, type Overlay } from './translate-tr.ts';

const overlay = (tr: Record<string, string[]> = {}): Overlay => ({ version: 1, model: 'sonnet', updatedAt: '', tr });
const schaetzen: LemmaEntry = { w: 'schätzen', p: 'v', rank: 900, de: 'den Wert ungefähr bestimmen', en: ['to estimate', 'to value'] };
const schaemen: LemmaEntry = { w: 'schämen', p: 'v', refl: true, rank: 2500 };
const kommen: LemmaEntry = { w: 'kommen', p: 'v', rank: 40, tr: ['gelmek'] };
const rare: LemmaEntry = { w: 'Quarkkeulchen', p: 'n', g: 'n', rank: 90_000 };
const unranked: LemmaEntry = { w: 'Xyz', p: 'n' };

test('only frequent entries without Turkish, most frequent first, never twice', () => {
  const all = [schaemen, kommen, rare, unranked, schaetzen];
  assert.deepEqual(candidates(all, overlay(), 30_000).map((e) => e.w), ['schätzen', 'schämen']);
  assert.deepEqual(candidates(all, overlay({ 'schätzen:v': ['tahmin etmek'] }), 30_000).map((e) => e.w), ['schämen']);
  assert.deepEqual(candidates(all, overlay({ 'schätzen:v': [] }), 30_000).map((e) => e.w), ['schämen'], 'asked without result: not asked again');
});

test('prompt line carries id, part of speech, article, reflexive "sich", definition and English', () => {
  assert.deepEqual(JSON.parse(promptLine(schaetzen)), {
    id: 'schätzen:v', w: 'schätzen', pos: 'Verb', de: 'den Wert ungefähr bestimmen', en: ['to estimate', 'to value'],
  });
  assert.equal(JSON.parse(promptLine(schaemen)).w, '(sich) schämen');
  assert.equal(JSON.parse(promptLine(rare)).art, 'das');
});

test('answers: only ids of the batch, cleaned meanings, at most three', () => {
  const got = acceptAnswer([schaetzen, schaemen], {
    items: [
      { id: 'schätzen:v', tr: [' tahmin  etmek ', 'takdir etmek', 'tahmin etmek', 'değer biçmek', 'saymak'] },
      { id: 'schämen:v', tr: ['utanmak (kendinden)', 'utanmak'] },
      { id: 'kommen:v', tr: ['gelmek'] }, // not in this batch
      { id: 'schätzen:v', tr: ['ikinci kez'] }, // duplicate id: the first answer counts
    ],
  });
  assert.deepEqual([...got], [
    ['schätzen:v', ['tahmin etmek', 'takdir etmek', 'değer biçmek']],
    ['schämen:v', ['utanmak']],
  ]);
});
