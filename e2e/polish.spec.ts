import { expect, test } from '@playwright/test';
import { mockReaderApi, setupAndOpen, TEXT_ID } from './fixtures';

// Milestone 10: stats screen and display settings. History rows are synthetic, built in the
// browser's local time like the app's learning days (04:00 start).

test.beforeEach(async ({ page }) => {
  await mockReaderApi(page);
  await page.route('**/lesezeit/dict/**', (route) => route.abort());
});

test('stats: streak, retention, today, cards by state, reviews per day and words per week', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 27, 20) }); // Tuesday 27 October, 20:00
  await setupAndOpen(page);
  await page.getByRole('link', { name: 'Kelimeler' }).click();
  await page.getByRole('link', { name: 'İstatistikler →' }).click();
  await expect(page.getByTestId('stat-streak')).toContainText('0 gün');
  await expect(page.getByTestId('stat-retention')).toContainText('henüz tekrar yok');

  await page.evaluate(async (textId) => {
    const at = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('lesezeit');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction(['reviewLog', 'readingLog', 'cards'], 'readwrite');
    const review = (d: number, h: number, rating: number, stateBefore: number, practice?: boolean) =>
      tx.objectStore('reviewLog').add({ cardId: 'w:x', at: at(d, h), rating, exercise: 'match', ms: 2000, stateBefore, practice });
    review(27, 9, 3, 2);
    review(27, 9, 3, 2);
    review(27, 9, 1, 2); // today: 3 reviews of graduated cards, 2 remembered
    review(26, 21, 3, 1);
    review(27, 2, 3, 1); // 02:00 on the 27th still counts for the 26th
    review(25, 12, 3, 2, true); // free practice: keeps the streak, is not a review
    const reading = (d: number, words?: number) =>
      tx.objectStore('readingLog').add({ textId, date: '2026-10-21', startedAt: at(d, 8), finishedAt: at(d, 9), seconds: 600, newCards: 0, correct: 0, answered: 0, words });
    reading(27, 400);
    reading(20); // finished before milestone 10: no word count → taken from the downloaded text (9 words)
    const card = (id: string, state: number, scheduled_days: number) =>
      tx.objectStore('cards').put({ id, kind: 'lemma', lemma: id, display: id, meaning_tr: 'x', createdAt: at(20, 9), via: 'add', contexts: [], due: 0, fsrs: { state, scheduled_days, due: at(28, 9) } });
    card('w:a', 0, 0);
    card('w:b', 0, 0);
    card('w:c', 1, 0);
    card('w:d', 2, 30);
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  }, TEXT_ID);
  await page.reload();

  await expect(page.getByTestId('stat-streak')).toContainText('3 gün'); // 25 (practice), 26, 27; the 24th is empty
  await expect(page.getByTestId('stat-retention')).toContainText('%67');
  await expect(page.getByTestId('stat-retention')).toContainText('3 tekrar');
  await expect(page.getByTestId('stat-today')).toContainText('3');
  await expect(page.getByTestId('stat-phases')).toHaveText(/2yeni.*1öğreniliyor.*0genç.*1olgun/);

  const reviews = page.getByTestId('chart-reviews');
  await expect(page.getByTestId('chart-reviews-value')).toHaveText('toplam 5 · en çok 3');
  await expect(reviews.getByRole('button')).toHaveCount(30);
  await reviews.getByRole('button', { name: '26 Eki: 2 tekrar' }).click();
  await expect(page.getByTestId('chart-reviews-value')).toHaveText('26 Eki: 2 tekrar');
  await expect(reviews.getByRole('button', { name: '25 Eki: 0 tekrar' })).toBeVisible();

  const words = page.getByTestId('chart-words');
  await expect(words.getByRole('button')).toHaveCount(8);
  await expect(words.getByRole('button', { name: '26 Eki haftası: 400 kelime' })).toBeVisible();
  await expect(words.getByRole('button', { name: '19 Eki haftası: 9 kelime' })).toBeVisible();
});

test('display settings: size, line height and font apply to the reading text and stay after a reload', async ({ page }) => {
  await setupAndOpen(page);
  const text = page.locator('#reader-text');
  const style = () => text.evaluate((el) => ({ size: getComputedStyle(el).fontSize, family: getComputedStyle(el).fontFamily, lh: getComputedStyle(el).lineHeight }));
  expect(await style()).toMatchObject({ size: '19px', family: expect.stringContaining('Literata') });

  await page.getByRole('link', { name: 'Ayarlar' }).click();
  await expect(page.locator('input[name="gemini-key"]'), 'milestone 8 cancelled: no Gemini key').toHaveCount(0);
  const look = page.getByRole('region', { name: 'Görünüm' });
  await look.getByRole('button', { name: 'Büyük', exact: true }).click();
  await look.getByRole('button', { name: 'Geniş' }).click();
  await look.getByRole('button', { name: 'Sans' }).click();
  await expect(look.getByRole('button', { name: 'Sans' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('look-sample')).toHaveCSS('font-size', '22px');

  await page.getByRole('link', { name: 'Okuma' }).click();
  // "Okuma" redirects to the last text once prefs are read; on a busy machine (clicks taking > 1 s,
  // seen 2026-10-27) that took longer than the default 5 s.
  await expect(page).toHaveURL(/#\/oku\//, { timeout: 15_000 });
  await expect(text).toBeVisible({ timeout: 15_000 });
  const wide = await style();
  expect(wide).toMatchObject({ size: '22px', family: expect.stringContaining('Figtree') });
  expect(parseFloat(wide.lh)).toBeCloseTo(22 * 2.05, 0); // "Geniş"
  await page.reload();
  await expect(text).toBeVisible();
  expect(await style()).toMatchObject({ size: '22px', family: expect.stringContaining('Figtree') });
});
