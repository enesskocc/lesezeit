import { expect, test, type Page } from '@playwright/test';

// The GitHub API is mocked: these tests never touch the real repo or a real token.
// Texts are synthetic — no real news text in this public repo.
const API = 'https://api.github.com';
const REPO = `${API}/repos/enesskocc/lesezeit-data`;
const PROBE = `${REPO}/contents/test/hello.json`;
const INDEX = `${REPO}/contents/texts/index.json`;
const TEXT = `${REPO}/contents/texts/2026-10-21/a1b2c3d4e5.json`;
const FAKE_TOKEN = 'github_pat_TEST_ONLY_not_a_real_token';

const heuristics = {
  sentences: 2, words: 20, avgSentenceLength: 10, rareShare: 0.2, unknownShare: 0.1,
  subordinatePerSentence: 0.5, passivePer100: 0, konjunktivPer100: 0, score: 0.33,
};
const textFile = {
  version: 1, id: 'a1b2c3d4e5', kind: 'news', date: '2026-10-21', source: 'test', sourceName: 'Testquelle',
  url: 'https://example.de/testtext', title: 'Ein erfundener Testtext', fetchedAt: '2026-10-21T03:30:00Z', wordCount: 20,
  paragraphs: ['Die Stadt plant mehr Busse am Abend.', 'Viele Pendler hatten sich beschwert.'],
  sentences: [
    { p: 0, t: 'Die Stadt plant mehr Busse am Abend.', tr: 'Şehir akşamları daha fazla otobüs planlıyor.', notes: ['Basit ana cümle.'] },
    { p: 1, t: 'Viele Pendler hatten sich beschwert.', tr: 'Birçok yolcu şikâyet etmişti.' },
  ],
  heuristics, levelHeuristic: 'B2', annotated: true, level: 'B2',
  levelAi: { level: 'B2', confidence: 0.8, reasons_tr: 'Kısa cümleler, günlük konu.' },
};
const indexFile = {
  version: 1, updatedAt: '2026-10-21T03:35:00Z',
  texts: [{
    id: textFile.id, kind: 'news', date: textFile.date, source: 'test', sourceName: 'Testquelle', url: textFile.url,
    title: textFile.title, wordCount: 20, levelHeuristic: 'B2', level: 'B2', annotated: true, path: 'texts/2026-10-21/a1b2c3d4e5.json',
  }, {
    // A pool candidate the pipeline has not annotated: never listed.
    id: 'b2b2b2b2b2', kind: 'news', date: '2026-10-21', source: 'test', sourceName: 'Testquelle', url: 'https://example.de/pool',
    title: 'Pool-Kandidat ohne Anmerkungen', wordCount: 300, levelHeuristic: 'C1', annotated: false, path: 'texts/2026-10-21/b2b2b2b2b2.json',
  }],
};

interface Mock {
  repo?: { status: number; body?: object };
  /** Status of the wrong-sha write probe: 409 = can write, 403 = read-only. */
  probe?: number;
  index?: { status: number; body?: object };
}

async function mockGitHub(page: Page, m: Mock = {}) {
  const seenAuth: string[] = [];
  // Anything not mocked below fails instead of reaching the real API.
  await page.route(`${API}/**`, (route) => route.abort());
  await page.route(REPO, (route) => {
    seenAuth.push(route.request().headers()['authorization'] ?? '');
    return route.fulfill({ status: m.repo?.status ?? 200, json: m.repo?.body ?? { private: true } });
  });
  await page.route(PROBE, (route) => route.fulfill({ status: m.probe ?? 409, json: { message: 'sha mismatch' } }));
  await page.route(INDEX, (route) => route.fulfill({ status: m.index?.status ?? 200, json: m.index?.body ?? indexFile }));
  await page.route(TEXT, (route) => route.fulfill({ json: textFile }));
  return seenAuth;
}

async function submitToken(page: Page) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Kurulum' })).toBeVisible();
  await page.locator('input[name="github-token"]').fill(FAKE_TOKEN);
  await page.getByRole('button', { name: 'Kaydet ve test et' }).click();
}

test('first launch → setup → text list → plain preview', async ({ page }) => {
  const seenAuth = await mockGitHub(page);
  await submitToken(page);
  await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
  expect(seenAuth[0]).toBe(`Bearer ${FAKE_TOKEN}`);

  await page.getByRole('link', { name: /Ein erfundener Testtext/ }).click();
  await expect(page.getByRole('heading', { name: 'Ein erfundener Testtext' })).toBeVisible();
  await expect(page.getByText('Viele Pendler hatten sich beschwert.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Original öffnen' })).toHaveAttribute('href', 'https://example.de/testtext');

  // Keys survive a reload (IndexedDB), so setup is skipped.
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
});

test('only annotated texts are listed; tapping a sentence shows its Turkish translation', async ({ page }) => {
  await mockGitHub(page);
  await submitToken(page);
  await expect(page.getByRole('link', { name: /Ein erfundener Testtext/ })).toBeVisible();
  await expect(page.getByText('Pool-Kandidat ohne Anmerkungen')).toHaveCount(0);

  await page.getByRole('link', { name: /Ein erfundener Testtext/ }).click();
  await page.getByTestId('level-reasons').locator('summary').click();
  await expect(page.getByTestId('level-reasons')).toContainText('Kısa cümleler');
  await expect(page.getByText('Şehir akşamları daha fazla otobüs planlıyor.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cümle 1: çeviri ve yapı' }).click();
  await expect(page.getByTestId('sentence-translation')).toHaveText('Şehir akşamları daha fazla otobüs planlıyor.');
  await expect(page.getByText('Basit ana cümle.')).toBeVisible();
});

test('before the first annotated text the list explains when it comes', async ({ page }) => {
  await mockGitHub(page, { index: { status: 200, body: { ...indexFile, texts: [indexFile.texts[1]] } } });
  await submitToken(page);
  await expect(page.getByText(/Henüz hazır metin yok/)).toBeVisible();
});

test('level filter hides texts of other levels', async ({ page }) => {
  await mockGitHub(page);
  await submitToken(page);
  await expect(page.getByRole('link', { name: /Ein erfundener Testtext/ })).toBeVisible();
  await page.getByRole('button', { name: 'C1' }).click();
  await expect(page.getByText('Bu filtrede metin yok.')).toBeVisible();
});

test('a data repo without texts yet shows a friendly empty state', async ({ page }) => {
  await mockGitHub(page, { index: { status: 404 } });
  await submitToken(page);
  await expect(page.getByText(/Henüz hazır metin yok/)).toBeVisible();
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

test('malformed index shows an error with a retry button', async ({ page }) => {
  await mockGitHub(page, { index: { status: 200, body: { wrong: true } } });
  await submitToken(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tekrar dene' })).toBeVisible();
});

test('deleting keys returns to setup', async ({ page }) => {
  await mockGitHub(page);
  await submitToken(page);
  await expect(page.getByRole('heading', { name: 'Bugün' })).toBeVisible();
  await page.getByRole('link', { name: 'Ayarlar' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Anahtarları bu cihazdan sil' }).click();
  await page.getByRole('link', { name: 'Bugün' }).waitFor({ state: 'detached' });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Kurulum' })).toBeVisible();
});
