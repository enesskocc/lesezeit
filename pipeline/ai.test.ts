// Milestone 4 tests: the AI phase with a fake `claude` binary (pipeline/testing/fake-claude.mjs).
// No network, no subscription, synthetic sentences only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PipelineConfigSchema, type Level, type TextFile } from '../shared/texts.ts';
import { Claude, ClaudeFatalError, ClaudeLimitError } from './claude.ts';
import { aiPhase, MAX_ATTEMPTS, nextTarget } from './daily.ts';
import { FsDictionary } from './dict-fs.ts';
import { enrich, stepsFor, TextFailedError } from './enrich.ts';
import { computeHeuristics } from './heuristics.ts';
import { DataRepo } from './store.ts';
import { detokenize, tokenize } from './tokenize.ts';

const FAKE = [process.execPath, path.resolve(import.meta.dirname, 'testing/fake-claude.mjs')];
const dict = new FsDictionary(path.resolve(import.meta.dirname, '../public/dict'));
const config = (over: object = {}) => PipelineConfigSchema.parse({ claudeModel: 'fake', ...over });
const claude = (over: Partial<ConstructorParameters<typeof Claude>[0]> = {}) => new Claude({ model: 'fake', maxCalls: 100, command: FAKE, ...over });

let n = 0;
function makeText(title: string, sentences: string[], levelHeuristic: Level = 'B2', date = '2026-10-21'): TextFile {
  const id = (++n).toString(16).padStart(10, 'a');
  return {
    version: 1, id, kind: 'news', date, source: 'test', sourceName: 'Test', url: `https://example.de/${id}`, title,
    fetchedAt: `${date}T03:30:00Z`, wordCount: 300, paragraphs: [sentences.join(' ')],
    sentences: sentences.map((t) => ({ p: 0, t })), heuristics: computeHeuristics(sentences, dict), levelHeuristic, annotated: false,
  };
}

function setup(texts: TextFile[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesezeit-ai-'));
  const repo = new DataRepo(dir);
  const index = repo.index();
  for (const t of texts) repo.saveText(t, index);
  repo.saveIndex(index);
  return { dir, repo, index };
}

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) delete process.env[k];
  }
}

const noSave = () => {};

test('tokenize keeps every character so the sentence can be rebuilt exactly', () => {
  const s = 'Er fängt um 12:30 an, sagt „sie“ – und geht’s weiter? E-Mail!';
  const toks = tokenize(s);
  assert.equal(detokenize(toks), s);
  assert.deepEqual(toks.filter((t) => t.k === 'n').map((t) => t.s), ['12:30']);
  assert.ok(toks.some((t) => t.s === 'E-Mail' && t.k === 'w'));
  assert.ok(toks.some((t) => t.s === 'geht’s' && t.k === 'w'));
});

test('enrich: level, annotation with dictionary check, separable verb link, questions + check', async () => {
  const text = makeText('Neuer Plan', ['Das Haus ist alt.', 'Er fängt morgen an.', 'Viele Leute warten.']);
  const c = claude();
  await enrich(text, { claude: c, dict, model: 'fake', save: noSave });

  assert.equal(text.annotated, true);
  assert.equal(text.levelAi?.level, 'B2');
  assert.equal(c.calls, 4, 'level + 1 batch + questions + check');
  assert.ok(text.sentences.every((s) => s.tok && s.tr));
  const haus = text.sentences[0]!.tok!.find((t) => t.s === 'Haus')!;
  assert.deepEqual([haus.g, haus.pl, haus.dict, haus.flag], ['n', 'Häuser', true, undefined]);
  const toks = text.sentences[1]!.tok!;
  const fangt = toks.find((t) => t.s === 'fängt')!;
  const an = toks.find((t) => t.s === 'an')!;
  assert.equal(fangt.sep, an.i);
  assert.equal(an.sep, fangt.i);
  assert.equal(fangt.l, 'anfangen');
  assert.equal(text.questions?.length, 5);
  assert.equal(text.ai?.questionsChecked, true);
  assert.ok(text.mwes && text.mwes.length >= 1 && toks.some((t) => t.mwe));
  assert.deepEqual(stepsFor(text), { level: false, batches: [], questions: false, check: false });
  // Offline dictionary embedded for the reader: grammar of "anfangen" travels with the text.
  assert.equal(text.dict?.anfangen?.[0]?.prt, 'fing an');
  assert.equal(text.dict?.haus?.[0]?.pl, 'Häuser');
  assert.equal(text.topic, 'politik');
});

test('a gender the dictionary does not know for that noun is flagged', async () => {
  const text = makeText('Steuer', ['Die Steuer steigt.']);
  await enrich(text, { claude: claude(), dict, model: 'fake', save: noSave });
  const steuer = text.sentences[0]!.tok!.find((t) => t.s === 'Steuer')!;
  assert.equal(steuer.flag, true);
  assert.equal(text.ai?.lemmaFlags! >= 1, true);
});

