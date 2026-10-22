// Fills missing Turkish meanings with Claude (Enes, 2026-10-23: de.wiktionary has Turkish for only
// ~40 % of the 1,000 most frequent words, none for e.g. "schätzen" or "schämen"). Runs in
// lesezeit-data's "Dictionary Turkish" workflow with the subscription token. Resumable: every
// finished batch is saved, so a usage limit only pauses it — run the workflow again to continue.
//   node scripts/dict/translate-tr.ts --dict public/dict --out tr-claude.json
//        [--max-rank 30000] [--batch 150] [--max-calls 60] [--minutes 40] [--model sonnet] [--words N]
// The result goes to scripts/dict/tr-claude.json; `npm run dict:build` merges it (entry.trAi).
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Claude, ClaudeCallError, ClaudeFatalError, ClaudeLimitError } from '../../pipeline/claude.ts';
import { ARTICLE, lemmaId, POS_CODES, type LemmaEntry } from '../../shared/dict.ts';

export interface Overlay {
  version: 1;
  model: string;
  updatedAt: string;
  tr: Record<string, string[]>; // lemma id → Turkish meanings; [] = asked, no good Turkish word
}

/** Entries still without Turkish, most frequent first. */
export function candidates(entries: LemmaEntry[], overlay: Overlay, maxRank: number): LemmaEntry[] {
  return entries
    .filter((e) => !e.tr?.length && e.rank !== undefined && e.rank <= maxRank && !Object.hasOwn(overlay.tr, lemmaId(e)))
    .sort((a, b) => a.rank! - b.rank!);
}

/** One input line for the prompt (prompts/dict-tr.md). */
export function promptLine(e: LemmaEntry): string {
  return JSON.stringify({
    id: lemmaId(e),
    w: e.refl && e.p === 'v' ? `(sich) ${e.w}` : e.w,
    pos: POS_CODES[e.p],
    ...(e.p === 'n' && e.g ? { art: ARTICLE[e.g] } : {}),
    ...(e.de ? { de: e.de.slice(0, 160) } : {}),
    ...(e.en?.length ? { en: e.en.slice(0, 3).map((g) => g.slice(0, 80)) } : {}),
  });
}

const AnswerSchema = z.object({ items: z.array(z.object({ id: z.string(), tr: z.array(z.string()) })) });
export type Answer = z.infer<typeof AnswerSchema>;
export const ANSWER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, tr: { type: 'array', items: { type: 'string' }, maxItems: 3 } },
        required: ['id', 'tr'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

/**
 * The usable part of one answer: only ids of this batch, meanings trimmed, deduplicated, at most
 * three, each 1–40 characters without brackets or digits. Ids missing from the answer stay untried.
 */
export function acceptAnswer(batch: LemmaEntry[], answer: Answer): Map<string, string[]> {
  const ids = new Set(batch.map(lemmaId));
  const out = new Map<string, string[]>();
  for (const item of answer.items) {
    if (!ids.has(item.id) || out.has(item.id)) continue;
    const tr = [...new Set(item.tr.map((t) => t.trim().replace(/\s+/g, ' ')))].filter((t) => t.length >= 1 && t.length <= 40 && !/[()[\]{}\d]/.test(t));
    out.set(item.id, tr.slice(0, 3));
  }
  return out;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function save(file: string, overlay: Overlay) {
  overlay.updatedAt = new Date().toISOString();
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(overlay, null, 0)}\n`);
  fs.renameSync(tmp, file);
}

async function main() {
  const dict = arg('dict', 'public/dict')!;
  const out = arg('out')!;
  if (!out) throw new Error('--out <file> is required');
  const model = arg('model', 'sonnet')!;
  const maxRank = Number(arg('max-rank', '30000'));
  const batchSize = Number(arg('batch', '150'));
  const words = arg('words') ? Number(arg('words')) : Infinity;

  const entries: LemmaEntry[] = [];
  const lemmaDir = path.join(dict, 'lemmas');
  for (const f of fs.readdirSync(lemmaDir)) {
    if (!f.endsWith('.json')) continue;
    const shard = JSON.parse(fs.readFileSync(path.join(lemmaDir, f), 'utf8')) as Record<string, LemmaEntry[]>;
    for (const list of Object.values(shard)) entries.push(...list);
  }
  const overlay: Overlay = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { version: 1, model, updatedAt: '', tr: {} };
  const todo = candidates(entries, overlay, maxRank).slice(0, words);
  console.log(`Entries up to rank ${maxRank} without Turkish: ${todo.length} to do, ${Object.keys(overlay.tr).length} done before.`);

  const system = fs.readFileSync(path.join(import.meta.dirname, '../../prompts/dict-tr.md'), 'utf8');
  const claude = new Claude({
    model,
    maxCalls: Number(arg('max-calls', '60')),
    deadline: Date.now() + Number(arg('minutes', '40')) * 60_000,
    timeoutMs: 8 * 60_000,
  });
  let added = 0;
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    try {
      const answer = await claude.json(`tr batch ${i / batchSize + 1}`, system, `Entries:\n${batch.map(promptLine).join('\n')}`, ANSWER_JSON_SCHEMA, AnswerSchema);
      for (const [id, tr] of acceptAnswer(batch, answer)) {
        overlay.tr[id] = tr;
        if (tr.length) added++;
      }
      save(out, overlay);
      console.log(`  batch ${i / batchSize + 1}: ${batch[0]!.w} … ${batch.at(-1)!.w} (rank ${batch[0]!.rank}–${batch.at(-1)!.rank}) done`);
    } catch (e) {
      if (e instanceof ClaudeLimitError) {
        console.log(`Stopped (${e.kind}): ${e.message.slice(0, 200)}. Progress is saved — run again to continue.`);
        break;
      }
      if (e instanceof ClaudeFatalError) throw e;
      if (e instanceof ClaudeCallError) console.log(`  batch ${i / batchSize + 1} failed, it is asked again next run: ${e.message.slice(0, 200)}`);
      else throw e;
    }
  }
  const left = candidates(entries, overlay, maxRank).length;
  console.log(`Turkish meanings added this run: ${added}. Still without Turkish up to rank ${maxRank}: ${left}.`);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
