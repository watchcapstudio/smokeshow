// Packages the /asdfasdf/ review page into ONE self-contained HTML file.
//
// Why this exists: the Vercel preview for a branch sits behind the project's
// SSO protection, so the only way to look at a proposal is to be logged into
// the Vercel team. A single file with everything inlined can be published
// somewhere that just opens — on a phone, without an account.
//
// Review-only, like everything else it packages. When asdfasdf/ and src/proto/
// go, this goes with them.
//
// The normal build code-splits: the page's entry statically imports a shared
// vendor chunk, and an inline <script> cannot resolve a bare `./chunk.js`.
// So this runs a second, separate build in library mode with
// inlineDynamicImports, which collapses the whole graph — React, the fixtures,
// every src/lib module — into one IIFE and one stylesheet.
//
//   node scripts/build-review-artifact.mjs [outfile]

import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'dist-review', 'smokeshow-candidate.html'));

const bundle = await build({
  configFile: false,
  root: ROOT,
  plugins: [react()],
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    write: false, // keep it in memory; this file assembles the output itself
    cssCodeSplit: false,
    lib: {
      entry: join(ROOT, 'src/proto/main.jsx'),
      formats: ['iife'],
      name: 'SmokeshowReview',
      fileName: () => 'review.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

const outputs = (Array.isArray(bundle) ? bundle[0] : bundle).output;
const js = outputs.find((o) => o.type === 'chunk').code;
const css = outputs.find((o) => o.fileName?.endsWith('.css'))?.source ?? '';

// The page's markup is the source file's <body>, minus the module tag — the
// script is being inlined at the end instead. Everything else (the FAQ, the
// explainer, the disclaimer, the footer slot) is carried over verbatim,
// because that material is the part of the page that is NOT under review.
const page = await readFile(join(ROOT, 'asdfasdf/index.html'), 'utf8');
const body = page
  .slice(page.indexOf('<body>') + '<body>'.length, page.lastIndexOf('</body>'))
  .replace(/\s*<script type="module"[^>]*><\/script>/, '');

// A bundle can legitimately contain the characters "</script>" inside a string
// literal, and the HTML parser would end the block there. Breaking the tag is
// the standard fix and survives JS parsing unchanged.
const safe = (code) => code.replace(/<\/script/gi, '<\\/script');

const html = `<title>SMOKESHOW — front-end candidate</title>
<style>
${css}</style>
${body}
<script>
${safe(js)}
</script>
`;

await writeFile(OUT, html, 'utf8');
console.log(`${OUT}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} kB`);
