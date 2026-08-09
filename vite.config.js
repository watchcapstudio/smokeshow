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

// Front-end redesign candidate, for review only. Listed by hand rather than
// globbed because it is one page and it is meant to be deleted: when the
// proposal is accepted or rejected, this line and asdfasdf/ go together. It
// carries `noindex` and is absent from the sitemap, which is generated from
// src/data/locations.js and never sees this file.
const reviewPages = ['./asdfasdf/index.html'];

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: ['./index.html', ...locationPages, ...reviewPages],
    },
  },
});
