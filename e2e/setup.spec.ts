import { expect, test, type Page } from '@playwright/test';

// The GitHub API is mocked: these tests never touch the real repo or a real token.
const API = 'https://api.github.com';
const REPO = `${API}/repos/enesskocc/lesezeit-data`;
const FILE = `${REPO}/contents/test/hello.json`;
const FAKE_TOKEN = 'github_pat_TEST_ONLY_not_a_real_token';

interface Mock {
  repo?: { status: number; body?: object };
  /** Status of the wrong-sha write probe: 409 = can write, 403 = read-only. */
  probe?: number;
  file?: object;
}

async function mockGitHub(page: Page, m: Mock = {}) {
  const seenAuth: string[] = [];
  // Anything not mocked below fails instead of reaching the real API.
  await page.route(`${API}/**`, (route) => route.abort());
  await page.route(REPO, (route) => {
    seenAuth.push(route.request().headers()['authorization'] ?? '');
    return route.fulfill({ status: m.repo?.status ?? 200, json: m.repo?.body ?? { private: true } });
  });
  await page.route(FILE, (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: m.probe ?? 409, json: { message: 'sha mismatch' } })
      : route.fulfill({ json: m.file ?? { message: 'Hallo aus lesezeit-data!', createdAt: '2026-10-15' } }),
  );
  return seenAuth;
}

async function submitToken(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Kurulum' })).toBeVisible();
  await page.locator('input[name="github-token"]').fill(FAKE_TOKEN);
  await page.getByRole('button', { name: 'Kaydet ve test et' }).click();
}

test('first launch → setup → home shows the test file', async ({ page }) => {
  const seenAuth = await mockGitHub(page);
  await submitToken(page);
  await expect(page.getByTestId('test-message')).toHaveText('Hallo aus lesezeit-data!');
  expect(seenAuth[0]).toBe(`Bearer ${FAKE_TOKEN}`);

  // Keys survive a reload (IndexedDB), so setup is skipped.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
});

test('invalid token shows a Turkish error and stays on setup', async ({ page }) => {
  await mockGitHub(page, { repo: { status: 401 } });
  await submitToken(page);
  await expect(page.getByRole('alert')).toHaveText('Token geçersiz ya da süresi dolmuş.');
  await expect(page.getByRole('heading', { name: 'Kurulum' })).toBeVisible();
});

test('read-only token is rejected', async ({ page }) => {
  await mockGitHub(page, { probe: 403 });
  await submitToken(page);
  await expect(page.getByRole('alert')).toContainText('sadece okuyabiliyor');
});

test('public data repo is rejected', async ({ page }) => {
  await mockGitHub(page, { repo: { status: 200, body: { private: false } } });
  await submitToken(page);
  await expect(page.getByRole('alert')).toContainText('private olmalı');
});

test('malformed test file shows an error on home', async ({ page }) => {
  await mockGitHub(page, { file: { wrong: true } });
  await submitToken(page);
  await expect(page.getByRole('alert')).toContainText('beklenen biçimde değil');
});

test('deleting keys returns to setup', async ({ page }) => {
  await mockGitHub(page);
  await submitToken(page);
  await expect(page.getByTestId('test-message')).toBeVisible();
  await page.getByRole('link', { name: 'Ayarlar' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Anahtarları bu cihazdan sil' }).click();
  await page.getByRole('link', { name: 'Bugün' }).waitFor({ state: 'detached' });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Kurulum' })).toBeVisible();
});
