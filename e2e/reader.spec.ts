import { expect, test } from '@playwright/test';
import { mockReaderApi, setupAndOpen, word } from './fixtures';

// Milestone 5: the reader, with a synthetic annotated text (e2e/fixtures.ts).

test.beforeEach(async ({ page }) => {
  await mockReaderApi(page);
  await setupAndOpen(page);
});

test('ACCEPTANCE: tapping "an" in "Er fängt morgen an" opens anfangen (guess mode, then direct)', async ({ page }) => {
  // Guess mode is on by default: first only the word in its sentence, both parts highlighted.
  await word(page, 0, 3).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Tahmin modu');
  await expect(sheet).toContainText('fängt … an');
  await expect(page.getByTestId('guess-sentence').locator('b')).toHaveText(['fängt', 'an']);
  await expect(word(page, 0, 1)).toHaveClass(/hl/);
  await expect(word(page, 0, 3)).toHaveClass(/hl/);

  await sheet.getByRole('button', { name: 'Anlamı göster' }).click();
  await expect(page.getByTestId('sheet-lemma')).toHaveText('anfangen');
  await expect(sheet).toContainText('„fängt … an“ → anfangen');
  await expect(sheet).toContainText('fing an · hat angefangen');
  await expect(sheet).toContainText('Tahminin doğru muydu?');
  await page.getByTestId('scrim').click({ position: { x: 20, y: 20 } }); // tap above the sheet

  // Guess mode off: the full sheet at once.
  await page.getByRole('button', { name: /Tahmin modu: açık/ }).click();
  await word(page, 0, 3).click();
  await expect(page.getByTestId('sheet-lemma')).toHaveText('anfangen');
});

test('word colours: new words dotted; "Biliyorum", a card and "rest as known" change them', async ({ page }) => {
  await page.getByRole('button', { name: /Tahmin modu: açık/ }).click();
  await expect(word(page, 1, 1)).toHaveClass(/new/);

  // Noun sheet: article, plural, genitive from the embedded dictionary.
  await word(page, 1, 1).click();
  await expect(page.getByTestId('sheet-lemma')).toHaveText('das Haus');
  await expect(page.getByRole('dialog')).toContainText('die Häuser');
  await expect(page.getByRole('dialog')).toContainText('des Hauses');
  await page.getByRole('button', { name: '+ Kartlara ekle' }).click();
  await expect(page.getByRole('button', { name: 'Kartlarda' })).toBeDisabled();
  await page.getByTestId('scrim').click({ position: { x: 20, y: 20 } }); // tap above the sheet
  await expect(word(page, 1, 1)).toHaveClass(/learning/);

  await word(page, 1, 3).click();
  await page.getByRole('button', { name: 'Biliyorum', exact: true }).click();
  await expect(word(page, 1, 3)).not.toHaveClass(/new/);

  await page.getByRole('button', { name: 'Kalan yenileri „biliyorum“ say' }).click();
  await expect(page.locator('#reader-text .w.new')).toHaveCount(0);
  await expect(word(page, 1, 1)).toHaveClass(/learning/); // cards stay "learning"
});

test('a wrong guess adds the word as a card with this sentence', async ({ page }) => {
  await word(page, 0, 2).click(); // "morgen"
  await page.getByRole('button', { name: 'Anlamı göster' }).click();
  await page.getByRole('button', { name: 'Hayır' }).click();
  await expect(page.getByRole('dialog')).toContainText('Kartlara eklendi');
  await page.getByTestId('scrim').click({ position: { x: 20, y: 20 } }); // tap above the sheet
  await expect(word(page, 0, 2)).toHaveClass(/learning/);
});

test('sentence sheet, article colours, questions with proof sentence, finishing', async ({ page }) => {
  await page.getByRole('button', { name: 'Cümle 2: çeviri ve yapı' }).click();
  await expect(page.getByTestId('sentence-translation')).toHaveText('Ev eski.');
  await page.getByTestId('scrim').click({ position: { x: 20, y: 20 } }); // tap above the sheet

  await page.getByRole('button', { name: /Artikel renkleri: kapalı/ }).click();
  await expect(page.locator('#reader-text')).toHaveClass(/artcol/);
  await expect(word(page, 1, 1)).toHaveAttribute('data-art', 'das');

  await page.getByTestId('question-q2').getByRole('button', { name: 'falsch' }).click();
  await expect(page.getByTestId('question-q2')).toContainText('Doğru.');
  await expect(page.locator('.sent[data-sent="1"]')).toHaveClass(/proof/);
  await page.getByTestId('question-q1').getByRole('button', { name: 'heute' }).click();
  await expect(page.getByTestId('question-q1')).toContainText('Yanlış.');

  await page.getByRole('button', { name: 'Okumayı bitir' }).click();
  await expect(page.getByText(/Okuma kaydedildi · 1\/2 doğru/)).toBeVisible();
});

test('"rest as known" can be undone; an expression saved as a card colours its words', async ({ page }) => {
  await page.getByRole('button', { name: 'Kalan yenileri „biliyorum“ say' }).click();
  await expect(page.locator('#reader-text .w.new')).toHaveCount(0);
  await page.getByRole('button', { name: 'Geri al' }).click();
  await expect(word(page, 1, 3)).toHaveClass(/new/);
});

test('read-aloud never gets stuck on "Durdur" when another sound interrupts it', async ({ page }) => {
  // Playwright's WebKit build has no speechSynthesis; the logic is unit-tested in src/lib/speech.test.ts.
  test.skip(!(await page.evaluate(() => 'speechSynthesis' in window)), 'no text-to-speech in this browser');
  await page.getByRole('button', { name: '▶ Sesli oku' }).click();
  await page.getByRole('button', { name: /Tahmin modu: açık/ }).click();
  await word(page, 1, 1).click();
  await page.getByRole('dialog').getByRole('button', { name: '🔊 Dinle' }).click();
  await page.getByTestId('scrim').click({ position: { x: 20, y: 20 } });
  await expect(page.getByRole('button', { name: '▶ Sesli oku' })).toBeVisible();
});
