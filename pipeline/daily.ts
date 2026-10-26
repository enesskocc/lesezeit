// The daily AI phase (Enes, 2026-10-21: one high-quality text a day, B2 and C1 in turn).
// 1. finish texts left in state/pending.json (limit, budget, interrupted run, earlier failure)
// 2. otherwise pick today's text from the pool: level candidates with Claude until one matches
//    the target level, then annotate it fully. A limit stops everything and leaves a pending entry.
import { LEVELS, type IndexEntry, type Level, type Pending, type PipelineConfig, type TextIndex } from '../shared/texts.ts';
import { ClaudeFatalError, ClaudeLimitError, type Claude } from './claude.ts';
import { coverageOf, coverageScore } from './coverage.ts';
import type { FsDictionary } from './dict-fs.ts';
import { enrich, levelText, stepsFor, type EnrichDeps } from './enrich.ts';
import type { DataRepo } from './store.ts';

/** A text that failed or was interrupted this many times is parked (kept out of the pick). */
export const MAX_ATTEMPTS = 2;

export interface AiPhaseDeps {
  repo: DataRepo;
  index: TextIndex;
  config: PipelineConfig;
  claude: Claude;
  dict: FsDictionary;
  today: string;
  /** Lemmas the learner knows, from backup/progress.json (milestone 7); null/absent = no backup. */
  known?: ReadonlySet<string> | null;
}

export interface AiPhaseResult {
  annotated: string[];
  leveled: string[];
  parked: string[];
  stoppedBy?: 'limit' | 'budget';
  message?: string;
}

type PendingItem = Pending['items'][number];
const levelIndex = (l: Level) => LEVELS.indexOf(l);

/** The level after the most recently annotated text's target (B2 → C1 → B2 …). */
export function nextTarget(index: TextIndex, rotation: Level[]): Level {
  const last = index.texts
    .filter((t) => t.annotated && t.target && t.annotatedAt)
    .sort((a, b) => (a.annotatedAt! < b.annotatedAt! ? 1 : -1))[0];
  if (!last) return rotation[0]!;
  const i = rotation.indexOf(last.target!);
  return rotation[(i + 1) % rotation.length]!;
}

/**
 * The order in which pool texts are considered: level closest to today's target first; then, when
 * the phone's backup is known, the text whose known-word coverage is closest to the band (spec
 * step 7: a word marked known raises the coverage of the texts that use it); then the newest.
 */
export function orderPool(
  pool: IndexEntry[],
  target: Level,
  coverage: (e: IndexEntry) => number | null,
  band: readonly [number, number],
): IndexEntry[] {
  const distance = (e: IndexEntry) => Math.abs(levelIndex(e.level ?? e.levelHeuristic) - levelIndex(target));
  return [...pool].sort(
    (a, b) => distance(a) - distance(b) || coverageScore(coverage(a), band) - coverageScore(coverage(b), band) || (a.date < b.date ? 1 : -1),
  );
}

/** Unannotated, not parked news texts from the last `poolDays` days, newest first. */
export function poolOf(index: TextIndex, today: string, poolDays: number, exclude: Set<string>): IndexEntry[] {
  const cutoff = new Date(new Date(`${today}T00:00:00Z`).getTime() - poolDays * 86_400_000).toISOString().slice(0, 10);
  return index.texts.filter((t) => !t.annotated && !t.parked && t.kind === 'news' && t.date >= cutoff && !exclude.has(t.id));
}

