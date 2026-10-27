import { expect, test, type Page } from '@playwright/test';
import { FAKE_TOKEN, mockReaderApi, readerText, setupAndOpen, TEXT_DATE, TEXT_ID, word } from './fixtures';

// Milestone 6: FSRS cards and the vocabulary trainer, with the synthetic reader text (e2e/fixtures.ts).

/** What the six cards saved from the fixture text expect as answers. */
const CARDS: Record<string, { de: string; tr: string; at: [number, number] }> = {
  'w:anfangen': { de: 'anfangen', tr: 'başlıyor', at: [0, 1] },
  'w:morgen': { de: 'morgen', tr: 'yarın', at: [0, 2] },
  'w:er': { de: 'er', tr: 'o', at: [0, 0] },
  'w:haus': { de: 'das Haus', tr: 'ev', at: [1, 1] },
  'w:sein': { de: 'sein', tr: '-dir', at: [1, 2] },
  'w:alt': { de: 'alt', tr: 'eski', at: [1, 3] },
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
 * Matches every pair of the round on screen correctly. `pause` runs right before "Devam": time spent
 * reading the result, so the round itself stays fast.
 */
async function matchAll(page: Page, pause: () => Promise<void> = async () => {}) {
  await expect(page.getByTestId('ex-match')).toBeVisible();
  for (const left of await page.locator('[data-side="l"]').allInnerTexts()) {
    await page.locator('[data-side="l"]').filter({ hasText: new RegExp(`^${escapeRe(left)}$`) }).click();
    const tr = byDe.get(left)!.tr;
    await page.locator('[data-side="r"]').filter({ hasText: new RegExp(`^${escapeRe(tr)}$`) }).click();
  }
  await expect(page.getByTestId('feedback')).toContainText(/Doğru|hatasız/);
  await pause();
  await page.getByRole('button', { name: 'Devam' }).click();
}

test.beforeEach(async ({ page }) => {
  await mockReaderApi(page);
  // Cards get their dictionary data only from the text's embedded entries: an online lookup that
  // finishes before or after "+ Kartlara ekle" would change the matching modes from run to run.
  await page.route('**/lesezeit/dict/**', (route) => route.abort());
});

test('ACCEPTANCE: a session of matching rounds runs and the due dates update correctly', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date('2026-10-22T08:00:00') });
  await setupAndOpen(page);
  await addCards(page, Object.keys(CARDS));

  await page.getByRole('link', { name: 'Kelimeler' }).click();
  await expect(page.getByTestId('vocab-stats')).toContainText('6Yeni');
  await page.getByRole('button', { name: '10 dk' }).click();
  await page.getByRole('button', { name: 'Oturumu başlat · 6 kart' }).click();

  let rounds = 0;
  for (let n = 0; n < 20; n++) {
    const next = page.locator('[data-step], [data-testid="session-summary"]').first();
    await expect(next).toBeVisible();
    if (await page.getByTestId('session-summary').isVisible()) break;
    const step = await next.getAttribute('data-step');
    // Enes 2026-10-22: matching only — no flashcard, cloze, artikel or production.
    await expect(page.locator('[data-testid^="ex-"]')).toHaveAttribute('data-testid', 'ex-match');
    await matchAll(page, () => page.clock.fastForward(45_000));
    rounds++;
    await expect(page.locator(`[data-step="${step}"]`)).toHaveCount(0); // the next round (or the summary) replaced it
  }
  // All six cards were in every round; after three rounds (5 min → 10 min → days) nothing is left
  // for today, so the session ends before its 10 minutes with the summary.
  expect(rounds).toBe(3);
  await expect(page.getByTestId('session-summary')).toContainText(/Oturum bitti/);
  await expect(page.getByTestId('session-summary')).toContainText('18 cevap · %100 doğru · 6 yeni kart');

  const { cards, logs } = await readDb(page);
  expect(cards).toHaveLength(6);
  expect(new Set(logs.map((l) => l.rating)), 'correct matches are Good').toEqual(new Set([3]));
  for (const c of cards) {
    const own = logs.filter((l) => l.cardId === c.id && !l.practice);
    expect(own.map((l) => l.exercise), c.id).toEqual(['match', 'match', 'match']);
    expect(own.at(-1)!.dueAfter, `${c.id}: card due = result of the last review`).toBe(c.due);
    for (const l of own) expect(l.dueAfter!).toBeGreaterThan(Date.parse(l.at));
    expect(c.fsrs.state, `${c.id} graduated`).toBe(2);
    expect(c.due - Date.parse(own.at(-1)!.at), `${c.id} → days`).toBeGreaterThan(20 * 3600_000);
  }

  // The tab shows the new schedule: no new cards left, nothing due now.
  await page.getByRole('link', { name: 'Kelimelere dön' }).click();
  await expect(page.getByTestId('vocab-stats')).toContainText('0Yeni');
  await expect(page.getByRole('button', { name: 'Şimdilik tekrar yok' })).toBeDisabled();
});

