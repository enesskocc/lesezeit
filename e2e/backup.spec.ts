import { expect, test, type Page } from '@playwright/test';
import { API, FAKE_TOKEN, mockReaderApi, setupAndOpen, word } from './fixtures';

// Milestone 7: progress backup to lesezeit-data/backup/. GitHub is an in-memory fake.

interface Backup {
  version: number;
  wordStatus: { key: string; state: string }[];
  cards: { id: string }[];
  prefs?: Record<string, unknown>;
}

/** Fake contents API for backup/*: GET (sha or raw JSON), PUT (base64 body). Records every PUT. */
async function mockBackupFiles(page: Page) {
  const files = new Map<string, string>();
  const puts: { path: string; body: string }[] = [];
  await page.route(`${API}/repos/enesskocc/lesezeit-data/contents/backup/*`, async (route) => {
    const req = route.request();
    const path = decodeURIComponent(new URL(req.url()).pathname.split('/contents/')[1]!);
    if (req.method() === 'PUT') {
      const { content } = req.postDataJSON() as { content: string };
      const body = Buffer.from(content, 'base64').toString('utf8');
      files.set(path, body);
      puts.push({ path, body });
      return route.fulfill({ status: 201, json: { content: { path } } });
    }
    const body = files.get(path);
    if (body === undefined) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
    if ((req.headers()['accept'] ?? '').includes('raw')) return route.fulfill({ body, contentType: 'application/json' });
    return route.fulfill({ json: { sha: `sha-${body.length}` } });
  });
  const read = (path: string) => (files.has(path) ? (JSON.parse(files.get(path)!) as Backup) : undefined);
  return { files, puts, read, backups: () => puts.filter((p) => p.path === 'backup/progress.json').length };
}

/** "Biliyorum" on a reader word (guess mode must be off). */
async function markKnown(page: Page, s: number, i: number) {
  await word(page, s, i).click();
  await page.getByRole('button', { name: 'Biliyorum', exact: true }).click();
  await expect(word(page, s, i)).not.toHaveClass(/new/);
}

const backupSection = (page: Page) => page.getByRole('region', { name: 'Yedek' });

test.beforeEach(async ({ page }) => {
  await mockReaderApi(page);
  await page.route('**/lesezeit/dict/**', (route) => route.abort());
});

test('"Şimdi yedekle" writes progress.json without any key; the old backup becomes progress.prev.json', async ({ page }) => {
  const gh = await mockBackupFiles(page);
  await setupAndOpen(page);
  await page.getByRole('button', { name: /Tahmin modu: açık/ }).click();
  await markKnown(page, 0, 2); // morgen

  await page.getByRole('link', { name: 'Ayarlar' }).click();
  await expect(page.getByTestId('backup-status')).toContainText('Henüz yedeklenmedi.');
  page.once('dialog', (d) => void d.accept());
  await backupSection(page).getByRole('button', { name: 'Yedekten geri yükle' }).click();
  await expect(backupSection(page).getByRole('status')).toHaveText('Henüz bir yedek yok.');

  await backupSection(page).getByRole('button', { name: 'Şimdi yedekle' }).click();
  await expect(backupSection(page).getByRole('status')).toHaveText('Yedeklendi.');
  await expect(page.getByTestId('backup-status')).toContainText('Son yedek: az önce.');
  const first = gh.read('backup/progress.json')!;
  expect(first.version).toBe(1);
  expect(first.wordStatus).toContainEqual(expect.objectContaining({ key: 'w:morgen', state: 'known' }));
  expect(gh.files.has('backup/progress.prev.json'), 'first backup: nothing to keep').toBe(false);

  await backupSection(page).getByRole('button', { name: 'Şimdi yedekle' }).click();
  await expect(page.getByTestId('backup-status')).toContainText('Son yedek: az önce.');
  await expect.poll(gh.backups).toBe(2);
  expect(gh.read('backup/progress.prev.json')).toEqual(first);

  // The backup lives in a repo, so it must never carry the GitHub token or the Gemini key.
  for (const p of gh.puts) {
    expect(p.body).not.toContain(FAKE_TOKEN);
    expect(p.body).not.toMatch(/github_pat|githubToken|geminiKey|backupAt|backupError/);
  }
});

