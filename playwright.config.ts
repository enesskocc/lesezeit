import { defineConfig, devices } from '@playwright/test';

// E2E smoke tests in WebKit (Safari's engine) with an iPhone viewport.
// Runs against the production build (`npm run build` first) served by `vite preview`.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/lesezeit/',
    // page.route() cannot see requests that pass through a service worker.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'iphone-webkit', use: { ...devices['iPhone 15'] } }],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/lesezeit/',
    reuseExistingServer: !process.env.CI,
  },
});
