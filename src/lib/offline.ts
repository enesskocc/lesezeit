// Offline reading (spec: textCache; Enes 2026-10-21: download automatically). Annotated texts are
// stored in IndexedDB with their embedded dictionary entries (text.dict), so a text and its word
// sheets open in airplane mode. The app shell itself comes from the service worker precache.
import type { IndexEntry, TextFile } from '../../shared/texts';
import { db } from './db';
import { loadText } from './texts';

/** Cached texts older than this are removed (they can always be downloaded again online). */
const KEEP_DAYS = 45;

/** Cache first; on a miss download and keep it. */
export async function openText(token: string, date: string, id: string): Promise<{ text: TextFile; fromCache: boolean }> {
  const cached = await db.textCache.get(id);
  if (cached) return { text: cached.text, fromCache: true };
  let text: TextFile;
  try {
    text = await loadText(token, date, id);
  } catch (e) {
    if (!navigator.onLine) throw new Error('Bu metin henüz indirilmemiş; çevrimdışıyken açılamıyor.');
    throw e;
  }
  if (text.annotated) await put(text);
  return { text, fromCache: false };
}

async function put(text: TextFile) {
  await db.textCache.put({ id: text.id, date: text.date, annotatedAt: text.annotatedAt, text, cachedAt: new Date().toISOString() });
}

let inFlight: Promise<number> | null = null;

/**
 * Downloads every annotated text of the list that is missing or outdated (re-annotated, or cached
 * before it had its offline dictionary), and drops old ones. Only one sync runs at a time: Home
 * can mount repeatedly while a download is still going. Failures are retried on the next visit.
 */
export function syncTextCache(token: string, entries: IndexEntry[]): Promise<number> {
  inFlight ??= (async () => {
    let downloaded = 0;
    try {
      const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
      await db.textCache.where('date').below(cutoff).delete();
      for (const e of entries) {
        if (!e.annotated || e.date < cutoff) continue;
        const cached = await db.textCache.get(e.id);
        if (cached && cached.annotatedAt === e.annotatedAt && cached.text.dict) continue;
        try {
          await put(await loadText(token, e.date, e.id));
          downloaded++;
        } catch {
          // offline or rate-limited: try again next time
        }
      }
    } finally {
      inFlight = null;
    }
    return downloaded;
  })();
  return inFlight;
}

/** Index entries rebuilt from the cache (home list when GitHub cannot be reached). */
export async function cachedEntries(): Promise<IndexEntry[]> {
  const rows = await db.textCache.orderBy('date').reverse().toArray();
  return rows.map(({ text: x }) => ({
    id: x.id, kind: x.kind, date: x.date, source: x.source, sourceName: x.sourceName, url: x.url, title: x.title,
    wordCount: x.wordCount, levelHeuristic: x.levelHeuristic, level: x.level, annotated: x.annotated,
    annotatedAt: x.annotatedAt, topic: x.topic, path: `texts/${x.date}/${x.id}.json`,
  }));
}
