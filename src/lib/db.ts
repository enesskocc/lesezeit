import Dexie, { type Table } from 'dexie';
import type { TextFile } from '../../shared/texts';

/**
 * Keys. They never leave the device except as request headers to their own API (GitHub / Gemini).
 */
export interface Settings {
  id: 'main';
  githubToken: string;
  geminiKey: string; // optional until milestone 8; '' when not set
  updatedAt: string; // ISO timestamp
}

/** Reader preferences (separate row, so saving keys never resets them). */
export interface Prefs {
  id: 'main';
  guessMode: boolean; // spec: default on
  articleColors: boolean; // der/die/das colours on nouns
  ttsRate: number; // 0.7 – 1.2
  lastText?: { date: string; id: string }; // for the "Okuma" tab
}
export const DEFAULT_PREFS: Prefs = { id: 'main', guessMode: true, articleColors: false, ttsRate: 0.9 };

/** Known-ness per lemma (spec: per lemma, not per form). No row = "new". */
export type WordState = 'learning' | 'known' | 'ignored';
export interface WordStatusRow {
  key: string; // "w:anfangen" (lemma) or "m:eine entscheidung treffen" (multi-word expression)
  state: WordState;
  updatedAt: string;
}

/** A word or expression saved while reading. FSRS scheduling is added in milestone 6. */
export interface CardRow {
  id: string; // = status key
  kind: 'lemma' | 'mwe';
  display: string; // "der Plan", "anfangen", "eine Entscheidung treffen"
  pos?: string;
  meaning_tr: string;
  contexts: { textId: string; date: string; s: number; sentence: string; tokens: number[] }[];
  createdAt: string;
  via: 'add' | 'guess'; // "+ Kartlara ekle" or a wrong guess
}

export interface ReadingLogRow {
  id?: number;
  textId: string;
  date: string; // text date
  startedAt: string;
  finishedAt: string;
  seconds: number;
  newCards: number;
  correct: number;
  answered: number;
}

/** Downloaded texts for offline reading (spec: textCache). */
export interface TextCacheRow {
  id: string;
  date: string;
  annotatedAt?: string; // re-download when the pipeline re-annotates
  text: TextFile;
  cachedAt: string;
}

class LesezeitDB extends Dexie {
  settings!: Table<Settings, Settings['id']>;
  prefs!: Table<Prefs, Prefs['id']>;
  wordStatus!: Table<WordStatusRow, string>;
  cards!: Table<CardRow, string>;
  readingLog!: Table<ReadingLogRow, number>;
  textCache!: Table<TextCacheRow, string>;

  constructor() {
    super('lesezeit');
    this.version(1).stores({ settings: 'id' });
    // Milestone 5: reader state. Dexie keeps the existing keys when upgrading.
    this.version(2).stores({
      settings: 'id',
      prefs: 'id',
      wordStatus: 'key, state',
      cards: 'id, createdAt',
      readingLog: '++id, textId, startedAt',
      textCache: 'id, date',
    });
  }
}

export const db = new LesezeitDB();

export async function saveKeys(githubToken: string, geminiKey: string): Promise<void> {
  await db.settings.put({ id: 'main', githubToken, geminiKey, updatedAt: new Date().toISOString() });
  // Ask the browser not to evict IndexedDB under storage pressure. Best effort: Safari may ignore it.
  await navigator.storage?.persist?.().catch(() => false);
}

export async function clearKeys(): Promise<void> {
  await db.settings.delete('main');
}

export async function getPrefs(): Promise<Prefs> {
  return { ...DEFAULT_PREFS, ...(await db.prefs.get('main')) };
}

export async function setPrefs(patch: Partial<Omit<Prefs, 'id'>>): Promise<void> {
  // Read-merge-write in one transaction: two quick toggles must not overwrite each other.
  await db.transaction('rw', db.prefs, async () => {
    await db.prefs.put({ ...DEFAULT_PREFS, ...(await db.prefs.get('main')), ...patch, id: 'main' });
  });
}
