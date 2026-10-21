// Unit tests for the dictionary importer, with small synthetic Wiktionary-like entries.
//   npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeKey, shardFile, shardFor, translit } from '../../shared/dict.ts';
import {
  buildShards,
  candidateForms,
  cleanForm,
  nounGender,
  extractDe,
  extractEn,
  isKeptLemma,
  keepForm,
  mergeLemma,
  parseRektion,
  rankLemmas,
  type RawEntry,
} from './lib.ts';

const deHaus: RawEntry = {
  word: 'Haus',
  pos: 'noun',
  lang_code: 'de',
  tags: ['neuter'],
  senses: [{ glosses: ['zum Wohnen dienendes Gebäude'] }],
  forms: [
    { form: 'H.', tags: ['abbreviation'] },
    { form: 'Häuschen', tags: ['diminutive'] },
    { form: 'Haus', tags: ['nominative', 'singular'] },
    { form: 'Häuser', tags: ['nominative', 'plural'] },
    { form: 'Hauses', tags: ['genitive', 'singular'] },
    { form: 'Häusern', tags: ['dative', 'plural'] },
  ],
  translations: [
    { lang_code: 'tr', word: 'ev' },
    { lang_code: 'en', word: 'house' },
    { lang_code: 'tr', word: 'ev' },
  ],
};

const enAnfangen: RawEntry = {
  word: 'anfangen',
  pos: 'verb',
  lang_code: 'de',
  senses: [
    { glosses: ['to begin; to commence'], tags: ['intransitive'] },
    { glosses: ['to begin, to start [with mit (+ dative) ‘something’]'] },
  ],
  forms: [
    { form: 'fängt an', tags: ['present', 'singular', 'third-person'] },
    { form: 'fing an', tags: ['past'] },
    { form: 'angefangen', tags: ['participle', 'past'] },
    { form: 'haben', tags: ['auxiliary'] },
    { form: 'sein', tags: ['Northwest-German', 'auxiliary', 'colloquial'] },
    { form: 'angefangen haben', tags: ['infinitive', 'perfect'], source: 'conjugation' },
    { form: 'fang an!', tags: ['imperative'], source: 'conjugation' },
  ],
};

test('nouns: gender, plural, genitive, Turkish translations from de.wiktionary', () => {
  const de = extractDe(deHaus);
  assert.equal(de.g, 'n');
  assert.equal(de.pl, 'Häuser');
  assert.equal(de.gen, 'Hauses');
  assert.deepEqual(de.tr, ['ev']);
  assert.equal(de.de, 'zum Wohnen dienendes Gebäude');
});

test('synonyms, antonyms and translations prefer the first numbered sense', () => {
  const de = extractDe({
    ...deHaus,
    translations: [
      { lang_code: 'tr', word: 'ev', sense_index: '1' },
      { lang_code: 'tr', word: 'meclis', sense_index: '4' },
    ],
    antonyms: [{ word: 'Auge', sense_index: '14' }],
    synonyms: [{ word: 'Gebäude', sense_index: '1, 2' }, { word: 'Wohnhaus', sense_index: '2a' }, { word: 'Familie', sense_index: '7' }],
  });
  assert.deepEqual(de.tr, ['ev']);
  assert.deepEqual(de.syn, ['Gebäude', 'Wohnhaus']);
  assert.equal(de.ant, undefined, 'antonyms of an unrelated sense (14) are dropped, not shown');
  const onlyLater = extractDe({ ...deHaus, translations: [{ lang_code: 'tr', word: 'aile', sense_index: '7' }] });
  assert.deepEqual(onlyLater.tr, ['aile'], 'translations fall back to other senses');
});

test('separable verbs: Präteritum, Partizip II, aux, prefix, Rektion from en.wiktionary', () => {
  const entry = mergeLemma('anfangen', 'v', {}, extractEn(enAnfangen));
  assert.equal(entry.prt, 'fing an');
  assert.equal(entry.pp, 'angefangen');
  assert.equal(entry.aux, 'haben', 'colloquial "sein" must be ignored');
  assert.equal(entry.sep, 'an');
  assert.deepEqual(entry.rek, ['mit + Dat.']);
});

test('candidate forms skip abbreviations/diminutives; two-word forms need the separable prefix', () => {
  const haus = candidateForms(deHaus);
  assert.ok(haus.includes('häusern'));
  assert.ok(!haus.includes('h.') && !haus.includes('häuschen'));

  const anf = candidateForms(enAnfangen);
  assert.ok(anf.includes('fing an') && anf.includes('angefangen') && anf.includes('fang an'));
  assert.ok(!anf.includes('haben'), 'auxiliary rows are not forms');
  assert.ok(keepForm('fing an', 'an'));
  assert.ok(!keepForm('angefangen haben', 'an'));
  assert.ok(!keepForm('fing an', undefined));
});

