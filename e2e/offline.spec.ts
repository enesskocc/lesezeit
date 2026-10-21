import { expect, test } from '@playwright/test';
import { mockReaderApi, setupAndOpen, word } from './fixtures';

// Milestone 5 acceptance: a downloaded text opens in airplane mode. The service worker is
// ALLOWED here (other specs block it), so the app shell really comes from the precache.
test.use({ serviceWorkers: 'allow' });

test('ACCEPTANCE: a downloaded text opens in airplane mode, word sheet included', async ({ page, context }) => {
  await mockReaderApi(page);
  await setupAndOpen(page); // opening the text also stores it in IndexedDB (textCache)

  // Wait until the service worker is active (precache complete). With registerType "prompt" it
  // does not claim the open page; after a reload the page is controlled.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ein erfundener Lesetext' })).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // Airplane mode.
  await context.setOffline(true);
  await page.goto('./#/');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
  await page.getByRole('link', { name: /Ein erfundener Lesetext/ }).click();
  await expect(page.getByRole('heading', { name: 'Ein erfundener Lesetext' })).toBeVisible();

  await page.getByRole('button', { name: /Tahmin modu: açık/ }).click();
  await word(page, 0, 3).click();
  await expect(page.getByTestId('sheet-lemma')).toHaveText('anfangen');
  await expect(page.getByRole('dialog')).toContainText('fing an · hat angefangen');
  await context.setOffline(false);
});
