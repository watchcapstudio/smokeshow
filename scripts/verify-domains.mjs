// Visual + measured check of multi-domain smoke coverage, in a real browser.
//
// Answers the question B11 exists for: at the same zoom, what does the map
// show in Missoula (inside HRRR's 3 km CONUS box), Edmonton (outside it, and
// upwind of the fires that drive most North American smoke), and Madrid
// (never covered by anything)? Reads back which domain won, what the coverage
// badge says, and how much of the canvas the field actually paints.
//
// Same rig shape as verify-map.mjs, and the same bargain about what is real:
//
//   TILES ARE SYNTHETIC — Positron's tones, taken from SMOKE_BASEMAP_BACKDROPS
//   so they track the real basemap, plus vector furniture. The composite
//   arithmetic is real; the cartography is not.
//
//   THE FRAMES ARE REAL — every domain the `data` branch publishes is mirrored
//   verbatim out of origin/data, so the smoke is genuine NOAA and Copernicus
//   output at its published resolution and its published byte size.
//
//   The one exception: if the branch has not published a `cams` domain yet,
//   the rig falls back to scripts/cams/render_frames.py --source synthetic and
//   says so on stdout. That path existed because ADS credentials live in an
//   Actions secret and never touch a workstation; it is now a fallback, not
//   the normal case. When it runs, the meteorology is invented and only the
//   pipeline, palette, resolution and manifest are real.
//
// Judge coverage, domain selection, the badge, the seam and the byte budget
// here. Judge the cartography against the live site.
//
// Run:  npx vite --port 5173 &  node scripts/verify-domains.mjs
import puppeteer from 'puppeteer-core';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ugm3ToAqi } from '../src/lib/aqi.js';
import { SMOKE_BASEMAP_BACKDROPS } from '../src/lib/rating.js';

const CHROME =
  process.env.CHROME_PATH ||
  ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(Boolean);
const OUT = process.env.SCRATCH || 'scratch';
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const TAG = arg('tag', 'after');
const BASE = arg('base', process.env.BASE_URL || 'http://localhost:5173');
const DATA = arg('data', join(OUT, 'data'));
// Two zooms, both applied to all three cities. 9 is what the product opens at;
// 4 is where a 40 km field has enough pixels to show structure rather than a
// flat wash, and where the coverage story — who is inside HRRR's box and who is
// not — is actually visible.
const ZOOMS = (arg('zooms', '9,4')).split(',').map(Number);

// One city per coverage story, each captured at every zoom in ZOOMS.
const PLACES = [
  { key: 'missoula', name: 'Missoula', lat: 46.87, lon: -113.99, expect: 'hrrr' },
  { key: 'edmonton', name: 'Edmonton', lat: 53.55, lon: -113.49, expect: 'cams' },
  { key: 'madrid', name: 'Madrid', lat: 40.42, lon: -3.7, expect: 'cams' },
];

const PM = 45; // "Smells like fire" — mid-scale, so the ramp is clearly painting

// ------------------------------------------------------------- the data tree
//
// Built once into `scratch/data`, shaped exactly like the `data` branch.

function buildData() {
  const git = (path) => execFileSync('git', ['show', `origin/data:${path}`], { maxBuffer: 1 << 28 });

  // Mirror EVERY domain the branch publishes, not a chosen two. What the
  // client sees is the whole manifest, so a rig that copies only the domains
  // it expects cannot catch an unexpected one — and one showed up (see the
  // hrrr-dark note in docs/global-frames.md). Copying them all means the
  // captures exercise the real priority ordering.
  const root = JSON.parse(git('manifest.json').toString());
  if (root.version !== 2) throw new Error(`data branch manifest is v${root.version}, expected 2`);

  for (const d of root.domains) {
    mkdirSync(join(DATA, d.id), { recursive: true });
    const block = JSON.parse(git(`${d.id}/domain.json`).toString());
    writeFileSync(join(DATA, d.id, 'domain.json'), JSON.stringify(block));
    for (const f of block.frames) writeFileSync(join(DATA, d.id, f.file), git(`${d.id}/${f.file}`));
    if (block.series) {
      try {
        writeFileSync(join(DATA, d.id, block.series), git(`${d.id}/${block.series}`));
      } catch {
        /* the agreement band is additive */
      }
    }
    console.log(`  mirrored ${d.id}: ${block.frames.length} frames`);
  }

  // Only synthesise the global domain if the branch has not published one.
  // Before the ADS credentials landed this was the only way to exercise a
  // second domain at all; now it is a fallback, and the header's warning
  // about invented meteorology applies only when this branch runs.
  if (!root.domains.some((d) => d.id === 'cams')) {
    const hrrr = root.domains.find((d) => d.id === 'hrrr');
    console.log('  no cams domain published — falling back to the synthetic field');
    const r = spawnSync(
      'python3',
      ['scripts/cams/render_frames.py', '--source', 'synthetic', '--run', hrrr.run.slice(0, 13).replace(':', '')],
      { env: { ...process.env, OUT_DIR: DATA }, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`cams render failed:\n${r.stderr}`);
  }

  spawnSync('python3', ['scripts/render/assemble_manifest.py', DATA], { stdio: 'inherit' });
}

function domainBytes(id) {
  const dir = join(DATA, id);
  const files = readdirSync(dir).filter((f) => f.endsWith('.png'));
  const sizes = files.map((f) => statSync(join(dir, f)).size);
  return {
    frames: sizes.length,
    total: sizes.reduce((a, b) => a + b, 0),
    mean: sizes.reduce((a, b) => a + b, 0) / sizes.length,
    max: Math.max(...sizes),
  };
}

mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DATA, 'manifest.json'))) buildData();
const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8'));

