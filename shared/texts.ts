// Schemas for the private lesezeit-data repo, shared by the pipeline (pipeline/) and the app.
//
//   sources.json                 feed list
//   pipeline.json                pipeline settings
//   texts/index.json             every stored text (metadata only)
//   texts/YYYY-MM-DD/<id>.json   one text: paragraphs, sentences, heuristics (+ annotations from M4)
//   state/seen.json              URL hash → stored / rejected, so nothing is fetched twice
import { z } from 'zod';
import { LemmaEntrySchema } from './dict.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LEVELS = ['B1', 'B2', 'C1', 'C2'] as const;
export const LevelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof LevelSchema>;

/** Topic of a text (given by Claude in the level call; Enes, 2026-10-21) → Turkish label in the app. */
export const TOPICS = {
  politik: 'Politika',
  international: 'Dünya',
  wirtschaft: 'Ekonomi',
  gesellschaft: 'Toplum',
  wissenschaft: 'Bilim & teknoloji',
  gesundheit: 'Sağlık',
  umwelt: 'Çevre & iklim',
  kultur: 'Kültür',
  sport: 'Spor',
} as const;
export type Topic = keyof typeof TOPICS;
export const TopicSchema = z.enum(Object.keys(TOPICS) as [Topic, ...Topic[]]);

export const SourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), // "tagesschau", "dlf"
  name: z.string(), // shown in the app
  feeds: z.array(z.url()).min(1),
  enabled: z.boolean().default(true),
  /** CSS selector for the article body, used when Readability fails. */
  selector: z.string().optional(),
  /** Extra page markers (HTML substrings) meaning "paywalled" for this source. */
  paywallMarkers: z.array(z.string()).optional(),
  /** Why a source is configured the way it is (JSON has no comments). */
  note: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;
export const SourcesFileSchema = z.object({ sources: z.array(SourceSchema) });