test('lemma filter drops names, form-of entries, affixes and archaic-only words', () => {
  assert.ok(isKeptLemma(deHaus));
  assert.ok(isKeptLemma({ ...deHaus, word: 'E-Mail' }), 'inner hyphen is fine');
  assert.ok(!isKeptLemma({ ...deHaus, pos: 'name', word: 'Berlin' }));
  assert.ok(!isKeptLemma({ ...deHaus, word: '-ung' }));
  assert.ok(!isKeptLemma({ ...deHaus, lang_code: 'en' }));
  assert.ok(!isKeptLemma({ word: 'fing', pos: 'verb', lang_code: 'de', senses: [{ form_of: [{ word: 'fangen' }] }] }));
  assert.ok(!isKeptLemma({ word: 'Weib', pos: 'noun', lang_code: 'de', senses: [{ glosses: ['x'], tags: ['archaic'] }] }));
});

test('Rektion parsing', () => {
  assert.deepEqual(parseRektion(['to complain [with über (+ accusative) ‘about’]']), ['über + Akk.']);
  assert.deepEqual(parseRektion(['to help (+ dative)']), ['+ Dat.']);
  assert.deepEqual(parseRektion(['to go']), []);
});

test('shards stay under the limit and every key is found via shardFor', () => {
  const map = new Map<string, string>();
  for (let i = 0; i < 3000; i++) map.set(`ge${String.fromCharCode(97 + (i % 26))}wort${i}`, 'x'.repeat(40));
  map.set('ge', 'exact');
  map.set('äpfel', 'umlaut');
  map.set('100', 'number');
  const shards = buildShards(map, 4000);
  const prefixes = new Set(shards.keys());
  for (const [prefix, obj] of shards) assert.ok(Buffer.byteLength(JSON.stringify(obj)) <= 4000 || prefix.length >= 8);
  for (const key of map.keys()) {
    const p = shardFor(key, prefixes);
    assert.ok(p && shards.get(p)![key] !== undefined, `key ${key} not in shard ${p}`);
  }
  assert.equal(translit('Häuser'.toLowerCase()), 'haeuser');
});

test('frequency ranks credit every lemma a form can belong to', () => {
  const ids: Record<string, string[]> = { fing: ['fangen:v'], fangen: ['fangen:v'], häuser: ['Haus:n'] };
  const ranks = rankLemmas(
    [['häuser', 10], ['fing', 3], ['fangen', 4]],
    (k) => ids[k] ?? [],
  );
  assert.equal(ranks.get('Haus:n'), 1);
  assert.equal(ranks.get('fangen:v'), 2);
});

test('table cells lose a leading article or pronoun', () => {
  assert.equal(cleanForm('des Falls'), 'Falls');
  assert.equal(cleanForm('die Fälle'), 'Fälle');
  assert.equal(cleanForm('er/sie/es fiel vor'), 'fiel vor');
  assert.equal(cleanForm('ich maßschneiderte'), 'maßschneiderte');
  assert.equal(cleanForm('fang an!'), 'fang an');
  assert.equal(cleanForm('Dieb'), 'Dieb', 'only whole leading words are removed');
});

test('helper verb: regional "sein" is ignored, en wins over an ambiguous de value', () => {
  const de = extractDe({
    word: 'stehen',
    pos: 'verb',
    lang_code: 'de',
    forms: [
      { form: 'haben', tags: ['auxiliary', 'perfect'] },
      { form: 'sein', tags: ['auxiliary', 'perfect'], raw_tags: ['süddeutsch'] },
    ],
  });
  assert.equal(de.aux, 'haben');
  const merged = mergeLemma('anfangen', 'v', { aux: 'haben/sein' }, { aux: 'haben' });
  assert.equal(merged.aux, 'haben');
  assert.equal(mergeLemma('fahren', 'v', { aux: 'haben/sein' }, {}).aux, 'haben/sein');
});

test('Windows-reserved shard names and NFC keys', () => {
  assert.equal(shardFile('aux'), 'aux~');
  assert.equal(shardFile('com1'), 'com1~');
  assert.equal(shardFile('auxi'), 'auxi');
  assert.equal(normalizeKey('Häuser'), 'häuser', 'decomposed umlaut');
});

test('noun gender: first listed gender wins for der/das words', () => {
  assert.equal(nounGender(['masculine', 'neuter']), 'm');
  assert.equal(nounGender(['strong', 'feminine']), 'f');
  assert.equal(nounGender(['plural']), undefined);
});
