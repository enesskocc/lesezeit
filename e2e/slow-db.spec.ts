import { expect, test } from '@playwright/test';
import { mockReaderApi, setupAndOpen } from './fixtures';

// Regression (CI flake 2026-10-22): after "Kaydet ve test et" the app navigated to the home list
// before its live settings query had the new token, so "/" redirected back to setup. Slow reads of
// the settings store (300 ms, like a busy CI runner) reproduce it every time.
test('saving the token reaches the home list even when IndexedDB reads are slow', async ({ page }) => {
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      const req = get.call(this, key);
      if (this.name !== 'settings' || this.transaction.mode !== 'readonly') return req;
      let handler: ((ev: Event) => void) | null = null;
      Object.defineProperty(req, 'onsuccess', {
        configurable: true,
        get: () => handler,
        set: (h) => {
          handler = h;
          Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!.set!.call(req, (ev: Event) => setTimeout(() => h?.call(req, ev), 300));
        },
      });
      return req;
    };
  });
  await mockReaderApi(page);
  await setupAndOpen(page);
  await expect(page.getByRole('heading', { name: 'Ein erfundener Lesetext' })).toBeVisible();
});
