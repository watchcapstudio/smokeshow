import { globSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Multi-page build: index.html plus one generated page per location
// (scripts/gen-location-pages.mjs, which `npm run build` runs first). Globbed
// rather than listed so adding a city to src/data/locations.js is the only
// edit — a hand-maintained input list here would be a second place to forget.
const locationPages = globSync('smoke-forecast/*/index.html', { cwd: import.meta.dirname }).map(
  (p) => `./${p}`,
);

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: ['./index.html', ...locationPages],
    },
  },
});
