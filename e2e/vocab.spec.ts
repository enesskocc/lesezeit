import { expect, test, type Page } from '@playwright/test';
import { FAKE_TOKEN, mockReaderApi, readerText, setupAndOpen, TEXT_DATE, TEXT_ID, word } from './fixtures';

// Milestone 6: FSRS cards and the vocabulary trainer, with the synthetic reader text (e2e/fixtures.ts).

/** What the six cards saved from the fixture text expect as answers. */
const CARDS: Record<string, { de: string; tr: string; cloze: string; at: [number, number] }> = {
  'w:anfangen': { de: 'anfangen', tr: 'başlıyor', cloze: 'fängt an', at: [0, 1] },
  'w:morgen': { de: 'morgen', tr: 'yarın', cloze: 'morgen', at: [0, 2] },
  'w:er': { de: 'er', tr: 'o', cloze: 'Er', at: [0, 0] },
  'w:haus': { de: 'das Haus', tr: 'ev', cloze: 'Haus', at: [1, 1] },
  'w:sein': { de: 'sein', tr: '-dir', cloze: 'ist', at: [1, 2] },
  'w:alt': { de: 'alt', tr: 'eski', cloze: 'alt', at: [1, 3] },
};
const byDe = new Map(Object.entries(CARDS).map(([id, c]) => [c.de, { id, ...c }]));

interface StoredCard {
  id: string;
  lemma: string;
  due: number;
  fsrs: { state: number; reps: number };
  entry?: { g?: string };
  contexts: { forms?: string[] }[];
}
interface StoredLog {
  cardId: string;
  at: string;
  exercise: string;
  rating: number;
  dueAfter?: number;
  practice?: boolean;
}

/** Reads the app's IndexedDB directly (no Dexie in the page scope). */
async function readDb(page: Page): Promise<{ cards: StoredCard[]; logs: StoredLog[] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('lesezeit');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const all = <T,>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        const q = db.transaction(store).objectStore(store).getAll();
        q.onsuccess = () => resolve(q.result as T[]);
        q.onerror = () => reject(q.error);
      });
    const out = { cards: await all<StoredCard>('cards'), logs: await all<StoredLog>('reviewLog') };
    db.close();
    return out;
  });
}

