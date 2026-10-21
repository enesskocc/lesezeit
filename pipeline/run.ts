// Daily content pipeline, milestone 3: no AI yet.
//   node pipeline/run.ts --data <lesezeit-data folder> [--dict public/dict]
//
// 1. fetch all feeds, dedupe by URL hash   2. extract main text, reject paywall/live/short/long
// 3. store text + metadata                 4. difficulty heuristics → levelHeuristic
// Writes texts/, texts/index.json, state/seen.json, state/last-run.json. Committing is the workflow's job.
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { Source, TextFile } from '../shared/texts.ts';
import { FsDictionary } from './dict-fs.ts';
import { extractArticle } from './extract.ts';
import { canonicalUrl, fetchText, interleave, parseFeed, quickReject, urlHash, type FeedItem } from './feeds.ts';
import { computeHeuristics, levelFromScore } from './heuristics.ts';
import { berlinDate, DataRepo } from './store.ts';
import { splitSentences, words } from './text.ts';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const { values: args } = parseArgs({
  options: {
    data: { type: 'string' },
    dict: { type: 'string', default: path.join(APP_ROOT, 'public/dict') },
  },
});
if (!args.data) {
  console.error('Usage: node pipeline/run.ts --data <lesezeit-data folder> [--dict <public/dict>]');
  process.exit(2);
}
// Full news texts must never land in the public app repo.
const dataRoot = path.resolve(args.data);
if (dataRoot === APP_ROOT || dataRoot.startsWith(APP_ROOT + path.sep)) {
  console.error(`Refusing to write texts into the public app repo (${dataRoot}). Use the lesezeit-data folder.`);
  process.exit(2);
}

// GitHub Actions shows "::warning::" lines as annotations on the run page.
const warn = (msg: string) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `WARNING: ${msg}`);

const repo = new DataRepo(dataRoot);
const dict = new FsDictionary(args.dict!);
const config = repo.config();
const today = berlinDate();
const index = repo.index();
const seen = repo.seen(today);
const known = new Set(index.texts.map((t) => t.id));

const log = {
  date: today,
  startedAt: new Date().toISOString(),
  stored: [] as { id: string; source: string; title: string; words: number; level: string }[],
  rejected: {} as Record<string, number>,
  transient: 0, // blocked / overloaded / timed out: not remembered, retried next run
  feedErrors: [] as string[],
  errors: [] as string[],
  fetched: 0,
};
const reject = (id: string, reason: NonNullable<(typeof seen.urls)[string]['reason']>) => {
  seen.urls[id] = { date: today, status: 'rejected', reason };
  log.rejected[reason] = (log.rejected[reason] ?? 0) + 1;
};
// 403/429/5xx/timeouts say more about the moment (or the runner's IP) than about the article.
const isTransient = (status: number) => status === 403 || status === 408 || status === 429 || status >= 500;

// 1. Feeds → candidates per source.
type Candidate = FeedItem & { id: string; source: Source };
const groups: Candidate[][] = [];
for (const source of repo.sources()) {
  const group: Candidate[] = [];
  for (const feed of source.feeds) {
    let items: FeedItem[];
    try {
      const res = await fetchText(feed);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      items = parseFeed(res.body);
    } catch (e) {
      log.feedErrors.push(`${source.id} ${feed}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    // One broken item (relative link, non-URL guid) must not drop the rest of the feed.
    for (const item of items) {
      let url: string;
      try {
        url = canonicalUrl(new URL(item.url, feed).toString());
        if (!/^https?:$/.test(new URL(url).protocol)) continue;
      } catch {
        continue;
      }
      const id = urlHash(url);
      if (known.has(id) || seen.urls[id] || group.some((c) => c.id === id)) continue;
      const quick = quickReject({ ...item, url });
      if (quick) {
        reject(id, quick);
        continue;
      }
      group.push({ ...item, url, id, source });
    }
  }
  groups.push(group);
}
const candidates = interleave(groups);
console.log(`${candidates.length} new candidates from ${groups.length} sources`);

// 2–4. Extract, filter, measure, store — until maxTextsPerRun texts are stored.
async function processCandidate(c: Candidate): Promise<void> {
  let html: string;
  try {
    const res = await fetchText(c.url);
    if (isTransient(res.status)) {
      log.transient++;
      return;
    }
    if (res.status !== 200 || !res.type.includes('html')) return reject(c.id, 'http');
    html = res.body;
  } catch {
    log.transient++; // network error or timeout
    return;
  }

  const ex = extractArticle(html, c.url, c.source);
  if (!ex.ok) return reject(c.id, ex.reason);
  const wordCount = words(ex.paragraphs.join(' ')).length;
  if (wordCount < config.minWords) return reject(c.id, 'short'); // teaser-only pages end here
  if (wordCount > config.maxWords) return reject(c.id, 'long');

  const sentences = ex.paragraphs.flatMap((p, i) => splitSentences(p).map((t) => ({ p: i, t })));
  const heuristics = computeHeuristics(sentences.map((s) => s.t), dict);
  const text: TextFile = {
    version: 1,
    id: c.id,
    kind: 'news',
    date: today,
    source: c.source.id,
    sourceName: c.source.name,
    url: c.url,
    title: ex.title || c.title,
    publishedAt: ex.publishedAt ?? c.publishedAt,
    fetchedAt: new Date().toISOString(),
    wordCount,
    paragraphs: ex.paragraphs,
    sentences,
    heuristics,
    levelHeuristic: levelFromScore(heuristics.score),
    annotated: false,
  };
  repo.saveText(text, index);
  seen.urls[c.id] = { date: today, status: 'stored' };
  known.add(c.id);
  log.stored.push({ id: c.id, source: c.source.id, title: text.title, words: wordCount, level: text.levelHeuristic });
  console.log(`  + [${text.levelHeuristic} ${heuristics.score}] ${c.source.id}: ${text.title} (${wordCount} words)`);
}

const lastHit = new Map<string, number>();
for (const c of candidates) {
  if (log.stored.length >= config.maxTextsPerRun || log.fetched >= config.maxFetchesPerRun) break;
  // Politeness: at most one page request per second and host.
  const host = new URL(c.url).host;
  const wait = (lastHit.get(host) ?? 0) + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
  log.fetched++;
  try {
    await processCandidate(c);
  } catch (e) {
    // A page that crashes jsdom/Readability is skipped and remembered, never retried at the
    // front of the queue — otherwise one bad URL would stop every future run.
    reject(c.id, 'extract');
    log.errors.push(`${c.url}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

repo.saveIndex(index);
repo.saveSeen(seen);
repo.saveRunLog({ ...log, finishedAt: new Date().toISOString() });

console.log(
  `\nStored ${log.stored.length}/${config.maxTextsPerRun} · fetched ${log.fetched} · transient ${log.transient} · rejected ${JSON.stringify(log.rejected)}`,
);
for (const e of log.feedErrors) warn(`Feed error: ${e}`);
for (const e of log.errors) warn(`Extraction crashed: ${e}`);
if (log.stored.length < config.maxTextsPerRun) warn(`Only ${log.stored.length} of ${config.maxTextsPerRun} texts stored.`);
// Every page download was blocked/failed (runner IP blocked?) or every feed failed:
// fail the run so GitHub shows it red and e-mails the owner. A quiet news day is not an error.
const allBlocked = log.stored.length === 0 && log.fetched > 0 && log.transient === log.fetched;
const allFeedsDown = candidates.length === 0 && log.feedErrors.length > 0 && log.feedErrors.length >= repo.sources().length;
if (allBlocked || allFeedsDown) process.exit(1);