export async function aiPhase(d: AiPhaseDeps): Promise<AiPhaseResult> {
  const { repo, index, config, claude, dict, today, known } = d;
  const result: AiPhaseResult = { annotated: [], leveled: [], parked: [] };
  const pending = repo.pending();
  const deps = (rel: string): EnrichDeps => ({
    claude,
    dict,
    model: config.claudeModel,
    save: (t) => {
      repo.updateText(t, rel, index);
      repo.saveIndex(index);
    },
  });
  let current: { id: string; path: string; target?: Level; attempts: number } | undefined;

  const upsert = (item: PendingItem) => {
    pending.items = [item, ...pending.items.filter((p) => p.id !== item.id)];
    repo.savePending(pending);
  };

  const finish = async (entryPath: string, target: Level | undefined, attempts: number) => {
    const text = repo.loadText(entryPath);
    current = { id: text.id, path: entryPath, target, attempts };
    if (target) text.target = target;
    // Crash-safe marker: if the job is killed mid-text, the next run finds and resumes it.
    const since = pending.items.find((p) => p.id === text.id)?.since ?? today;
    upsert({ id: text.id, path: entryPath, target, steps: stepsFor(text), reason: 'running', since, attempts });
    await enrich(text, deps(entryPath));
    pending.items = pending.items.filter((p) => p.id !== text.id);
    repo.savePending(pending);
    result.annotated.push(text.id);
    console.log(`  ✓ annotated ${text.id} [${text.level}] ${text.title} (${text.ai?.calls} Claude calls)`);
    current = undefined;
  };

  const park = (item: PendingItem) => {
    try {
      const text = repo.loadText(item.path);
      text.parked = true;
      deps(item.path).save(text);
    } catch {
      // file gone or unreadable: dropping it from pending is all we can do
    }
    pending.items = pending.items.filter((p) => p.id !== item.id);
    repo.savePending(pending);
    result.parked.push(item.id);
    console.log(`  ⛔ parked ${item.id} after ${item.attempts} failed attempts`);
  };

  try {
    // 1. Unfinished texts first; each one counts as that day's text.
    for (const item of [...pending.items]) {
      if (result.annotated.length >= config.annotatePerRun) break;
      // A failure or an interrupted run counts against the text; limits/budget/Claude outages don't.
      const attempts = item.reason === 'error' || item.reason === 'running' ? item.attempts + 1 : item.attempts;
      if (attempts > MAX_ATTEMPTS) {
        park({ ...item, attempts });
        continue;
      }
      await finish(item.path, item.target, attempts);
    }

    // 2. Today's pick.
    while (result.annotated.length < config.annotatePerRun) {
      const target = nextTarget(index, config.levelRotation);
      const pool = poolOf(index, today, config.poolDays, new Set(pending.items.map((p) => p.id)));
      if (pool.length === 0) {
        console.log('  pool is empty — nothing to annotate today');
        break;
      }
      const covered = new Map<string, number | null>();
      const coverage = (e: IndexEntry) => {
        if (!known) return null;
        if (!covered.has(e.id)) covered.set(e.id, coverageOf(repo.loadText(e.path).sentences.map((s) => s.t), dict, known));
        return covered.get(e.id)!;
      };
      const ordered = orderPool(pool, target, coverage, config.coverageBand);
      console.log(`  target level ${target}; pool ${pool.length}`);
      if (known) {
        const pct = (e: IndexEntry) => (coverage(e) === null ? '–' : `${Math.round(coverage(e)! * 100)} %`);
        console.log(`  known words ${known.size}; coverage ${ordered.map((e) => `${e.id} ${e.level ?? e.levelHeuristic} ${pct(e)}`).join(', ')}`);
      }

      let chosen = ordered.find((e) => e.level === target);
      let leveledNow = 0;
      for (const e of ordered) {
        if (chosen || leveledNow >= config.levelCallsPerRun) break;
        if (e.level) continue; // already rated by AI and not the target
        const text = repo.loadText(e.path);
        text.version = 2;
        text.ai ??= { model: config.claudeModel, calls: 0 };
        const before = claude.calls;
        await levelText(text, deps(e.path));
        text.ai.calls += claude.calls - before;
        deps(e.path).save(text);
        leveledNow++;
        result.leveled.push(`${e.id}:${text.level}`);
        console.log(`  leveled ${e.id}: heuristic ${e.levelHeuristic} → AI ${text.level}`);
        if (text.level === target) chosen = index.texts.find((t) => t.id === e.id);
      }
      // No exact match within the leveling budget: the closest AI-rated (else heuristic) text.
      chosen ??= orderPool(
        pool.map((e) => index.texts.find((t) => t.id === e.id)!),
        target,
        coverage,
        config.coverageBand,
      ).sort((a, b) => Number(!!b.level) - Number(!!a.level))[0]; // stable: keeps level/coverage order
      if (!chosen) break;
      await finish(chosen.path, target, 0);
    }
  } catch (e) {
    if (e instanceof ClaudeLimitError) {
      result.stoppedBy = e.kind;
      result.message = e.message;
      if (current) recordPending(e.kind);
      return result;
    }
    // Claude unusable (auth/install) is not the text's fault; anything else is.
    if (current) recordPending(e instanceof ClaudeFatalError ? 'blocked' : 'error');
    throw e;
  }
  return result;

  function recordPending(reason: PendingItem['reason']) {
    const c = current!;
    try {
      const text = repo.loadText(c.path); // state as saved after the last finished step
      const since = pending.items.find((p) => p.id === c.id)?.since ?? today;
      const item = { id: c.id, path: c.path, target: c.target, steps: stepsFor(text), reason, since, attempts: c.attempts };
      upsert(item);
      console.log(`  ⏸ ${reason}: ${c.id} left in state/pending.json → ${JSON.stringify(item.steps)}`);
    } catch (err) {
      // Never hide the original error behind a bookkeeping error; the 'running' marker stays.
      console.log(`  (could not update pending for ${c.id}: ${err instanceof Error ? err.message : String(err)})`);
    }
  }
}