// The stubbed forecast spans the hours the FRAMES cover, not the hours around
// wall-clock now. Anchoring to the clock only works on a day when the checked
// -out `data` branch happens to carry today's run; once it is a few days old,
// every domain misses every hour and this rig reports a clean sweep of
// coarse-grid fallbacks that looks like a product regression and is really a
// stale checkout. It fooled the author of the rig. findNowIndex() clamps to
// the nearest time, so anchoring to the manifest puts the initial paint on a
// covered hour whatever the date is.
const FRAME_TIMES = [
  ...new Set(manifest.domains.flatMap((d) => d.frames.map((f) => f.time))),
].sort();
if (!FRAME_TIMES.length) throw new Error('manifest has no frames — nothing to verify');

function series() {
  const first = new Date(`${FRAME_TIMES[0]}Z`).getTime();
  const last = new Date(`${FRAME_TIMES[FRAME_TIMES.length - 1]}Z`).getTime();
  const time = [];
  for (let t = first; t <= last; t += 3_600_000) {
    time.push(new Date(t).toISOString().slice(0, 16));
  }
  return { time, pm2_5: time.map(() => PM) };
}

// ------------------------------------------------------------- stubbed tiles

// Tones come from SMOKE_BASEMAP_BACKDROPS, not from literals here, for the
// same reason verify-map.mjs does it: this rig shipped with hard-coded dark
// tiles and kept using them after the map moved to Positron, so it was reading
// a darkening ramp against a near-black stub and judging chrome legibility
// against a backdrop the product no longer has. Derived, it cannot drift again.
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}</svg>`;
const [LAND, WATER, DARKEST] = SMOKE_BASEMAP_BACKDROPS.map((b) => b.rgb);
const rgbCss = (c) => `rgb(${c.join(',')})`;

// CARTO light_nolabels (Positron): pale land, a water body, and a patch at the
// darkest tone the ramp is audited against. Everything here is below the smoke.
const BASE_NOLABELS = svg(
  `<rect width="256" height="256" fill="${rgbCss(LAND)}"/>` +
    `<path d="M0 176 C 60 150, 120 200, 256 168 L256 256 L0 256Z" fill="${rgbCss(WATER)}"/>` +
    `<rect x="150" y="24" width="86" height="64" rx="4" fill="${rgbCss(DARKEST)}"/>` +
    `<g stroke="#e2e0dc" stroke-width="3" fill="none">` +
    `<path d="M-10 60 L266 92"/><path d="M40 -10 L72 266"/><path d="M-10 210 L266 190"/>` +
    `</g>`,
);
// CARTO light_only_labels: dark place names with a pale halo, transparent
// elsewhere. Drawn ABOVE the smoke, which is the point of the sandwich.
const BASE_ONLY_LABELS = svg(
  `<g font-family="Helvetica,Arial" font-size="11" text-anchor="middle" ` +
    `paint-order="stroke" stroke="#fff" stroke-width="3" stroke-opacity="0.8" fill="#43484b">` +
    `<text x="64" y="48">RIVERTON</text><text x="180" y="120">ASHFIELD</text>` +
    `<text x="96" y="212">LAKE BEND</text></g>`,
);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

const rows = [];
const transfer = [];

for (const place of PLACES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    const json = (body) =>
      req.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body),
      });
    const tile = (body) =>
      req.respond({
        status: 200,
        contentType: 'image/svg+xml',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body,
      });

    // The `data` branch, served off disk.
    const m = url.match(/\/smokeshow\/data\/(.+)$/);
    if (m) {
      const path = join(DATA, m[1]);
      if (!existsSync(path)) return req.respond({ status: 404, body: '' });
      const body = readFileSync(path);
      transfer.push({ place: place.key, path: m[1], bytes: body.length });
      return req.respond({
        status: 200,
        contentType: path.endsWith('.png') ? 'image/png' : 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body,
      });
    }

    if (url.includes('only_labels')) return tile(BASE_ONLY_LABELS);
    if (url.includes('basemaps.cartocdn.com')) return tile(BASE_NOLABELS);
    if (url.includes('air-quality')) {
      const n = (new URL(url).searchParams.get('latitude') || '').split(',').length;
      const one = { hourly: series() };
      return json(n > 1 ? Array.from({ length: n }, () => one) : one);
    }
    if (url.includes('geocoding-api')) return json({ results: [{ name: place.name }] });
    if (url.includes('/api/sensors')) return json({});
    return req.continue();
  });

  await page.goto(
    `${BASE}/?lat=${place.lat}&lon=${place.lon}&name=${encodeURIComponent(place.name)}` +
      `&mockOfficial=${ugm3ToAqi(PM)}`,
    { waitUntil: 'networkidle2' },
  );
  await page.waitForSelector('.smoke-canvas-layer', { timeout: 30000 });
  await page.evaluate(() => document.getElementById('map-slot')?.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 1200));

  for (const zoom of ZOOMS) {
    await page.evaluate((z) => window.__smokeshowMap?.setZoom(z), zoom);
    await new Promise((r) => setTimeout(r, 2000)); // tiles + frame decode + redraw

    const measured = await page.evaluate(() => {
      const canvas = document.querySelector('.smoke-canvas-layer');
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        a += data[i + 3];
        n++;
      }
      return {
        zoom: window.__smokeshowMap?.getZoom() ?? null,
        cover: n / (canvas.width * canvas.height),
        rgba: n ? [r / n, g / n, b / n, a / n / 255] : null,
        badge: document.querySelector('.smoke-coverage')?.textContent ?? null,
        domain: document.querySelector('.smoke-coverage')?.dataset.domain || null,
        base: document.querySelector('.smoke-coverage')?.dataset.base || null,
        badgeTitle: document.querySelector('.smoke-coverage')?.title ?? null,
        attribution: document.querySelector('.leaflet-control-attribution')?.textContent?.trim(),
        marker: document.querySelector('.user-marker__label')?.textContent,
      };
    });

    const el = await page.$('.smoke-map');
    await el.screenshot({ path: `${OUT}/domain-${TAG}-z${zoom}-${place.key}.png` });
    await page.screenshot({ path: `${OUT}/domain-page-${TAG}-z${zoom}-${place.key}.png` });

    rows.push({ ...place, ...measured });
  }
  await page.close();
}

await browser.close();

// -------------------------------------------------------------- the readback

const pad = (s, w) => String(s).padEnd(w);
const kb = (b) => `${(b / 1024).toFixed(0)} KB`;

console.log(`\nSMOKESHOW domain verify — tag "${TAG}", ${BASE}`);
console.log(`  manifest v${manifest.version}, ${manifest.domains.length} domain(s)\n`);

console.log(pad('domain', 10) + pad('res', 7) + pad('extent', 34) + pad('px', 12) + 'frames / mean / max / total');
console.log('-'.repeat(110));
for (const d of manifest.domains) {
  const b = domainBytes(d.id);
  console.log(
    pad(d.id, 10) +
      pad(`${d.resolutionKm} km`, 7) +
      pad(
        `${d.bounds.latS}..${d.bounds.latN} N, ${d.bounds.lonW}..${d.bounds.lonE} E`,
        34,
      ) +
      pad(`${d.width}x${d.height}`, 12) +
      `${b.frames}  ${kb(b.mean)}  ${kb(b.max)}  ${(b.total / 1024 / 1024).toFixed(1)} MB`,
  );
}

console.log(
  `\n${pad('place', 12)}${pad('zoom', 6)}${pad('domain', 9)}${pad('backfill', 10)}${pad('cover', 8)}badge`,
);
console.log('-'.repeat(104));
let mismatches = 0;
for (const r of rows) {
  const ok = r.domain === r.expect;
  if (!ok) mismatches++;
  console.log(
    `${ok ? ' ' : '!'}${pad(r.name, 11)}${pad(r.zoom, 6)}${pad(r.domain ?? '—', 9)}` +
      `${pad(r.base ?? '—', 10)}${pad(`${(r.cover * 100).toFixed(0)}%`, 8)}${r.badge ?? '(none)'}`,
  );
}

console.log(`\nbytes the browser actually pulled from the data branch, per capture:`);
for (const p of PLACES) {
  const t = transfer.filter((x) => x.place === p.key);
  const png = t.filter((x) => x.path.endsWith('.png'));
  const total = t.reduce((a, b) => a + b.bytes, 0);
  console.log(
    `  ${pad(p.name, 12)} ${t.length} requests, ${png.length} frame(s), ${kb(total)}` +
      (png.length ? `  (largest frame ${kb(Math.max(...png.map((x) => x.bytes)))})` : ''),
  );
}

console.log(`\nattribution: ${rows[0].attribution ?? '(none)'}`);
console.log(`badge title: ${rows[0].badgeTitle ?? '(none)'}`);

writeFileSync(
  `${OUT}/domains-${TAG}.json`,
  JSON.stringify({ tag: TAG, base: BASE, manifest: manifest.domains.map((d) => ({ ...d, frames: d.frames.length })), rows, transfer }, null, 2),
);
console.log(`\ncaptures: ${OUT}/domain-${TAG}-z<zoom>-<place>.png, domain-page-${TAG}-z<zoom>-<place>.png\n`);
process.exit(mismatches ? 1 : 0);
