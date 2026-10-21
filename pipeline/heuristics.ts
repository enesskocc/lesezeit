// Difficulty heuristics (spec, content pipeline step 4). The AI level comes in milestone 4;
// these numbers are stored with every text and used to flag AI levels that look wrong.
import type { Heuristics, Level } from '../shared/texts.ts';
import type { FsDictionary } from './dict-fs.ts';
import { words } from './text.ts';

const COMMON_LEMMAS = 5000;

// Subordinating conjunctions that (almost) always open a Nebensatz. "als", "während",
// "damit" are left out on purpose: they are just as often comparisons, prepositions or adverbs.
const SUBORDINATORS = new Set([
  'dass', 'weil', 'ob', 'obwohl', 'obgleich', 'wenn', 'falls', 'nachdem', 'bevor', 'sodass', 'indem',
  'seitdem', 'sobald', 'solange', 'sofern', 'wohingegen', 'wobei', 'weshalb', 'weswegen', 'wodurch',
]);
// ", der/die/das/dem/den/dessen/deren/denen …" right after a comma usually starts a relative clause.
const RELATIVE = /,\s+(der|die|das|dem|den|dessen|deren|denen|welche[rsmn]?)\s/gi;

const WERDEN = new Set(['werde', 'wirst', 'wird', 'werden', 'werdet', 'wurde', 'wurdest', 'wurden', 'wurdet']);
// Konjunktiv II (and the Konjunktiv I forms typical of reported speech in news).
const KONJ_II = new Set([
  'würde', 'würdest', 'würden', 'würdet', 'wäre', 'wärst', 'wären', 'wärt', 'hätte', 'hättest', 'hätten', 'hättet',
  'könnte', 'könnten', 'müsste', 'müssten', 'dürfte', 'dürften',
]);
const KONJ_I = new Set(['sei', 'seien', 'seiest']);
const KONJ_I_AFTER_PRONOUN = new Set(['habe', 'werde', 'könne', 'müsse', 'solle', 'wolle', 'dürfe']);
const THIRD_PERSON = new Set(['er', 'sie', 'es', 'man']);

function isPartizipII(dict: FsDictionary, word: string): boolean {
  const w = word.toLowerCase();
  return dict.info(word).entries.some((e) => e.p === 'v' && e.pp?.toLowerCase() === w);
}

export function computeHeuristics(sentences: string[], dict: FsDictionary): Heuristics {
  let tokens = 0;
  let known = 0;
  let rare = 0;
  let unknown = 0;
  let subordinate = 0;
  let passive = 0;
  let konjunktiv = 0;

  for (const s of sentences) {
    const ws = words(s);
    tokens += ws.length;
    let hasWerden = false;
    let hasPP = false;
    let worden = false;
    ws.forEach((w, i) => {
      const lw = w.toLowerCase();
      const info = dict.info(w);
      if (!info.known) unknown++;
      else {
        known++;
        if (info.rank === undefined || info.rank > COMMON_LEMMAS) rare++;
      }
      if (SUBORDINATORS.has(lw)) subordinate++;
      if (WERDEN.has(lw)) hasWerden = true;
      if (lw === 'worden') worden = true;
      if (/^(ge|be|ver|er|ent|zer|über|unter)/.test(lw) && isPartizipII(dict, w)) hasPP = true;
      if (KONJ_II.has(lw) || KONJ_I.has(lw)) konjunktiv++;
      else if (KONJ_I_AFTER_PRONOUN.has(lw) && THIRD_PERSON.has(ws[i - 1]?.toLowerCase() ?? '')) konjunktiv++;
    });
    subordinate += [...s.matchAll(RELATIVE)].length;
    if (worden || (hasWerden && hasPP)) passive++;
  }

  const n = Math.max(sentences.length, 1);
  const h = {
    sentences: sentences.length,
    words: tokens,
    avgSentenceLength: round(tokens / n),
    rareShare: round(known ? rare / known : 0, 3),
    unknownShare: round(tokens ? unknown / tokens : 0, 3),
    subordinatePerSentence: round(subordinate / n),
    passivePer100: round((passive / n) * 100),
    konjunktivPer100: round((konjunktiv / n) * 100),
  };
  return { ...h, score: round(difficultyScore(h)) };
}

/**
 * Weighted sum, each part scaled to roughly 0–1 for typical news text.
 * Calibrated on real feed texts (see PROGRESS.md); the AI level (M4) is the authority.
 */
export function difficultyScore(h: Omit<Heuristics, 'score'>): number {
  return (
    0.35 * clamp((h.avgSentenceLength - 8) / 20) +
    0.35 * clamp(h.rareShare / 0.45) +
    0.15 * clamp(h.subordinatePerSentence / 1.2) +
    0.075 * clamp(h.passivePer100 / 50) +
    0.075 * clamp(h.konjunktivPer100 / 60)
  );
}

// Quartiles of 40 real feed texts (2026-10-21) → roughly even B1–C2 spread across the feeds.
// Recalibrate in milestone 4 against Claude's levels.
export const LEVEL_CUTS: Record<Exclude<Level, 'C2'>, number> = { B1: 0.31, B2: 0.35, C1: 0.4 };

export function levelFromScore(score: number): Level {
  if (score < LEVEL_CUTS.B1) return 'B1';
  if (score < LEVEL_CUTS.B2) return 'B2';
  if (score < LEVEL_CUTS.C1) return 'C1';
  return 'C2';
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const round = (x: number, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits;