test('a change while reading is backed up by itself: 30 s after it, then at most every 10 minutes', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-26T08:00:00') });
  const gh = await mockBackupFiles(page);
  await setupAndOpen(page);
  await page.getByRole('button', { name: /Tahmin modu: açık/ }).click();

  await markKnown(page, 0, 2); // morgen
  await page.clock.fastForward(20_000);
  expect(gh.backups(), 'still within the 30 s quiet time').toBe(0);
  await page.clock.fastForward(11_000);
  await expect.poll(gh.backups).toBe(1);
  expect(gh.read('backup/progress.json')!.wordStatus).toContainEqual(expect.objectContaining({ key: 'w:morgen', state: 'known' }));

  await markKnown(page, 1, 3); // alt
  await page.clock.fastForward(60_000);
  expect(gh.backups(), 'the next backup waits for the 10-minute gap').toBe(1);
  await page.clock.fastForward(9 * 60_000);
  await expect.poll(gh.backups).toBe(2);
  expect(gh.read('backup/progress.json')!.wordStatus).toContainEqual(expect.objectContaining({ key: 'w:alt', state: 'known' }));

  await page.getByRole('link', { name: 'Ayarlar' }).click();
  await expect(page.getByTestId('backup-status')).toContainText('Son yedek: az önce.');
});

test('ACCEPTANCE: after deleting the app, "Yedekten geri yükle" brings cards and word colours back', async ({ page }) => {
  const gh = await mockBackupFiles(page);
  await setupAndOpen(page);
  await page.getByRole('button', { name: /Tahmin modu: açık/ }).click();
  await markKnown(page, 0, 2); // morgen
  await word(page, 1, 1).click(); // Haus
  await page.getByRole('button', { name: '+ Kartlara ekle' }).click();
  await expect(page.getByRole('button', { name: 'Kartlarda' })).toBeDisabled();
  await page.getByTestId('scrim').click({ position: { x: 20, y: 20 } });
  await page.getByRole('link', { name: 'Ayarlar' }).click();
  await backupSection(page).getByRole('button', { name: 'Şimdi yedekle' }).click();
  await expect(backupSection(page).getByRole('status')).toHaveText('Yedeklendi.');
  const saved = gh.read('backup/progress.json')!;
  expect(saved.cards.map((c) => c.id)).toEqual(['w:haus']);

  // "Delete the app": the whole local database goes, the key has to be entered again.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.deleteDatabase('lesezeit');
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      }),
  );
  await page.goto('./');
  await page.locator('input[name="github-token"]').fill(FAKE_TOKEN);
  await page.getByRole('button', { name: 'Kaydet ve test et' }).click();
  await page.getByRole('link', { name: 'Ayarlar' }).click();
  await expect(page.getByTestId('backup-status')).toContainText('Henüz yedeklenmedi.');

  page.once('dialog', (d) => void d.accept());
  await backupSection(page).getByRole('button', { name: 'Yedekten geri yükle' }).click();
  await expect(backupSection(page).getByRole('status')).toHaveText(`Geri yüklendi: 1 kart, ${saved.wordStatus.length} kelime durumu.`);
  await expect(page.getByTestId('backup-status')).toContainText('Son yedek:');

  await page.getByRole('link', { name: 'Kelimeler' }).click();
  await expect(page.getByTestId('vocab-stats')).toContainText('1Yeni');
  await page.getByRole('link', { name: 'Bugün' }).click();
  await page.getByRole('link', { name: /Ein erfundener Lesetext/ }).click();
  await expect(page.getByRole('button', { name: 'Tahmin modu: kapalı' }), 'settings come back too').toBeVisible();
  await expect(word(page, 0, 2)).not.toHaveClass(/new/); // morgen: known again
  await expect(word(page, 1, 1)).toHaveClass(/learning/); // Haus: a card again
  await expect(word(page, 1, 3)).toHaveClass(/new/); // alt: never marked
  expect(gh.backups(), 'restoring is not a change that needs a new backup').toBe(1);
});
