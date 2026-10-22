import { expect, test, type Page } from '@playwright/test';

// Milestone 2 acceptance, against the real dictionary shards in public/dict (built by npm run dict:build).

async function search(page: Page, word: string) {
  await page.goto('./#/sozluk');
  await page.getByRole('searchbox', { name: 'Almanca kelime ara' }).fill(word);
  const first = page.locator('article').first();
  await expect(first).toBeVisible();
  return first;
}

test('"fing" → fangen with Präteritum and Partizip II', async ({ page }) => {
  const card = await search(page, 'fing');
  await expect(card.getByRole('heading')).toHaveText('fangen');
  await expect(card).toContainText('metinde: „fing“');
  await expect(card.locator('dd', { hasText: /^fing$/ })).toBeVisible();
  await expect(card.locator('dd', { hasText: /^gefangen$/ })).toBeVisible();
  await expect(card.locator('dd', { hasText: /^haben$/ })).toBeVisible();
});

test('"Häusern" → das Haus with plural and genitive', async ({ page }) => {
  const card = await search(page, 'Häusern');
  await expect(card.getByRole('heading')).toHaveText('das Haus');
  await expect(card).toContainText('die Häuser');
  await expect(card).toContainText('des Hauses');
  await expect(card).toContainText('ev');
});

test('"angefangen" → anfangen as a separable verb', async ({ page }) => {
  const card = await search(page, 'angefangen');
  await expect(card.getByRole('heading')).toHaveText('anfangen');
  await expect(card).toContainText('fing an');
  await expect(card).toContainText('an- (fing … an)');
  await expect(card).toContainText('başlamak');
});

test('unknown word shows a Turkish "not found" message', async ({ page }) => {
  await page.goto('./#/sozluk');
  await page.getByRole('searchbox', { name: 'Almanca kelime ara' }).fill('xqzvw');
  await expect(page.getByText('„xqzvw“ sözlükte bulunamadı.')).toBeVisible();
});

test('noun homographs get separate cards with their own article and meaning', async ({ page }) => {
  await search(page, 'Steuer');
  const cards = page.locator('article');
  // Two noun cards, plus the verb "steuern" ("Steuer!" is its imperative).
  await expect(cards.filter({ has: page.getByRole('heading', { name: /^(der|die|das) Steuer$/ }) })).toHaveCount(2);
  await expect(cards.filter({ has: page.getByRole('heading', { name: 'steuern' }) })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'vergi' }).getByRole('heading')).toHaveText('die Steuer');
  await expect(cards.filter({ hasText: 'direksiyon' }).getByRole('heading')).toHaveText('das Steuer');
});

test('words in the Windows-reserved "aux" shard load (aux~.json)', async ({ page }) => {
  const card = await search(page, 'Auxiliarverb');
  await expect(card.getByRole('heading')).toContainText('Auxiliarverb');
});

test('Turkish keyboard input: dotless ı and invisible characters still find the word', async ({ page }) => {
  for (const q of ['mitbrıngen', 'mitbringen​', 'Mitbringen ']) {
    const card = await search(page, q);
    await expect(card.getByRole('heading')).toHaveText('mitbringen');
  }
});

// 2026-10-23, Enes: "vorbeikommen" not found on the iPhone although the dictionary has it.
test('vorbeikommen is found, also with invisible direction marks', async ({ page }) => {
  for (const q of ['vorbeikommen', '‎vorbeikommen‏']) {
    const card = await search(page, q);
    await expect(card.getByRole('heading')).toHaveText('vorbeikommen');
    await expect(card).toContainText('kam vorbei');
  }
});

test('nothing found: suggestions (split word, typo) and odd characters are shown', async ({ page }) => {
  await page.goto('./#/sozluk');
  const box = page.getByRole('searchbox', { name: 'Almanca kelime ara' });
  const notFound = page.getByTestId('not-found');
  const suggestions = page.getByRole('group', { name: 'Öneriler' });

  // A keyboard suggestion split the word: the joined word is offered first; tapping it searches it.
  await box.fill('vorbei kommen');
  await expect(notFound).toContainText('„vorbei kommen“ sözlükte bulunamadı');
  await expect(suggestions.getByRole('button').first()).toHaveText('vorbeikommen');
  await suggestions.getByRole('button', { name: 'vorbeikommen' }).click();
  await expect(box).toHaveValue('vorbeikommen');
  await expect(page.locator('article').first().getByRole('heading')).toHaveText('vorbeikommen');

  await box.fill('vorbeikomen'); // one letter missing
  await expect(suggestions.getByRole('button', { name: 'vorbeikommen' })).toBeVisible();

  await box.fill('vorbei·kommen'); // a character a keyboard could slip in
  await expect(notFound).toContainText('U+00B7');
  await expect(suggestions.getByRole('button', { name: 'vorbeikommen' })).toBeVisible();
});
