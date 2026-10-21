// Milestone 4: AI enrichment of one stored text (spec, content pipeline steps 4–6).
//   level → annotate (batches of 8 sentences) → questions → independent question check
// Every finished step is saved immediately, so a usage limit never loses work; what is missing
// can always be recomputed from the text itself (stepsFor).
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { normalizeKey } from '../shared/dict.ts';
import { CASES, LEVELS, LevelAiSchema, type Level, type PendingSteps, type Question, type TextFile, type Token } from '../shared/texts.ts';
import { ClaudeCallError, type Claude } from './claude.ts';
import type { FsDictionary } from './dict-fs.ts';
import { numbered, tokenize } from './tokenize.ts';

export const BATCH_SIZE = 8;

/** This text could not be annotated (most batches failed). Counted per text; see daily.ts. */
export class TextFailedError extends Error {}
const PROMPTS = path.resolve(import.meta.dirname, '../prompts');
const promptCache = new Map<string, string>();
function prompt(name: 'level' | 'annotate' | 'questions' | 'check-questions'): string {
  let p = promptCache.get(name);
  if (!p) promptCache.set(name, (p = fs.readFileSync(path.join(PROMPTS, `${name}.md`), 'utf8')));
  return p;
}

export interface EnrichDeps {
  claude: Claude;
  dict: FsDictionary;
  model: string;
  /** Persists the text file (and its index entry) after every finished step. */
  save: (text: TextFile) => void;
}

const levelIndex = (l: Level) => LEVELS.indexOf(l);
/** Claude sometimes writes null for "no value"; treat it like a missing field. */
const opt = <T extends z.ZodType>(t: T) => t.nullish().transform((v) => v ?? undefined);

// ---- Level -------------------------------------------------------------------------------------

const LEVEL_JSON = {
  type: 'object',
  properties: {
    level: { type: 'string', enum: [...LEVELS] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reasons_tr: { type: 'string' },
  },
  required: ['level', 'confidence', 'reasons_tr'],
  additionalProperties: false,
};

export async function levelText(text: TextFile, d: EnrichDeps): Promise<void> {
  const input = `TITLE: ${text.title}\nTEXT:\n${text.paragraphs.join('\n')}`;
  let r: z.infer<typeof LevelAiSchema>;
  try {
    r = await d.claude.json(`level ${text.id}`, prompt('level'), input, LEVEL_JSON, LevelAiSchema);
  } catch (e) {
    if (!(e instanceof ClaudeCallError)) throw e;
    // No usable AI answer twice: fall back to the heuristic level, marked by confidence 0.
    r = { level: text.levelHeuristic, confidence: 0, reasons_tr: 'Yapay zekâ seviyesi alınamadı; tahmini (sezgisel) seviye.' };
  }
  text.levelAi = r;
  text.level = r.level;
  // Spec: AI and heuristics two or more levels apart → keep the AI level but flag the text.
  if (Math.abs(levelIndex(r.level) - levelIndex(text.levelHeuristic)) >= 2) text.flagged = true;
  else delete text.flagged;
}

// ---- Annotation --------------------------------------------------------------------------------

const ANNOTATE_JSON = {
  type: 'object',
  properties: {
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          s: { type: 'integer' },
          tr: { type: 'string' },
          notes: { type: 'array', items: { type: 'string' } },
          tokens: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                i: { type: 'integer' },
                l: { type: 'string' },
                pos: { type: 'string' },
                c: { type: 'string', enum: [...CASES] },
                g: { type: 'string', enum: ['m', 'f', 'n'] },
                sep: { type: 'integer' },
                refl: { type: 'boolean' },
                tr: { type: 'string' },
              },
              required: ['i', 'l', 'pos', 'tr'],
            },
          },
          mwes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tok: { type: 'array', items: { type: 'integer' } },
                de: { type: 'string' },
                tr: { type: 'string' },
                kind: { type: 'string', enum: ['nvv', 'vprep', 'idiom', 'other'] },
              },
              required: ['tok', 'de', 'tr', 'kind'],
            },
          },
        },
        required: ['s', 'tr', 'notes', 'tokens', 'mwes'],
      },
    },
  },
  required: ['sentences'],
};