/** Saves words from the reader as cards (guess mode off, "+ Kartlara ekle"). */
async function addCards(page: Page, ids: string[]) {
  await page.getByRole('button', { name: /Tahmin modu: açık/ }).click();
  for (const id of ids) {
    const [s, i] = CARDS[id]!.at;
    await word(page, s, i).click();
    await page.getByRole('button', { name: '+ Kartlara ekle' }).click();
    await expect(page.getByRole('button', { name: 'Kartlarda' })).toBeDisabled();
    await page.getByTestId('scrim').click({ position: { x: 20, y: 20 } });
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Answers whatever exercise is on screen, correctly. Returns its kind. `pause` runs right before the
 * final tap ("Devam" / "İyi"): time spent reading the feedback, so the answer itself stays fast.
 */
async function answerCorrectly(page: Page, pause: () => Promise<void> = async () => {}): Promise<string> {
  const ex = page.locator('[data-testid^="ex-"]').first();
  const kind = (await ex.getAttribute('data-testid'))!;
  const card = CARDS[(await ex.getAttribute('data-card')) ?? ''];
  switch (kind) {
    case 'ex-flash':
      await page.getByRole('button', { name: 'Göster' }).click();
      await pause();
      await page.getByRole('button', { name: /^İyi/ }).click();
      return kind;
    case 'ex-match': {
      for (const left of await page.locator('[data-side="l"]').allInnerTexts()) {
        await page.locator('[data-side="l"]').filter({ hasText: new RegExp(`^${escapeRe(left)}$`) }).click();
        const tr = byDe.get(left)!.tr;
        await page.locator('[data-side="r"]').filter({ hasText: new RegExp(`^${escapeRe(tr)}$`) }).click();
      }
      break;
    }
    case 'ex-cloze':
      await page.getByRole('textbox').fill(card!.cloze);
      await page.getByRole('button', { name: 'Kontrol' }).click();
      break;
    case 'ex-artikel':
      await page.getByRole('button', { name: 'das', exact: true }).click();
      await page.getByRole('textbox', { name: 'Çoğul' }).fill('Häuser');
      await page.getByRole('button', { name: 'Kontrol' }).click();
      break;
    case 'ex-production':
      await page.getByRole('textbox').fill(card!.de);
      await page.getByRole('button', { name: 'Kontrol' }).click();
      break;
    default:
      throw new Error(`unexpected exercise ${kind}`);
  }
  await expect(page.getByTestId('feedback')).toContainText(/Doğru|hatasız/);
  await pause();
  await page.getByRole('button', { name: 'Devam' }).click();
  return kind;
}

test.beforeEach(async ({ page }) => {
  await mockReaderApi(page);
  // Cards get their dictionary data only from the text's embedded entries: an online lookup that
  // finishes before or after "+ Kartlara ekle" would change the matching modes from run to run.
  await page.route('**/lesezeit/dict/**', (route) => route.abort());
});

test('ACCEPTANCE: a 10-minute mixed session runs and the due dates update correctly', async ({ page }) => {
  test.setTimeout(120_000); // ~14 real exercises, each answered through the UI
  await page.clock.install({ time: new Date('2026-10-22T08:00:00') });
  await setupAndOpen(page);
  await addCards(page, Object.keys(CARDS));

  await page.getByRole('link', { name: 'Kelimeler' }).click();
  await expect(page.getByTestId('vocab-stats')).toContainText('6Yeni');
  await page.getByRole('button', { name: '10 dk' }).click();
  const start = await page.evaluate(() => Date.now());
  await page.getByRole('button', { name: 'Oturumu başlat · 6 kart' }).click();

  const kinds: string[] = [];
  for (let n = 0; n < 60; n++) {
    const next = page.locator('[data-step], [data-testid="session-summary"]').first();
    await expect(next).toBeVisible();
    if (await page.getByTestId('session-summary').isVisible()) break;
    const step = await next.getAttribute('data-step');
    // ~45 s per exercise, spent on the feedback: the 10 minutes run out before all cards graduate.
    kinds.push(await answerCorrectly(page, () => page.clock.fastForward(45_000)));
    // The next exercise (or the summary) replaces this one.
    await expect(page.locator(`[data-step="${step}"]`)).toHaveCount(0);
  }
  await expect(page.getByTestId('session-summary')).toContainText(/Oturum bitti/);
  await expect(page.getByTestId('session-summary')).toContainText('%100 doğru');
  const end = await page.evaluate(() => Date.now());
  expect(end - start).toBeGreaterThanOrEqual(10 * 60_000);
  expect(new Set(kinds)).toEqual(new Set(['ex-flash', 'ex-match', 'ex-cloze']));

  const { cards, logs } = await readDb(page);
  expect(cards).toHaveLength(6);
  expect(new Set(logs.map((l) => l.rating)), 'fast, correct answers on new cards are all Good').toEqual(new Set([3]));
  for (const c of cards) {
    const own = logs.filter((l) => l.cardId === c.id && !l.practice);
    expect(own.length, c.id).toBeGreaterThan(0);
    expect(c.fsrs.state, `${c.id} was started`).not.toBe(0);
    expect(own.at(-1)!.dueAfter, `${c.id}: card due = last review's result`).toBe(c.due);
    for (const l of own) expect(l.dueAfter!).toBeGreaterThan(Date.parse(l.at));
    const last = Date.parse(own.at(-1)!.at);
    if (c.fsrs.state === 2) expect(c.due - last, `${c.id} graduated → days`).toBeGreaterThan(20 * 3600_000);
    else expect(c.due - last, `${c.id} still learning → minutes`).toBeLessThanOrEqual(10 * 60_000);
  }
  // Learning steps in order: flashcard → matching → cloze.
  const graduated = cards.filter((c) => c.fsrs.state === 2);
  expect(graduated.length).toBeGreaterThan(0);
  for (const c of graduated) {
    expect(logs.filter((l) => l.cardId === c.id && !l.practice).map((l) => l.exercise)).toEqual(['flash-de', 'match', 'cloze']);
  }

  // The tab shows the new schedule: no new cards left for today.
  await page.getByRole('link', { name: 'Kelimelere dön' }).click();
  await expect(page.getByTestId('vocab-stats')).toContainText('0Yeni');
});

test('a drill on a new card is practice: the schedule does not change', async ({ page }) => {
  await setupAndOpen(page);
  await addCards(page, ['w:haus']);
  await page.getByRole('link', { name: 'Kelimeler' }).click();
  await page.getByRole('button', { name: 'Artikel & Plural' }).click();
  await expect(page.getByTestId('ex-artikel')).toContainText('ev');
  await page.getByRole('button', { name: 'der', exact: true }).click(); // wrong on purpose
  await page.getByRole('textbox', { name: 'Çoğul' }).fill('Häuser');
  await page.getByRole('button', { name: 'Kontrol' }).click();
  await expect(page.getByTestId('feedback')).toContainText('Yanlış');
  await expect(page.getByTestId('feedback')).toContainText('das Haus · die Häuser');
  await page.getByRole('button', { name: 'Devam' }).click();
  // The wrong card is asked once more at the end of the drill, with the same exercise.
  await expect(page.getByTestId('ex-artikel')).toBeVisible();
  await answerCorrectly(page);
  await expect(page.getByTestId('session-summary')).toContainText('2 cevap · %50 doğru');

  const { cards, logs } = await readDb(page);
  expect(cards[0]!.fsrs.state).toBe(0);
  expect(logs.map((l) => [l.exercise, l.rating, !!l.practice])).toEqual([
    ['artikel', 1, true],
    ['artikel', 3, true],
  ]);
});

test('card list → detail with its sentence and a link back to the text; delete can be undone', async ({ page }) => {
  await setupAndOpen(page);
  await addCards(page, ['w:haus', 'w:anfangen']);
  await page.getByRole('link', { name: 'Kelimeler' }).click();
  await page.getByRole('searchbox', { name: 'Kartlarda ara' }).fill('haus');
  await expect(page.getByRole('list', { name: 'Kartlar' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('link', { name: /das Haus/ }).click();

  await expect(page.getByTestId('card-schedule')).toContainText('yeni · sıradaki tekrar şimdi');
  await expect(page.getByText('Das Haus ist alt.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'das Haus' })).toBeVisible(); // dictionary card from the text
  await page.getByRole('button', { name: 'Kartı sil' }).click();
  await expect(page.getByRole('status')).toContainText('das Haus silindi');
  await expect(page.getByRole('list', { name: 'Kartlar' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Geri al' }).click();
  await expect(page.getByRole('list', { name: 'Kartlar' }).getByRole('listitem')).toHaveCount(2);

  await page.getByRole('link', { name: /das Haus/ }).click();
  await page.getByRole('link', { name: /Metne git/ }).click();
  await expect(page.getByRole('heading', { name: 'Ein erfundener Lesetext' })).toBeVisible();
  await expect(word(page, 1, 1)).toHaveClass(/learning/);
});

test('cards saved before milestone 6 become new FSRS cards with dictionary data and cloze forms', async ({ page }) => {
  // A milestone 5 database (Dexie version 2 = IndexedDB version 20) with one card and its cached text.
  await page.goto('./icon.svg');
  await page.evaluate(
    async ({ token, text, id, date }) => {
      await new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('lesezeit', 20);
        r.onupgradeneeded = () => {
          const db = r.result;
          db.createObjectStore('settings', { keyPath: 'id' });
          db.createObjectStore('prefs', { keyPath: 'id' });
          db.createObjectStore('wordStatus', { keyPath: 'key' }).createIndex('state', 'state');
          db.createObjectStore('cards', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
          const log = db.createObjectStore('readingLog', { keyPath: 'id', autoIncrement: true });
          log.createIndex('textId', 'textId');
          log.createIndex('startedAt', 'startedAt');
          db.createObjectStore('textCache', { keyPath: 'id' }).createIndex('date', 'date');
        };
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction(['settings', 'wordStatus', 'cards', 'textCache'], 'readwrite');
          const now = new Date().toISOString();
          tx.objectStore('settings').put({ id: 'main', githubToken: token, geminiKey: '', updatedAt: now });
          tx.objectStore('wordStatus').put({ key: 'w:haus', state: 'learning', updatedAt: now });
          tx.objectStore('cards').put({
            id: 'w:haus', kind: 'lemma', display: 'das Haus', pos: 'NOUN', meaning_tr: 'ev', createdAt: now, via: 'add',
            // milestone 5 saved the whole highlight group as tokens
            contexts: [{ textId: id, date, s: 1, sentence: 'Das Haus ist alt.', tokens: [0, 1] }],
          });
          tx.objectStore('textCache').put({ id, date, annotatedAt: text.annotatedAt, text, cachedAt: now });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        r.onerror = () => reject(r.error);
      });
    },
    { token: FAKE_TOKEN, text: readerText, id: TEXT_ID, date: TEXT_DATE },
  );

  await page.goto('./#/kelimeler');
  await expect(page.getByRole('link', { name: /das Haus/ })).toContainText('yeni');
  const { cards } = await readDb(page);
  expect(cards[0]).toMatchObject({ lemma: 'Haus', fsrs: { state: 0, reps: 0 }, entry: { g: 'n' } });
  expect(cards[0]!.contexts[0]!.forms).toEqual(['Haus']); // "Das" is not part of the card
  expect(typeof cards[0]!.due).toBe('number');

  // The migrated card works in a cloze drill.
  await page.getByRole('button', { name: 'Boşluk' }).click();
  await expect(page.getByTestId('cloze-sentence')).toHaveText(/^Das\s+ist alt\.$/);
  await answerCorrectly(page);
  await expect(page.getByTestId('session-summary')).toContainText('1 cevap · %100 doğru');
});
