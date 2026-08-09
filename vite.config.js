import { globSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Multi-page build: index.html plus every page gen-location-pages.mjs emits —
// the hub at smoke-forecast/, one page per city under it, and the corridor pages
// one level deeper. Globbed rather than listed so adding a city to
// src/data/locations.js (or a corridor to src/data/corridors.js) is the only
// edit — a hand-maintained input list here would be a second place to forget.
//
// Three explicit patterns rather than one `**`: `**` behaviour across the zero-
// segment case differs between glob implementations, and the hub sits exactly at
// that case (smoke-forecast/index.html). Naming the three shapes is unambiguous
// and still costs no per-city maintenance.
const locationPages = [
  'smoke-forecast/index.html',
  'smoke-forecast/*/index.html',
  'smoke-forecast/corridor/*/index.html',
].flatMap((pattern) => globSync(pattern, { cwd: import.meta.dirname }).map((p) => `./${p}`));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: ['./index.html', ...locationPages],
    },
  },
});
