// Shared synthetic data + GitHub API mock for the reader tests. Never real news text.
import { expect, type Page } from '@playwright/test';

export const API = 'https://api.github.com';
const REPO = `${API}/repos/enesskocc/lesezeit-data`;
export const FAKE_TOKEN = 'github_pat_TEST_ONLY_not_a_real_token';
export const TEXT_ID = 'c0ffee0001';
export const TEXT_DATE = '2026-10-21';

const w = (i: number, s: string, extra: object, ws = i > 0) => ({ i, s, ws, k: 'w', ...extra });
const p = (i: number, s: string) => ({ i, s, ws: false, k: 'p' });

export const readerText = {
  version: 2, id: TEXT_ID, kind: 'news', date: TEXT_DATE, source: 'test', sourceName: 'Testquelle',
  url: 'https://example.de/reader', title: 'Ein erfundener Lesetext', fetchedAt: `${TEXT_DATE}T03:30:00Z`, wordCount: 9,
  paragraphs: ['Er fängt morgen an. Das Haus ist alt.'],
  sentences: [
    {
      p: 0, t: 'Er fängt morgen an.', tr: 'Yarın başlıyor.', notes: ['„fängt … an“: ayrılabilen fiil anfangen.'],
      tok: [
        w(0, 'Er', { l: 'er', pos: 'PRON', c: 'Nom', tr: 'o' }),
        w(1, 'fängt', { l: 'anfangen', pos: 'VERB', sep: 3, tr: 'başlıyor', dict: true }),
        w(2, 'morgen', { l: 'morgen', pos: 'ADV', tr: 'yarın' }),
        w(3, 'an', { l: 'anfangen', pos: 'ADP', sep: 1, tr: '(anfangen ön eki)', dict: true }),
        p(4, '.'),
      ],
    },
    {
      p: 0, t: 'Das Haus ist alt.', tr: 'Ev eski.',
      tok: [
        w(0, 'Das', { l: 'der', pos: 'DET', c: 'Nom', tr: 'belirli artikel' }),
        w(1, 'Haus', { l: 'Haus', pos: 'NOUN', c: 'Nom', g: 'n', pl: 'Häuser', tr: 'ev', dict: true }),
        w(2, 'ist', { l: 'sein', pos: 'AUX', tr: '-dir' }),
        w(3, 'alt', { l: 'alt', pos: 'ADJ', tr: 'eski' }),
        p(4, '.'),
      ],
    },
  ],
  heuristics: { sentences: 2, words: 8, avgSentenceLength: 4, rareShare: 0, unknownShare: 0, subordinatePerSentence: 0, passivePer100: 0, konjunktivPer100: 0, score: 0.2 },
  levelHeuristic: 'B1', level: 'B1', annotated: true, annotatedAt: `${TEXT_DATE}T03:40:00Z`, topic: 'gesellschaft',
  levelAi: { level: 'B1', confidence: 0.9, reasons_tr: 'Çok kısa cümleler.', topic: 'gesellschaft' },
  mwes: [],
  questions: [
    { id: 'q1', type: 'mc', q: 'Wann fängt er an?', options: ['heute', 'morgen', 'gestern', 'nie'], answer: 1, proof: 0, explain_tr: 'Metin „morgen“ diyor.' },
    { id: 'q2', type: 'tf', q: 'Das Haus ist neu.', options: ['richtig', 'falsch', 'nicht im Text'], answer: 1, proof: 1, explain_tr: 'Ev eski.' },
  ],
  dict: {
    anfangen: [{ w: 'anfangen', p: 'v', prt: 'fing an', pp: 'angefangen', aux: 'haben', sep: 'an', tr: ['başlamak'] }],
    haus: [{ w: 'Haus', p: 'n', g: 'n', pl: 'Häuser', gen: 'Hauses', tr: ['ev'] }],
  },
};

export const readerIndex = {
  version: 1, updatedAt: `${TEXT_DATE}T03:41:00Z`,
  texts: [{
    id: TEXT_ID, kind: 'news', date: TEXT_DATE, source: 'test', sourceName: 'Testquelle', url: readerText.url, title: readerText.title,
    wordCount: 9, levelHeuristic: 'B1', level: 'B1', annotated: true, annotatedAt: readerText.annotatedAt, topic: 'gesellschaft',
    path: `texts/${TEXT_DATE}/${TEXT_ID}.json`,
  }],
};

export async function mockReaderApi(page: Page) {
  await page.route(`${API}/**`, (route) => route.abort());
  await page.route(REPO, (route) => route.fulfill({ json: { private: true } }));
  await page.route(`${REPO}/contents/test/hello.json`, (route) => route.fulfill({ status: 409, json: { message: 'sha mismatch' } }));
  await page.route(`${REPO}/contents/texts/index.json`, (route) => route.fulfill({ json: readerIndex }));
  await page.route(`${REPO}/contents/texts/${TEXT_DATE}/${TEXT_ID}.json`, (route) => route.fulfill({ json: readerText }));
}

export async function setupAndOpen(page: Page) {
  await page.goto('./');
  await page.locator('input[name="github-token"]').fill(FAKE_TOKEN);
  await page.getByRole('button', { name: 'Kaydet ve test et' }).click();
  await page.getByRole('link', { name: /Ein erfundener Lesetext/ }).click();
  await expect(page.getByRole('heading', { name: 'Ein erfundener Lesetext' })).toBeVisible();
}

/** A word in the reader text by sentence and token index. */
export const word = (page: Page, s: number, i: number) => page.locator(`#reader-text .w[data-s="${s}"][data-i="${i}"]`);