const AnnTokenZ = z.object({
  i: z.number().int().nonnegative(),
  l: z.string().min(1),
  pos: z.string().min(1),
  c: opt(z.enum(CASES)),
  g: opt(z.enum(['m', 'f', 'n'])),
  sep: opt(z.number().int().nonnegative()),
  refl: opt(z.boolean()),
  tr: z.string(),
});
const AnnSentenceZ = z.object({
  s: z.number().int().nonnegative(),
  tr: z.string().min(1),
  notes: z.array(z.string()),
  tokens: z.array(AnnTokenZ),
  mwes: z.array(
    z.object({
      tok: z.array(z.number().int().nonnegative()).min(2),
      de: z.string().min(1),
      tr: z.string(),
      kind: z.enum(['nvv', 'vprep', 'idiom', 'other']),
    }),
  ),
});
type AnnSentence = z.infer<typeof AnnSentenceZ>;

/** Batch result must cover exactly the batch sentences (once each) and ≥ 90 % of their word tokens. */
function annotationSchema(text: TextFile, batch: number[]) {
  return z.object({ sentences: z.array(AnnSentenceZ) }).superRefine((r, ctx) => {
    const seen = new Set<number>();
    for (const x of r.sentences) {
      if (!batch.includes(x.s)) ctx.addIssue({ code: 'custom', message: `sentence ${x.s} is not in this batch` });
      if (seen.has(x.s)) ctx.addIssue({ code: 'custom', message: `sentence ${x.s} appears twice` });
      seen.add(x.s);
    }
    for (const s of batch) {
      const got = r.sentences.find((x) => x.s === s);
      if (!got) {
        ctx.addIssue({ code: 'custom', message: `sentence ${s} missing` });
        continue;
      }
      const words = tokenize(text.sentences[s]!.t).filter((t) => t.k === 'w');
      const covered = new Set(got.tokens.map((t) => t.i));
      const missing = words.filter((t) => !covered.has(t.i)).length;
      if (words.length && missing / words.length > 0.1) {
        ctx.addIssue({ code: 'custom', message: `sentence ${s}: ${missing}/${words.length} word tokens not annotated` });
      }
    }
  });
}

export function batches(text: TextFile): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < text.sentences.length; i += BATCH_SIZE) {
    out.push(text.sentences.slice(i, i + BATCH_SIZE).map((_, j) => i + j));
  }
  return out;
}

/** Dictionary cross-check (spec step 5): mismatches are flagged, not silently trusted. */
export function checkWithDictionary(tok: Token, dict: FsDictionary): void {
  if (!tok.l || tok.pos === 'PROPN' || tok.k !== 'w') return;
  const key = normalizeKey(tok.l);
  const entries = dict.info(tok.l).entries.filter((e) => normalizeKey(e.w) === key);
  tok.dict = entries.length > 0;
  if (tok.pos === 'NOUN') {
    const nouns = entries.filter((e) => e.p === 'n');
    const match = tok.g ? nouns.find((e) => e.g === tok.g) : nouns[0];
    if (match) {
      tok.g = match.g ?? tok.g;
      if (match.pl) tok.pl = match.pl;
    } else if (nouns.length) {
      tok.flag = true; // the dictionary knows this noun, but not with the gender Claude gave
    }
  }
  if (!tok.dict) tok.flag = true;
}