test('a matching drill on new cards is practice; a wrong pair comes back once at the end', async ({ page }) => {
  await setupAndOpen(page);
  await addCards(page, Object.keys(CARDS));
  await page.getByRole('link', { name: 'Kelimeler' }).click();
  await page.getByRole('button', { name: 'Serbest eşleştirme' }).click();
  // One wrong pair on purpose: "das Haus" ↔ "yarın".
  const haus = page.locator('[data-side="l"]').filter({ hasText: /^das Haus$/ });
  await haus.click();
  await page.locator('[data-side="r"]').filter({ hasText: /^yarın$/ }).click();
  await expect(haus).toHaveClass(/border-bad/);
  await expect(haus).not.toHaveClass(/border-bad/);
  for (const left of await page.locator('[data-side="l"]').allInnerTexts()) {
    await page.locator('[data-side="l"]').filter({ hasText: new RegExp(`^${escapeRe(left)}$`) }).click();
    await page.locator('[data-side="r"]').filter({ hasText: new RegExp(`^${escapeRe(byDe.get(left)!.tr)}$`) }).click();
  }
  await expect(page.getByTestId('feedback')).toContainText('Neredeyse');
  await expect(page.getByTestId('feedback')).toContainText('1 hata');
  await page.getByRole('button', { name: 'Devam' }).click();
  // The wrong card comes back in one more matching round.
  await expect(page.getByText('Eşleştirme · tekrar · serbest')).toBeVisible();
  await matchAll(page);
  await expect(page.getByTestId('session-summary')).toContainText('7 cevap · %86 doğru');

  const { cards, logs } = await readDb(page);
  expect(cards.every((c) => c.fsrs.state === 0), 'new cards keep their schedule').toBe(true);
  expect(logs.every((l) => l.practice)).toBe(true);
  expect(logs.filter((l) => l.cardId === 'w:haus').map((l) => l.rating)).toEqual([1, 3]);
});

test('matching: tapping a tile is silent; the 🔊 button reads the German word', async ({ page }) => {
  // A stub records what would be spoken. Playwright's WebKit has no speechSynthesis on Windows but a
  // real one on Linux (CI), whose read-only getter ignores plain assignment — so define own properties.
  await page.addInitScript(() => {
    const spoken: string[] = [];
    const define = (name: string, value: unknown) => Object.defineProperty(window, name, { value, configurable: true, writable: true });
    define('__spoken', spoken);
    define(
      'SpeechSynthesisUtterance',
      class {
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      },
    );
    define('speechSynthesis', { getVoices: () => [], cancel: () => {}, speak: (u: { text: string }) => spoken.push(u.text) });
  });
  await setupAndOpen(page);
  await addCards(page, Object.keys(CARDS));
  await page.getByRole('link', { name: 'Kelimeler' }).click();
  await page.getByRole('button', { name: 'Serbest eşleştirme' }).click();
  const spoken = () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

  await page.locator('[data-side="l"]').filter({ hasText: /^das Haus$/ }).click();
  await page.locator('[data-side="r"]').filter({ hasText: /^ev$/ }).click();
  expect(await spoken()).toEqual([]);
  await expect(page.getByTestId('match-speak')).toHaveCount(6); // German tiles only, not the Turkish ones
  await page.getByRole('button', { name: 'anfangen: dinle' }).click();
  expect(await spoken()).toEqual(['anfangen']);
  await expect(page.locator('[data-side="l"]').filter({ hasText: /^anfangen$/ })).toHaveAttribute('aria-pressed', 'false');
  // A matched tile keeps its 🔊 (sound is only ever played on request, there is no sound toggle).
  await page.getByRole('button', { name: 'das Haus: dinle' }).click();
  expect(await spoken()).toEqual(['anfangen', 'das Haus']);
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

test('cards saved before milestone 6 become new FSRS cards with dictionary data and saved word positions', async ({ page }) => {
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
          tx.objectStore('settings').put({ id: 'main', githubToken: token, geminiKey: 'AIza_TEST_ONLY', updatedAt: now });
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

  // Milestone 8 was cancelled: the database upgrade drops a Gemini key saved earlier, keeps the token.
  const settings = await page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const r = indexedDB.open('lesezeit');
        r.onsuccess = () => {
          const q = r.result.transaction('settings').objectStore('settings').get('main');
          q.onsuccess = () => {
            r.result.close();
            resolve(q.result as Record<string, unknown>);
          };
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
  expect(settings).not.toHaveProperty('geminiKey');
  expect(settings.githubToken).toBe(FAKE_TOKEN);
});