test('invalid output: one retry succeeds; two failures mark the batch and the text still finishes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesezeit-cnt-'));
  const once = makeText('Retry', ['Das Haus ist alt.']);
  const c1 = claude();
  await withEnv({ FAKE_CLAUDE_INVALID: 'annotate:once', FAKE_CLAUDE_COUNTER: path.join(dir, 'n') }, () =>
    enrich(once, { claude: c1, dict, model: 'fake', save: noSave }),
  );
  assert.ok(once.sentences[0]!.tok, 'second attempt succeeded');
  assert.equal(c1.calls, 5, 'one extra call for the retry');

  // One broken batch out of three: that batch stays plain, the text is still finished.
  const sentences = Array.from({ length: 20 }, (_, i) => `Satz ${i + 1} beschreibt das Haus.`);
  const partly = makeText('Teilweise', sentences);
  await withEnv({ FAKE_CLAUDE_INVALID: 'annotate', FAKE_CLAUDE_INVALID_S: '16' }, () =>
    enrich(partly, { claude: claude(), dict, model: 'fake', save: noSave }),
  );
  assert.deepEqual(partly.ai?.failedBatches, [2]);
  assert.equal(partly.sentences[16]!.tok, undefined);
  assert.ok(partly.sentences[0]!.tok);
  assert.equal(partly.annotated, true);

  // Every batch broken: never publish an empty "annotated" text — stop and retry next run.
  const broken = makeText('Kaputt', ['Das Haus ist alt.']);
  await withEnv({ FAKE_CLAUDE_INVALID: 'annotate' }, async () => {
    await assert.rejects(enrich(broken, { claude: claude(), dict, model: 'fake', save: noSave }), TextFailedError);
  });
  assert.equal(broken.annotated, false);
  assert.deepEqual(stepsFor(broken).batches, [0], 'the failed batch will be retried');
});

test('missing binary or missing login stop the run instead of burning the text', async () => {
  const t = makeText('Fatal', ['Das Haus ist alt.']);
  const missing = new Claude({ model: 'fake', maxCalls: 5, command: [path.join(os.tmpdir(), 'no-such-claude-binary')] });
  await assert.rejects(enrich(t, { claude: missing, dict, model: 'fake', save: noSave }), ClaudeFatalError);
  await withEnv({ FAKE_CLAUDE_NOAUTH: '1' }, async () => {
    await assert.rejects(enrich(makeText('X', ['Ein Satz.']), { claude: claude(), dict, model: 'fake', save: noSave }), /authentication failed/);
  });
});

test('usage limit message and call budget both stop with ClaudeLimitError', async () => {
  const t = makeText('Limit', ['Das Haus ist alt.']);
  await withEnv({ FAKE_CLAUDE_LIMIT: '1' }, async () => {
    await assert.rejects(enrich(t, { claude: claude(), dict, model: 'fake', save: noSave }), (e) => e instanceof ClaudeLimitError && e.kind === 'limit');
  });
  await assert.rejects(enrich(makeText('B', ['Ein Satz.']), { claude: claude({ maxCalls: 1 }), dict, model: 'fake', save: noSave }), (e) => e instanceof ClaudeLimitError && e.kind === 'budget');
});

test('ACCEPTANCE: a forced limit leaves a correct pending list, and the next run finishes the text', async () => {
  const sentences = Array.from({ length: 20 }, (_, i) => `Satz ${i + 1} beschreibt das Haus.`);
  const text = makeText('Langer Text (B2)', sentences); // 20 sentences → 3 batches
  const { repo, index } = setup([text]);
  const rel = index.texts[0]!.path;

  // Run 1: limit after 2 calls → level (1), batch 0 (2), batch 1 → limit.
  const r1 = await aiPhase({ repo, index, config: config(), claude: claude({ fakeLimitAfter: 2 }), dict, today: '2026-10-21' });
  assert.equal(r1.stoppedBy, 'limit');
  const pending = repo.pending();
  assert.equal(pending.items.length, 1);
  assert.deepEqual(pending.items[0], {
    id: text.id, path: rel, target: 'B2', reason: 'limit', since: '2026-10-21', attempts: 0,
    steps: { level: false, batches: [1, 2], questions: true, check: true },
  });
  const saved = repo.loadText(rel);
  assert.ok(saved.sentences.slice(0, 8).every((s) => s.tok), 'batch 0 was saved before the limit');
  assert.ok(saved.sentences.slice(8).every((s) => !s.tok));
  assert.equal(saved.annotated, false);

  // Run 2: no limit → the pending text is finished first and leaves the list.
  const r2 = await aiPhase({ repo, index: repo.index(), config: config(), claude: claude(), dict, today: '2026-10-22' });
  assert.deepEqual(r2.annotated, [text.id]);
  assert.deepEqual(repo.pending().items, []);
  const done = repo.loadText(rel);
  assert.equal(done.annotated, true);
  assert.equal(done.target, 'B2');
  assert.equal(repo.index().texts[0]!.annotated, true);
});

