import Dexie, { type Table } from 'dexie';
import { normalizeKey, type LemmaEntry } from '../../shared/dict';
import type { Mwe, TextFile } from '../../shared/texts';
import { tokenSpans } from './exercises';
import { lemmaOfDisplay, newFsrs, type FsrsCard } from './srs';

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
  newPerDay: number; // spec: new cards per day, default 15
  maxReviews: number; // spec: max reviews per day, default 150
  sessionMinutes: number; // last chosen session length; 0 = "all due"
}
export const DEFAULT_PREFS: Prefs = {
  id: 'main', guessMode: true, articleColors: false, ttsRate: 0.9, newPerDay: 15, maxReviews: 150, sessionMinutes: 10,
};

/** Known-ness per lemma (spec: per lemma, not per form). No row = "new". */
export type WordState = 'learning' | 'known' | 'ignored';
export interface WordStatusRow {
  key: string; // "w:anfangen" (lemma) or "m:eine entscheidung treffen" (multi-word expression)
  state: WordState;
  updatedAt: string;
}

export interface CardContext {
  textId: string;
  date: string;
  s: number;
  sentence: string;
  tokens: number[];
  forms?: string[]; // the saved tokens as written in the sentence ("fängt", "an") — for cloze
  spans?: [number, number][]; // their character ranges in `sentence`, so the cloze blanks the right occurrence
}

/** A word or expression saved while reading, scheduled with FSRS. */
export interface CardRow {
  id: string; // = status key
  kind: 'lemma' | 'mwe';
  display: string; // "der Plan", "anfangen", "eine Entscheidung treffen"
  lemma: string; // "Plan", "anfangen", "eine Entscheidung treffen" (display without article / "sich")
  pos?: string; // UPOS
  meaning_tr: string;
  contexts: CardContext[];
  createdAt: string;
  via: 'add' | 'guess'; // "+ Kartlara ekle" or a wrong guess
  entry?: LemmaEntry; // dictionary data at save time (article, plural, family) — works offline
  mweKind?: Mwe['kind'];
  fsrs: FsrsCard;
  due: number; // = fsrs.due as epoch ms, indexed
}

/** One answered exercise. `practice` rows did not change the schedule (card was not due). */
export interface ReviewLogRow {
  id?: number;
  cardId: string;
  at: string; // ISO
  rating: 1 | 2 | 3 | 4; // Again / Hard / Good / Easy
  exercise: string;
  ms: number; // answer time
  stateBefore: FsrsCard['state'];
  dueAfter?: number;
  practice?: boolean;
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
  reviewLog!: Table<ReviewLogRow, number>;

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
    // Milestone 6: FSRS. Cards saved during milestone 5 become new cards; their dictionary data
    // and cloze forms are filled from the cached text when it is still on the phone.
    this.version(3)
      .stores({ cards: 'id, createdAt, due', reviewLog: '++id, cardId, at' })
      .upgrade(async (tx) => {
        const texts = new Map<string, TextFile>();
        await tx.table<TextCacheRow, string>('textCache').each((r) => void texts.set(r.id, r.text));
        await tx.table('cards').toCollection().modify((c: Partial<CardRow> & { display: string; createdAt: string }) => {
          // A throw here would abort the upgrade on every launch and lock the whole database:
          // the schedule is set first with safe fallbacks, the extras are best effort per context.
          c.lemma ??= lemmaOfDisplay(String(c.display ?? ''));
          c.contexts = Array.isArray(c.contexts) ? c.contexts : [];
          if (!c.fsrs) {
            const created = new Date(c.createdAt);
            c.fsrs = newFsrs(Number.isNaN(created.getTime()) ? new Date() : created);
            c.due = Date.parse(c.fsrs.due);
          }
          for (const ctx of c.contexts) {
            try {
              const text = texts.get(ctx.textId);
              const sent = text?.sentences[ctx.s];
              if (!ctx.forms && sent?.tok && Array.isArray(ctx.tokens)) {
                // Milestone 5 saved the whole highlight group; a word card's gaps are only its own tokens.
                const own = [...ctx.tokens]
                  .sort((a, b) => a - b)
                  .filter((i) => c.kind === 'mwe' || normalizeKey(sent.tok![i]?.l ?? '') === normalizeKey(c.lemma!));
                ctx.forms = own.map((i) => sent.tok![i]?.s ?? '').filter(Boolean);
                ctx.spans = tokenSpans(ctx.sentence, sent.tok, own);
              }
              if (!c.entry && c.kind === 'lemma' && text?.dict) {
                const hits = text.dict[normalizeKey(c.lemma)];
                c.entry = hits?.find((e) => e.w === c.lemma) ?? hits?.[0];
              }
              if (!c.mweKind && c.kind === 'mwe') c.mweKind = text?.mwes?.find((m) => m.de === c.display)?.kind;
            } catch {
              // keep the card without cloze forms / dictionary data
            }
          }
        });
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
