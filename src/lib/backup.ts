// Progress backup to lesezeit-data (spec "Backup and sync"). Every change to the learning state
// (word colours, cards, reviews, readings) schedules a backup: 30 s after the last change and at
// most every 10 minutes. The previous backup is kept as progress.prev.json; the last write wins.
import Dexie from 'dexie';
import { BACKUP_PATH, BACKUP_PREV_PATH, ProgressBackupSchema, type ProgressBackup } from '../../shared/backup';
import { db, getPrefs, setPrefs, type CardRow, type Prefs, type ReadingLogRow, type ReviewLogRow, type WordStatusRow } from './db';
import { GitHubError, readDataJson, writeDataJson } from './github';

const QUIET_MS = 30_000;
const MIN_GAP_MS = 10 * 60_000;

/** Prefs that belong to this device only, never restored from a backup. */
const LOCAL_PREFS = ['id', 'backupAt', 'backupError'] as const;

export async function snapshot(now = new Date()): Promise<ProgressBackup> {
  const [wordStatus, cards, reviewLog, readingLog, prefs] = await Promise.all([
    db.wordStatus.toArray(),
    db.cards.toArray(),
    db.reviewLog.toArray(),
    db.readingLog.toArray(),
    getPrefs(),
  ]);
  const shared = Object.fromEntries(Object.entries(prefs).filter(([k]) => !(LOCAL_PREFS as readonly string[]).includes(k)));
  return {
    version: 1,
    exportedAt: now.toISOString(),
    wordStatus,
    cards: cards as unknown as ProgressBackup['cards'],
    reviewLog: reviewLog as unknown as ProgressBackup['reviewLog'],
    readingLog: readingLog as unknown as ProgressBackup['readingLog'],
    prefs: shared,
  };
}

let running: Promise<void> | null = null;

/** Writes the backup now (the old one becomes progress.prev.json). One at a time. */
export function backupNow(token: string): Promise<void> {
  running ??= (async () => {
    try {
      const data = await snapshot();
      try {
        await writeDataJson(token, BACKUP_PREV_PATH, await readDataJson(token, BACKUP_PATH), 'Backup (previous)');
      } catch (e) {
        if (!(e instanceof GitHubError && e.status === 404)) throw e; // first backup: nothing to keep
      }
      await writeDataJson(token, BACKUP_PATH, data, `Backup ${data.exportedAt.slice(0, 16).replace('T', ' ')}`);
      await setPrefs({ backupAt: data.exportedAt, backupError: undefined });
    } catch (e) {
      await setPrefs({ backupError: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

let token: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let paused = false;

/** Called on every change to the learning state: back up once things are quiet. */
function changed() {
  if (!token || paused) return;
  clearTimeout(timer);
  // Hooks run inside the writing transaction, which does not include prefs: read outside it.
  void Dexie.ignoreTransaction(getPrefs)
    .then((p) => {
      clearTimeout(timer);
      const since = p.backupAt ? Date.now() - Date.parse(p.backupAt) : Infinity;
      timer = setTimeout(() => {
        if (token) void backupNow(token).catch(() => {}); // the error is shown in Ayarlar
      }, Math.max(QUIET_MS, MIN_GAP_MS - since));
    })
    .catch((e: unknown) => console.warn('auto-backup not scheduled', e));
}

let hooked = false;

/**
 * Starts automatic backups for this token. Also catches up on changes made since the last backup
 * (iOS may close the app before the 30 s timer fires).
 */
export async function startAutoBackup(t: string): Promise<void> {
  token = t;
  if (!hooked) {
    hooked = true;
    for (const table of [db.wordStatus, db.cards, db.reviewLog, db.readingLog] as const) {
      table.hook('creating', changed);
      table.hook('updating', changed);
      table.hook('deleting', changed);
    }
  }
  const { backupAt } = await getPrefs();
  const since = backupAt ?? '';
  const pending =
    (await db.reviewLog.where('at').above(since).count()) > 0 ||
    (await db.readingLog.where('startedAt').above(since).count()) > 0 ||
    (await db.cards.where('createdAt').above(since).count()) > 0 ||
    (await db.wordStatus.filter((w) => w.updatedAt > since).count()) > 0;
  if (pending) changed();
}

export function stopAutoBackup(): void {
  token = null;
  clearTimeout(timer);
}

/**
 * "Yedekten geri yükle": replaces the learning state on this phone with the backup (a new phone,
 * or after deleting the app). Keys and downloaded texts stay as they are.
 */
export async function restoreBackup(t: string): Promise<{ cards: number; words: number }> {
  let raw: unknown;
  try {
    raw = await readDataJson(t, BACKUP_PATH);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) throw new Error('Henüz bir yedek yok.');
    throw e;
  }
  const b = ProgressBackupSchema.parse(raw);
  paused = true; // the restore itself is not a change worth backing up again
  try {
    await db.transaction('rw', [db.wordStatus, db.cards, db.reviewLog, db.readingLog, db.prefs], async () => {
      await Promise.all([db.wordStatus.clear(), db.cards.clear(), db.reviewLog.clear(), db.readingLog.clear()]);
      await db.wordStatus.bulkPut(b.wordStatus as WordStatusRow[]);
      await db.cards.bulkPut(b.cards as unknown as CardRow[]);
      await db.reviewLog.bulkPut(b.reviewLog as unknown as ReviewLogRow[]);
      await db.readingLog.bulkPut(b.readingLog as unknown as ReadingLogRow[]);
      const restored = Object.fromEntries(Object.entries(b.prefs ?? {}).filter(([k]) => !(LOCAL_PREFS as readonly string[]).includes(k)));
      await setPrefs({ ...(restored as Partial<Prefs>), backupAt: b.exportedAt, backupError: undefined });
    });
  } finally {
    paused = false;
  }
  return { cards: b.cards.length, words: b.wordStatus.length };
}