test('daily pick: levels pool texts until one matches the target (B2, then C1 next day)', async () => {
  const a = makeText('Erster (C1)', ['Das Haus ist alt.'], 'B2'); // looks B2, AI says C1
  const b = makeText('Zweiter (B2)', ['Das Haus ist neu.'], 'C1'); // looks C1, AI says B2
  const { repo, index } = setup([a, b]);
  assert.equal(nextTarget(index, ['B2', 'C1']), 'B2');

  const r = await aiPhase({ repo, index, config: config(), claude: claude(), dict, today: '2026-10-21' });
  assert.deepEqual(r.annotated, [b.id], 'the B2 text is annotated');
  assert.deepEqual(r.leveled.sort(), [`${a.id}:C1`, `${b.id}:B2`].sort());
  const after = repo.index();
  assert.equal(after.texts.find((t) => t.id === a.id)?.annotated, false, 'the C1 text waits in the pool');
  assert.equal(nextTarget(after, ['B2', 'C1']), 'C1', 'tomorrow targets C1');

  // Next day: the already-leveled C1 text is picked without another level call.
  const c = claude();
  const r2 = await aiPhase({ repo, index: after, config: config(), claude: c, dict, today: '2026-10-22' });
  assert.deepEqual(r2.annotated, [a.id]);
  assert.deepEqual(r2.leveled, []);
});

test('a slow call times out as a normal (retried) failure, not as "claude could not be started"', async () => {
  const t = makeText('Langsam', ['Das Haus ist alt.']);
  await withEnv({ FAKE_CLAUDE_SLEEP_MS: '3000' }, async () => {
    // Level falls back to the heuristic; the only batch fails twice → TextFailedError (not fatal).
    await assert.rejects(enrich(t, { claude: claude({ timeoutMs: 500 }), dict, model: 'fake', save: noSave }), TextFailedError);
  });
  assert.equal(t.levelAi?.confidence, 0, 'heuristic fallback after two timeouts');
});

test('limit-like words inside a SUCCESSFUL answer (quoted news) do not stop the run', async () => {
  const t = makeText('Zitat', ['Das Haus ist alt.']);
  await withEnv({ FAKE_CLAUDE_INJECT: '1' }, () => enrich(t, { claude: claude(), dict, model: 'fake', save: noSave }));
  assert.equal(t.annotated, true);
  assert.match(t.levelAi!.reasons_tr, /session limit/);
});

test('annotations for sentences outside the batch are rejected', async () => {
  const t = makeText('Extra', ['Das Haus ist alt.']);
  await withEnv({ FAKE_CLAUDE_EXTRA_S: '1' }, async () => {
    await assert.rejects(enrich(t, { claude: claude(), dict, model: 'fake', save: noSave }), TextFailedError);
  });
});

test('wall-clock deadline stops further calls as "budget"', async () => {
  const t = makeText('Zeit', ['Das Haus ist alt.']);
  await assert.rejects(
    enrich(t, { claude: claude({ deadline: Date.now() - 1 }), dict, model: 'fake', save: noSave }),
    (e) => e instanceof ClaudeLimitError && e.kind === 'budget',
  );
});

test('a run killed mid-text ("running" marker) is resumed; a text failing repeatedly is parked', async () => {
  const killed = makeText('Unterbrochen (B2)', ['Das Haus ist alt.', 'Er fängt morgen an.']);
  const stuck = makeText('Kaputt (B2)', ['Das Haus ist alt.']);
  const fresh = makeText('Neu (B2)', ['Das Haus ist neu.']);
  const { repo, index } = setup([killed, stuck, fresh]);
  const pathOf = (id: string) => index.texts.find((t) => t.id === id)!.path;
  const steps = { level: true, batches: [0], questions: true, check: true };
  repo.savePending({
    version: 1,
    items: [
      { id: killed.id, path: pathOf(killed.id), target: 'B2', steps, reason: 'running', since: '2026-10-20', attempts: 0 },
      { id: stuck.id, path: pathOf(stuck.id), target: 'B2', steps, reason: 'error', since: '2026-10-19', attempts: MAX_ATTEMPTS },
    ],
  });

  // Run 1: the killed text is resumed (counts as today's text); the stuck one is not reached.
  const r1 = await aiPhase({ repo, index, config: config(), claude: claude(), dict, today: '2026-10-21' });
  assert.deepEqual(r1.annotated, [killed.id]);

  // Run 2: the stuck text has used up its attempts → parked; today's pick proceeds.
  const r2 = await aiPhase({ repo, index: repo.index(), config: config(), claude: claude(), dict, today: '2026-10-22' });
  assert.deepEqual(r2.parked, [stuck.id]);
  assert.deepEqual(r2.annotated, [fresh.id]);
  assert.deepEqual(repo.pending().items, []);
  assert.equal(repo.index().texts.find((t) => t.id === stuck.id)?.parked, true);
});
