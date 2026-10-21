// Schemas for the private lesezeit-data repo, shared by the pipeline (pipeline/) and the app.
//
//   sources.json                 feed list
//   pipeline.json                pipeline settings
//   texts/index.json             every stored text (metadata only)
//   texts/YYYY-MM-DD/<id>.json   one text: paragraphs, sentences, heuristics (+ annotations from M4)
//   state/seen.json              URL hash → stored / rejected, so nothing is fetched twice
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const LEVELS = ['B1', 'B2', 'C1', 'C2'] as const;
export const LevelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof LevelSchema>;

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
  maxTextsPerRun: z.number().int().positive().default(8),
  minWords: z.number().int().positive().default(250),
  maxWords: z.number().int().positive().default(1500),
  /** Candidates tried per run before giving up (each costs one page download). */
  maxFetchesPerRun: z.number().int().positive().default(60),
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

export const SentenceSchema = z.object({
  p: z.number().int().nonnegative(), // paragraph index
  t: z.string(),
});

export const TextFileSchema = z.object({
  version: z.literal(1),
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
  flagged: z.boolean().optional(), // AI and heuristics differ by ≥ 2 levels (milestone 4)
  annotated: z.boolean(), // tokens/translations added (milestone 4)
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
