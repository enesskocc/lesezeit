// Progress backup (spec "Backup and sync"): the phone's learning state as one JSON file in
// lesezeit-data. Written by the app, read back by "Yedekten geri yükle" and by the daily pipeline
// (known words → coverage-based picks). Never contains the GitHub token or the Gemini key.
import { z } from 'zod';

export const BACKUP_PATH = 'backup/progress.json';
export const BACKUP_PREV_PATH = 'backup/progress.prev.json';

const WordStatusSchema = z.object({
  key: z.string(), // "w:haus" (lemma) or "m:eine entscheidung treffen" (expression)
  state: z.enum(['learning', 'known', 'ignored']),
  updatedAt: z.string(),
});

// Cards and logs are checked only where the pipeline or a restore relies on them; the rest of
// each row passes through unchanged (the app's own types describe it).
const CardSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['lemma', 'mwe']),
    due: z.number(),
    fsrs: z.object({ state: z.number(), scheduled_days: z.number(), due: z.string() }).passthrough(),
  })
  .passthrough();
const Row = z.record(z.string(), z.unknown());

export const ProgressBackupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  wordStatus: z.array(WordStatusSchema),
  cards: z.array(CardSchema),
  reviewLog: z.array(Row),
  readingLog: z.array(Row),
  prefs: Row.optional(),
});
export type ProgressBackup = z.infer<typeof ProgressBackupSchema>;

/** A card is mature once its interval reaches 21 days (same rule as the app's FSRS phases). */
const MATURE_DAYS = 21;

/**
 * Normalised lemma keys ("haus", "anfangen") the learner knows: marked "known" (or "ignored") in
 * the reader, or a word card that has become mature. Expressions are not single words: left out.
 */
export function knownLemmas(b: Pick<ProgressBackup, 'wordStatus' | 'cards'>): Set<string> {
  const out = new Set<string>();
  for (const w of b.wordStatus) if (w.key.startsWith('w:') && (w.state === 'known' || w.state === 'ignored')) out.add(w.key.slice(2));
  for (const c of b.cards) {
    if (c.kind === 'lemma' && c.id.startsWith('w:') && c.fsrs.state === 2 && c.fsrs.scheduled_days >= MATURE_DAYS) out.add(c.id.slice(2));
  }
  return out;
}
