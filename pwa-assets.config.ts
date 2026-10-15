import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // iOS fills transparent apple-touch icons with black, so pad them with the brand color.
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#2a4a94' } },
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#2a4a94' } },
  },
  images: ['public/icon.svg'],
});
