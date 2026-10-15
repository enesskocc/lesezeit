import Dexie, { type Table } from 'dexie';

/**
 * Single settings row. Keys never leave the device except as request headers
 * to their own API (GitHub / Gemini). Later milestones add limits, font, voice, …
 */
export interface Settings {
  id: 'main';
  githubToken: string;
  geminiKey: string; // optional until milestone 8; '' when not set
  updatedAt: string; // ISO timestamp
}

class LesezeitDB extends Dexie {
  settings!: Table<Settings, Settings['id']>;

  constructor() {
    super('lesezeit');
    // Bump the version and add stores here (cards, wordStatus, …) in later milestones.
    this.version(1).stores({ settings: 'id' });
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