export function applyAnnotation(text: TextFile, result: AnnSentence[], dict: FsDictionary): void {
  text.mwes ??= [];
  for (const a of result) {
    const sentence = text.sentences[a.s];
    if (!sentence) continue;
    const toks = tokenize(sentence.t);
    for (const at of a.tokens) {
      const tok = toks[at.i];
      if (!tok || tok.k === 'p') continue;
      tok.l = at.l;
      tok.pos = at.pos;
      if (at.c) tok.c = at.c;
      if (at.g && at.pos === 'NOUN') tok.g = at.g;
      if (at.sep !== undefined && at.sep !== at.i && toks[at.sep]?.k === 'w') tok.sep = at.sep;
      if (at.refl) tok.refl = true;
      if (at.tr) tok.tr = at.tr;
      checkWithDictionary(tok, dict);
    }
    // Re-annotating a sentence (retry, resumed batch) replaces its expressions instead of adding more.
    text.mwes = text.mwes.filter((m) => m.s !== a.s);
    for (const m of a.mwes) {
      const idx = [...new Set(m.tok)].filter((i) => toks[i] && toks[i]!.k !== 'p');
      if (idx.length < 2) continue;
      const id = `m${Math.max(0, ...text.mwes.map((x) => Number(x.id.slice(1)) || 0)) + 1}`;
      text.mwes.push({ id, s: a.s, tok: idx, de: m.de, tr: m.tr, kind: m.kind });
      for (const i of idx) toks[i]!.mwe ??= id;
    }
    sentence.tok = toks;
    sentence.tr = a.tr;
    sentence.notes = a.notes.filter(Boolean).slice(0, 3);
  }
}

export async function annotateBatch(text: TextFile, batchNo: number, d: EnrichDeps): Promise<void> {
  const batch = batches(text)[batchNo]!;
  const input =
    `TITLE: ${text.title}\nTEXT (context):\n${text.paragraphs.join('\n')}\n\nBATCH:\n` +
    batch.map((s) => `S=${s}: ${numbered(tokenize(text.sentences[s]!.t))}`).join('\n');
  try {
    const r = await d.claude.json(`annotate ${text.id} batch ${batchNo}`, prompt('annotate'), input, ANNOTATE_JSON, annotationSchema(text, batch));
    applyAnnotation(text, r.sentences, d.dict);
  } catch (e) {
    if (!(e instanceof ClaudeCallError)) throw e;
    // Two invalid answers: keep the sentences plain, remember the batch, carry on.
    text.ai!.failedBatches = [...new Set([...(text.ai!.failedBatches ?? []), batchNo])];
  }
}

// ---- Questions ---------------------------------------------------------------------------------

const QUESTIONS_JSON = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['mc', 'tf', 'open'] },
          q: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answer: { type: ['integer', 'string'] },
          proof: { type: 'integer' },
          explain_tr: { type: 'string' },
        },
        required: ['id', 'type', 'q', 'answer', 'proof', 'explain_tr'],
      },
    },
  },
  required: ['questions'],
};

const TF = ['richtig', 'falsch', 'nicht im Text'];

function questionsSchema(sentenceCount: number) {
  const Q = z.object({
    id: z.string(),
    type: z.enum(['mc', 'tf', 'open']),
    q: z.string().min(5),
    options: opt(z.array(z.string())),
    answer: z.union([z.number().int().nonnegative(), z.string()]),
    proof: z.number().int().nonnegative(),
    explain_tr: z.string().min(1),
  });
  return z.object({ questions: z.array(Q) }).superRefine((r, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (r.questions.length !== 5) issue(`expected 5 questions, got ${r.questions.length}`);
    for (const q of r.questions) {
      if (q.proof >= sentenceCount) issue(`${q.id}: proof ${q.proof} out of range`);
      if (q.type === 'mc' && (q.options?.length !== 4 || typeof q.answer !== 'number' || q.answer > 3)) issue(`${q.id}: mc needs 4 options and answer 0–3`);
      if (q.type === 'tf' && (JSON.stringify(q.options) !== JSON.stringify(TF) || typeof q.answer !== 'number' || q.answer > 2)) issue(`${q.id}: tf options/answer`);
      if (q.type === 'open' && typeof q.answer !== 'string') issue(`${q.id}: open answer must be text`);
    }
  });
}

const numberedText = (text: TextFile) => text.sentences.map((s, i) => `[${i}] ${s.t}`).join('\n');

