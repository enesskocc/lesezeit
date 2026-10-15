import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves this repo under https://enesskocc.github.io/lesezeit/
const base = '/lesezeit/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Icons are generated from public/icon.svg by `npm run icons` (pwa-assets.config.ts).
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: 'Lesezeit',
        short_name: 'Lesezeit',
        description: 'Almanca okuma ve kelime çalışması',
        lang: 'tr',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#eef1f4',
        theme_color: '#eef1f4',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. GitHub API responses are never cached by the service worker;
        // offline texts will live in IndexedDB (textCache) from milestone 5.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // German + Turkish only need the latin and latin-ext font subsets offline.
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-wght-*.woff2'],
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
});
