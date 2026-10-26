// Known-word coverage for the daily pick (spec step 7; Enes 2026-10-26: 95–99 %). The phone's
// backup (backup/progress.json) says which lemmas the learner knows; a candidate text's coverage is
// the share of its dictionary words whose lemma is known.
import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_PATH, knownLemmas, ProgressBackupSchema } from '../shared/backup.ts';
import { normalizeKey } from '../shared/dict.ts';
import type { FsDictionary } from './dict-fs.ts';
import { words } from './text.ts';

/** Known lemma keys from the data repo's backup; null without a (valid) backup. */
export function readKnown(dataDir: string): Set<string> | null {
  const file = path.join(dataDir, BACKUP_PATH);
  if (!fs.existsSync(file)) return null;
  const parsed = ProgressBackupSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  return parsed.success ? knownLemmas(parsed.data) : null;
}

/**
 * Share (0–1) of the text's dictionary words whose lemma the learner knows; null without such words.
 * Names and words the dictionary lacks count neither way.
 */
export function coverageOf(sentences: string[], dict: Pick<FsDictionary, 'info'>, known: ReadonlySet<string>): number | null {
  let counted = 0;
  let hits = 0;
  for (const s of sentences) {
    for (const w of words(s)) {
      const info = dict.info(w);
      if (!info.known) continue;
      counted++;
      if (info.entries.some((e) => known.has(normalizeKey(e.w)))) hits++;
    }
  }
  return counted ? hits / counted : null;
}

/** Lower is better: inside the band, the distance from its middle; outside, 1 + the distance to it. */
export function coverageScore(c: number | null, band: readonly [number, number]): number {
  if (c === null) return 2;
  const [lo, hi] = band;
  if (c >= lo && c <= hi) return Math.abs(c - (lo + hi) / 2);
  return 1 + (c < lo ? lo - c : c - hi);
}