export const PipelineConfigSchema = z.object({
  /** New texts stored per run: the pool the daily pick chooses from (Enes, 2026-10-21: small pool). */
  maxTextsPerRun: z.number().int().positive().default(4),
  minWords: z.number().int().positive().default(250),
  maxWords: z.number().int().positive().default(1500),
  /** Candidates tried per run before giving up (each costs one page download). */
  maxFetchesPerRun: z.number().int().positive().default(60),
  /** Texts fully annotated per run (Enes, 2026-10-21: one high-quality text a day). */
  annotatePerRun: z.number().int().nonnegative().default(1),
  /** Target level of the daily text cycles through this list (B2, C1, B2, …). */
  levelRotation: z.array(LevelSchema).min(1).default(['B2', 'C1']),
  /** Claude Code model alias or full name. */
  claudeModel: z.string().default('opus'),
  /** Hard cap on claude -p calls per run (budget; the rest waits in state/pending.json). */
  maxClaudeCalls: z.number().int().nonnegative().default(24),
  /** At most this many pool texts are leveled per run while searching for the target level. */
  levelCallsPerRun: z.number().int().nonnegative().default(4),
  /** Pool texts older than this are no longer picked. */
  poolDays: z.number().int().positive().default(7),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

export const HeuristicsSchema = z.object({
  sentences: z.number(),
  words: z.number(),
  avgSentenceLength: z.number(), // words per sentence
  rareShare: z.number(), // share of word tokens whose lemma is outside the 5,000 most frequent (0–1)
  unknownShare: z.number(), // share of word tokens not found in the dictionary at all (0–1)
  subordinatePerSentence: z.number(),
  passivePer100: z.number(), // per 100 sentences
  konjunktivPer100: z.number(),
  score: z.number(), // combined difficulty score used for levelHeuristic
});
export type Heuristics = z.infer<typeof HeuristicsSchema>;

// ---- Annotation (milestone 4) -----------------------------------------------------------------
// Tokens are made by pipeline/tokenize.ts (deterministic), so annotations always line up with the
// text. Claude fills the linguistic fields; gender/plural come from the M2 dictionary.

export const CASES = ['Nom', 'Akk', 'Dat', 'Gen'] as const;

export const TokenSchema = z.object({
  i: z.number().int().nonnegative(), // index within the sentence
  s: z.string(), // surface form as in the text
  ws: z.boolean(), // whitespace before this token
  k: z.enum(['w', 'p', 'n']), // word / punctuation / number
  l: z.string().optional(), // lemma ("anfangen" for both "fängt" and "an")
  pos: z.string().optional(), // Universal POS tag: NOUN, VERB, AUX, ADJ, ADV, ADP, DET, PRON, PROPN, …
  c: z.enum(CASES).optional(), // case of nouns/pronouns/articles/adjectives in this sentence
  g: z.enum(['m', 'f', 'n']).optional(), // noun gender (dictionary-checked)
  pl: z.string().optional(), // noun plural (from the dictionary)
  sep: z.number().int().nonnegative().optional(), // separable verb: index of the other part
  refl: z.boolean().optional(), // reflexive use in this sentence
  mwe: z.string().optional(), // id of a multi-word expression in text.mwes
  tr: z.string().optional(), // Turkish meaning in this context
  dict: z.boolean().optional(), // lemma found in the dictionary
  flag: z.boolean().optional(), // lemma/gender not confirmed by the dictionary → check
});
export type Token = z.infer<typeof TokenSchema>;

export const SentenceSchema = z.object({
  p: z.number().int().nonnegative(), // paragraph index
  t: z.string(),
  tok: z.array(TokenSchema).optional(),
  tr: z.string().optional(), // Turkish translation
  notes: z.array(z.string()).optional(), // short Turkish grammar notes
});

export const MweSchema = z.object({
  id: z.string(), // "m3"
  s: z.number().int().nonnegative(), // sentence index
  tok: z.array(z.number().int().nonnegative()).min(2), // token indexes in that sentence
  de: z.string(), // dictionary form: "eine Entscheidung treffen", "sich verlassen auf"
  tr: z.string(),
  kind: z.enum(['nvv', 'vprep', 'idiom', 'other']), // Nomen-Verb-Verbindung, verb + preposition, idiom
});
export type Mwe = z.infer<typeof MweSchema>;

export const QuestionSchema = z.object({
  id: z.string(),
  type: z.enum(['mc', 'tf', 'open']), // multiple choice, richtig/falsch/nicht im Text, open
  q: z.string(), // German
  options: z.array(z.string()).optional(), // mc: 4 options; tf: ["richtig", "falsch", "nicht im Text"]
  answer: z.union([z.number().int().nonnegative(), z.string()]), // option index, or model answer (open)
  proof: z.number().int().nonnegative(), // sentence index that proves the answer
  explain_tr: z.string(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const LevelAiSchema = z.object({
  level: LevelSchema,
  confidence: z.number().min(0).max(1),
  reasons_tr: z.string(),
  topic: TopicSchema.optional(),
});

export const TextFileSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  id: z.string(),
  kind: z.enum(['news', 'generated', 'imported', 'review']),
  date: isoDate, // run date (Europe/Berlin)
  source: z.string(), // source id
  sourceName: z.string(),
  url: z.url(),
  title: z.string(),
  publishedAt: z.string().optional(),
  fetchedAt: z.string(),
  wordCount: z.number().int(),
  paragraphs: z.array(z.string()),
  sentences: z.array(SentenceSchema),
  heuristics: HeuristicsSchema,
  levelHeuristic: LevelSchema,
  level: LevelSchema.optional(), // AI level (milestone 4)
  levelAi: LevelAiSchema.optional(),
  topic: TopicSchema.optional(),
  flagged: z.boolean().optional(), // AI and heuristics differ by ≥ 2 levels (milestone 4)
  annotated: z.boolean(), // every sentence annotated + questions done (milestone 4)
  annotatedAt: z.string().optional(),
  target: LevelSchema.optional(), // level this text was picked for (B2/C1 rotation)
  parked: z.boolean().optional(), // failed twice: kept out of the daily pick

  mwes: z.array(MweSchema).optional(),
  questions: z.array(QuestionSchema).optional(),
  /** Dictionary entries for every lemma in the text (normalized lemma → entries), so the reader's
   *  word sheet works offline without downloading dictionary shards (milestone 5). */
  dict: z.record(z.string(), z.array(LemmaEntrySchema)).optional(),
  questionsFlagged: z.boolean().optional(), // the independent check still found problems
  ai: z
    .object({
      model: z.string(),
      calls: z.number().int(),
      failedBatches: z.array(z.number().int()).optional(), // batches that returned invalid JSON twice
      lemmaFlags: z.number().int().optional(), // tokens whose lemma the dictionary does not confirm
      questionsChecked: z.boolean().optional(), // the independent check ran (pass or flagged)
    })
    .optional(),
});
export type TextFile = z.infer<typeof TextFileSchema>;

export const IndexEntrySchema = TextFileSchema.pick({
  id: true,
  kind: true,
  date: true,
  source: true,
  sourceName: true,
  url: true,
  title: true,
  wordCount: true,
  levelHeuristic: true,
  level: true,
  flagged: true,
  annotated: true,
  annotatedAt: true,
  target: true,
  parked: true,
  topic: true,
}).extend({ path: z.string() });
export type IndexEntry = z.infer<typeof IndexEntrySchema>;

export const TextIndexSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  texts: z.array(IndexEntrySchema), // newest first
});
export type TextIndex = z.infer<typeof TextIndexSchema>;

export const REJECT_REASONS = ['short', 'long', 'paywall', 'live', 'media', 'http', 'extract', 'language'] as const;
export const SeenSchema = z.object({
  version: z.literal(1),
  urls: z.record(
    z.string(),
    z.object({
      date: isoDate,
      status: z.enum(['stored', 'rejected']),
      reason: z.enum(REJECT_REASONS).optional(),
    }),
  ),
});
export type Seen = z.infer<typeof SeenSchema>;

/** AI steps still to do per text (state/pending.json). Filled when a usage limit or the call budget stops a run. */
export const PendingStepsSchema = z.object({
  level: z.boolean(),
  batches: z.array(z.number().int().nonnegative()), // annotation batch indexes still missing
  questions: z.boolean(),
  check: z.boolean(),
});
export type PendingSteps = z.infer<typeof PendingStepsSchema>;

export const PendingSchema = z.object({
  version: z.literal(1),
  items: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      target: LevelSchema.optional(),
      steps: PendingStepsSchema,
      // limit/budget: usage limit or run budget · running: marker while being annotated (a killed
      // job leaves it) · error: this text failed · blocked: Claude itself unusable (auth/install)
      reason: z.enum(['limit', 'budget', 'error', 'running', 'blocked']),
      since: isoDate,
      /** Runs in which this text failed or was interrupted; parked after 2. */
      attempts: z.number().int().nonnegative().default(0),
    }),
  ),
});
export type Pending = z.infer<typeof PendingSchema>;