async function writeQuestions(text: TextFile, d: EnrichDeps, feedback?: string): Promise<Question[]> {
  const input = `TEXT:\n${numberedText(text)}${feedback ? `\n\nA reviewer rejected your previous questions. Fix these problems:\n${feedback}` : ''}`;
  const r = await d.claude.json(`questions ${text.id}`, prompt('questions'), input, QUESTIONS_JSON, questionsSchema(text.sentences.length));
  // Ids are renumbered so the checker's notes and the reader's answer state can never collide.
  return r.questions.map((q, i) => ({ ...q, id: `q${i + 1}`, options: q.type === 'open' ? undefined : q.options }));
}

const CHECK_JSON = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, issue_tr: { type: 'string' } }, required: ['id', 'issue_tr'] } },
  },
  required: ['ok', 'problems'],
};
const CheckZ = z.object({ ok: z.boolean(), problems: z.array(z.object({ id: z.string(), issue_tr: z.string() })) });

async function review(text: TextFile, d: EnrichDeps) {
  const input = `TEXT:\n${numberedText(text)}\n\nQUESTIONS:\n${text.questions!.map((q) => JSON.stringify(q)).join('\n')}`;
  return d.claude.json(`check ${text.id}`, prompt('check-questions'), input, CHECK_JSON, CheckZ);
}

export async function makeQuestions(text: TextFile, d: EnrichDeps): Promise<void> {
  try {
    text.questions = await writeQuestions(text, d);
  } catch (e) {
    if (!(e instanceof ClaudeCallError)) throw e;
    text.questions = [];
    text.questionsFlagged = true;
    text.ai!.questionsChecked = true; // nothing to check
  }
}

/** Independent check; one rewrite with the reviewer's notes; still bad → flagged. */
export async function checkQuestions(text: TextFile, d: EnrichDeps): Promise<void> {
  try {
    let r = await review(text, d);
    if (!r.ok) {
      text.questions = await writeQuestions(text, d, r.problems.map((p) => `- ${p.id}: ${p.issue_tr}`).join('\n'));
      r = await review(text, d);
    }
    if (r.ok) delete text.questionsFlagged;
    else text.questionsFlagged = true;
  } catch (e) {
    if (!(e instanceof ClaudeCallError)) throw e;
    text.questionsFlagged = true;
  }
  text.ai!.questionsChecked = true;
}

// ---- Orchestration -----------------------------------------------------------------------------

/** What is still missing, computed from the text itself (so state/pending.json can never drift). */
export function stepsFor(text: TextFile): PendingSteps {
  const failed = new Set(text.ai?.failedBatches ?? []);
  return {
    level: !text.levelAi,
    batches: batches(text)
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => !failed.has(i) && b.some((s) => !text.sentences[s]!.tok))
      .map(({ i }) => i),
    questions: text.questions === undefined,
    check: !text.ai?.questionsChecked,
  };
}

/** Runs every missing step. Throws ClaudeLimitError when a limit/budget stops it (work so far is saved). */
export async function enrich(text: TextFile, d: EnrichDeps): Promise<void> {
  text.version = 2;
  text.ai ??= { model: d.model, calls: 0 };
  const step = async (fn: () => Promise<void>) => {
    const before = d.claude.calls;
    try {
      await fn();
    } finally {
      text.ai!.calls += d.claude.calls - before;
      d.save(text);
    }
  };
  const todo = stepsFor(text);
  if (todo.level) await step(() => levelText(text, d));
  for (const b of todo.batches) await step(() => annotateBatch(text, b, d));
  // Half or more of the batches unusable: don't publish a half-plain text. Forget the failures so
  // the next run retries them, and stop (daily.ts parks the text after repeated failures).
  const failed = text.ai.failedBatches?.length ?? 0;
  if (failed > 0 && failed * 2 >= batches(text).length) {
    delete text.ai.failedBatches;
    d.save(text);
    throw new TextFailedError(`${text.id}: ${failed} of ${batches(text).length} annotation batches failed`);
  }
  if (text.questions === undefined) await step(() => makeQuestions(text, d));
  if (!text.ai.questionsChecked) await step(() => checkQuestions(text, d));

  text.ai.lemmaFlags = text.sentences.reduce((n, s) => n + (s.tok?.filter((t) => t.flag).length ?? 0), 0);
  text.annotated = true;
  text.annotatedAt = new Date().toISOString();
  d.save(text);
}
