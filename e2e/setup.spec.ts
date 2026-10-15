import { expect, test, type Page } from '@playwright/test';

// The GitHub API is mocked: these tests never touch the real repo or a real token.
const REPO = 'https://api.github.com/repos/enesskocc/lesezeit-data';
const FAKE_TOKEN = 'github_pat_TEST_ONLY_not_a_real_token';

async function mockGitHub(page: Page, repo: { status: number; body?: object }) {
  await page.route(REPO, (route) => route.fulfill({ status: repo.status, json: repo.body ?? { message: 'x' } }));
  await page.route(`${REPO}/contents/test/hello.json`, (route) =>
    route.fulfill({ json: { message: 'Hallo aus lesezeit-data!', createdAt: '2026-10-15' } }),
  );
}

async function submitToken(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Kurulum' })).toBeVisible();
  await page.locator('input[name="github-token"]').fill(FAKE_TOKEN);
  await page.getByRole('button', { name: 'Kaydet ve test et' }).click();
}

test('first launch → setup → home shows the test file', async ({ page }) => {
  await mockGitHub(page, { status: 200, body: { private: true, permissions: { push: true } } });
  await submitToken(page);
  await expect(page.getByTestId('test-message')).toHaveText('Hallo aus lesezeit-data!');

  // Keys survive a reload (IndexedDB), so setup is skipped.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
});

test('invalid token shows a Turkish error and stays on setup', async ({ page }) => {
  await mockGitHub(page, { status: 401 });
  await submitToken(page);
  await expect(page.getByRole('alert')).toHaveText('Token geçersiz ya da süresi dolmuş.');
  await expect(page.getByRole('heading', { name: 'Kurulum' })).toBeVisible();
});

test('read-only token is rejected', async ({ page }) => {
  await mockGitHub(page, { status: 200, body: { private: true, permissions: { push: false } } });
  await submitToken(page);
  await expect(page.getByRole('alert')).toContainText('sadece okuyabiliyor');
});
