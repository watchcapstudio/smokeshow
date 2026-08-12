// Visual + measured check of the map's basemap and smoke ramp, in a real
// browser, at every rating level.
//
// Same rig shape as verify-sky.mjs: Open-Meteo is stubbed with a synthesised
// PM2.5 series so a run is reproducible and needs no network. This script adds
// a tile stub, because map tiles are the thing under test and a capture rig
// that depends on CARTO being reachable is a capture rig that stops working.
//
// THE TILES ARE SYNTHETIC. `light_nolabels` is stubbed with a flat field at
// SMOKE_BASEMAP_RGB — the tone SMOKE_STOPS is validated against — plus faint
// vector furniture so the stack order is visible, including a fill at the
// darkest tone in SMOKE_BASEMAP_BACKDROPS so the hardest backdrop for the
// ramp is actually present in the capture. `light_only_labels` is stubbed with
// dark place names on a transparent tile. That makes the composite arithmetic
// in these captures real (the smoke really is being drawn over the basemap
// tone and under the labels) while the cartography is not. Judge the ramp and
// the layer order here; judge the cartography against the live site.
//
// Reads back, per level:
//   - the smoke canvas's own pixels (mean RGBA of the covered field)
//   - that colour composited over the basemap, and its contrast against it
//   - whether the labels pane really sits above the smoke canvas
//
// Run:  npx vite --port 5173 &  node scripts/verify-map.mjs
//       node scripts/verify-map.mjs --tag=before --base=http://localhost:5174
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ugm3ToAqi } from '../src/lib/aqi.js';
import { SMOKE_BASEMAP_BACKDROPS } from '../src/lib/rating.js';

// Imported, not transcribed: the stub tiles and the contrast columns below
// both have to be the tones the ramp was validated against, or this rig
// measures a map that doesn't exist.
const [LAND, WATER, DARKEST] = SMOKE_BASEMAP_BACKDROPS.map((b) => b.rgb);
const rgbCss = (c) => `rgb(${c.join(',')})`;

const CHROME =
  process.env.CHROME_PATH ||
  ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(Boolean);
const OUT = process.env.SCRATCH || 'scratch';
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const TAG = arg('tag', 'after');
const BASE = arg('base', process.env.BASE_URL || 'http://localhost:5173');

mkdirSync(OUT, { recursive: true });

// One PM2.5 per rating level, at the middle of each band rather than its edge,
// so a capture shows what the level normally looks like and not a boundary.
const LEVELS = [
  { key: 'all-clear', name: 'All clear', pm: 6 },
  { key: 'in-the-air', name: 'In the air', pm: 23 },
  { key: 'smells', name: 'Hazy', pm: 45 },
  { key: 'tastes', name: 'Heavy haze', pm: 100 },
  { key: 'smokeshow', name: 'Smokeshow', pm: 220 },
];

const HOURS = 24 * 3 + 24; // past_days=3 + forecast, matching lib/openMeteo.js
function series(pm) {
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() - 72);
  const time = [];
  for (let i = 0; i < HOURS; i++) {
    time.push(new Date(start.getTime() + i * 3_600_000).toISOString().slice(0, 16));
  }
  return { time, pm2_5: time.map(() => pm) };
}

// ------------------------------------------------------------- stubbed tiles

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}</svg>`;

// CARTO light_nolabels (Positron): pale land, a water body, and a patch at the
// darkest tone the ramp is audited against — the backdrop where a ramp running
// the wrong way shows itself first. Everything here is below the smoke.
const LIGHT_NOLABELS = svg(
  `<rect width="256" height="256" fill="${rgbCss(LAND)}"/>` +
    `<path d="M0 176 C 60 150, 120 200, 256 168 L256 256 L0 256Z" fill="${rgbCss(WATER)}"/>` +
    `<rect x="150" y="24" width="86" height="64" rx="4" fill="${rgbCss(DARKEST)}"/>` +
    `<g stroke="#e2e0dc" stroke-width="3" fill="none">` +
    `<path d="M-10 60 L266 92"/><path d="M40 -10 L72 266"/><path d="M-10 210 L266 190"/>` +
    `</g>`,
);
// CARTO light_only_labels: dark place names with a pale halo, transparent
// elsewhere. Drawn ABOVE the smoke, which is the point of the sandwich.
const LIGHT_ONLY_LABELS = svg(
  `<g font-family="Helvetica,Arial" font-size="11" text-anchor="middle" ` +
    `paint-order="stroke" stroke="#fff" stroke-width="3" stroke-opacity="0.8" fill="#43484b">` +
    `<text x="64" y="48">RIVERTON</text><text x="180" y="120">ASHFIELD</text>` +
    `<text x="96" y="212">LAKE BEND</text></g>`,
);

// /api/fires, stubbed. Three incidents near the pinned location, chosen to
// exercise the card's omit-rather-than-guess rule: one fully reported, one
// with no containment figure filed, one with neither cause nor update stamp.
// A card that invents "0% contained" or "Cause: unknown" for the latter two is
// the failure this fixture is here to catch.
const FIRES = {
  source: 'stub',
  truncated: false,
  fires: [
    {
      id: 'stub-1',
      name: 'Kettle Ridge Fire',
      lat: 45.07,
      lon: -93.42,
      acres: 41280,
      contained: 38,
      discovered: '2026-07-24T18:00:00.000Z',
      cause: 'Lightning',
      state: 'MN',
      updated: '2026-08-01T13:00:00.000Z',
    },
    {
      id: 'stub-2',
      name: 'Birch Coulee Fire',
      lat: 44.87,
      lon: -93.06,
      acres: 2140,
      contained: null,
      discovered: '2026-07-30T02:00:00.000Z',
      cause: 'Human',
      state: 'MN',
      updated: '2026-08-01T13:00:00.000Z',
    },
    {
      id: 'stub-3',
      name: 'Little Elk Fire',
      lat: 45.11,
      lon: -93.09,
      acres: 96,
      contained: 90,
      discovered: null,
      cause: null,
      state: 'MN',
      updated: null,
    },
  ],
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

const rows = [];

for (const level of LEVELS) {
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

    if (url.includes('only_labels')) return tile(LIGHT_ONLY_LABELS);
    if (url.includes('basemaps.cartocdn.com')) return tile(LIGHT_NOLABELS);
    if (url.includes('air-quality')) {
      const n = (new URL(url).searchParams.get('latitude') || '').split(',').length;
      const one = { hourly: series(level.pm) };
      return json(n > 1 ? Array.from({ length: n }, () => one) : one);
    }
    if (url.includes('geocoding-api')) return json({ results: [{ name: 'Minneapolis' }] });
    if (url.includes('/api/sensors')) return json({});
    if (url.includes('/api/fires')) return json(FIRES);
    // No pre-rendered domains here: this rig is about the ramp and the layer
    // order, so the map paints the point grid and nothing else. The path moved
    // from /hrrr/ to /smokeshow/data/ when CAMS joined HRRR as a second domain.
    if (url.includes('/smokeshow/data/')) return req.respond({ status: 404, body: '' });
    return req.continue();
  });

  // mockOfficial pinned to the stub's own AQI so applySensorAnchor is a no-op
  // and the map paints exactly `pm` — same trick verify-sky.mjs uses.
  await page.goto(
    `${BASE}/?lat=44.98&lon=-93.27&name=Minneapolis&mockOfficial=${ugm3ToAqi(level.pm)}`,
    { waitUntil: 'networkidle2' },
  );
  // The map now rides in the top canvas behind a Sky/Map toggle and mounts
  // lazily on first flip, so switch to it before waiting for the smoke layer.
  await page.waitForSelector('.sbar__seg', { timeout: 30000 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sbar__seg')].find(
      (b) => b.textContent.trim() === 'Map',
    );
    btn?.click();
  });
  await page.waitForSelector('.smoke-canvas-layer', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200)); // tiles + the canvas redraw

  // Read before the click below: reaching a fire is what retires the hint, so
  // measuring it afterwards would always report "(none)" and prove nothing.
  const hint = await page.evaluate(
    () => document.querySelector('.fire-hint')?.textContent?.trim() ?? null,
  );

  // Open one fire card so the captures show it over the plume at every level —
  // heavy smoke is exactly where a card can stop being readable.
  await page.evaluate(() => {
    document
      .querySelector('.fire-dot')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 250));

  const measured = await page.evaluate(() => {
    const canvas = document.querySelector('.smoke-canvas-layer');
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Mean over pixels the field actually covers. Averaging in straight (not
    // premultiplied) space is what we want: the question is "what colour is
    // the smoke", separately from "how much of it is there".
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
    const cover = n / (canvas.width * canvas.height);

    // Layer order, read off the DOM rather than assumed.
    const paneZ = (sel) => {
      const el = document.querySelector(sel);
      return el ? Number(getComputedStyle(el).zIndex) || 0 : null;
    };
    const tileUrls = [...document.querySelectorAll('.leaflet-tile')]
      .map((t) => t.src)
      .filter(Boolean);
    const host = (u) => {
      try {
        return new URL(u).pathname.split('/')[1];
      } catch {
        return u;
      }
    };

    return {
      size: `${canvas.width}x${canvas.height}`,
      cover,
      rgba: n ? [r / n, g / n, b / n, a / n / 255] : null,
      smokeZ: paneZ('.leaflet-overlay-pane'),
      labelsZ: paneZ('.leaflet-pane.leaflet-labels-pane'),
      markerZ: paneZ('.leaflet-marker-pane'),
      tileSets: [...new Set(tileUrls.map(host))],
      attribution: document.querySelector('.leaflet-control-attribution')?.textContent?.trim(),
      attributionColor: document.querySelector('.leaflet-control-attribution')
        ? getComputedStyle(document.querySelector('.leaflet-control-attribution')).color
        : null,
      markerLabel: document.querySelector('.user-marker__label')?.textContent,
      firesZ: paneZ('.leaflet-pane.leaflet-fires-pane'),
      fireDots: document.querySelectorAll('.fire-dot').length,
      fireCard: [...document.querySelectorAll('.fire-card > *')].map((n) =>
        n.textContent.trim(),
      ),
      chip: document.querySelector('.rating-chip__level, .rating-chip h1, .rating-chip')
        ?.textContent?.slice(0, 40),
    };
  });

  const el = await page.$('.smoke-map');
  await el.screenshot({ path: `${OUT}/map-${TAG}-${level.key}.png` });
  await page.screenshot({ path: `${OUT}/page-${TAG}-${level.key}.png` });

  rows.push({ ...level, ...measured, fireHint: hint });
  await page.close();
}

await browser.close();

// -------------------------------------------------------------- the readback

const toLinear = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const contrast = (a, b) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));

const pad = (s, w) => String(s).padEnd(w);
console.log(`\nSMOKESHOW map verify — tag "${TAG}", ${BASE}`);
console.log(`  tiles are STUBBED (see header); ramp and layer order are real\n`);
console.log(
  pad('level', 20) +
    pad('pm', 6) +
    pad('smoke rgba', 26) +
    pad('cover', 8) +
    pad('vs land', 10) +
    pad('vs water', 10) +
    'vs darkest',
);
console.log('-'.repeat(98));
for (const r of rows) {
  const c = r.rgba ? r.rgba.slice(0, 3).map(Math.round) : null;
  const a = r.rgba ? r.rgba[3] : 0;
  const vs = (bg) => (c ? contrast(over(c, bg, a), bg).toFixed(2) : '—');
  console.log(
    pad(r.name, 20) +
      pad(r.pm, 6) +
      pad(c ? `${c.join(',')} @ ${a.toFixed(2)}` : '(empty)', 26) +
      pad(`${(r.cover * 100).toFixed(0)}%`, 8) +
      pad(vs(LAND), 10) +
      pad(vs(WATER), 10) +
      vs(DARKEST),
  );
}

const first = rows[0];
console.log(`\nlayer stack (z-index, read from the DOM):`);
console.log(`  smoke overlay pane   ${first.smokeZ}`);
console.log(`  labels pane          ${first.labelsZ ?? '(absent)'}`);
console.log(`  fires pane           ${first.firesZ ?? '(absent)'}`);
console.log(`  marker pane          ${first.markerZ}`);
console.log(`  tile sets loaded     ${first.tileSets.join(', ')}`);

console.log(`\nfire layer (stubbed feed, ${FIRES.fires.length} incidents):`);
console.log(`  dots drawn           ${first.fireDots}`);
console.log(`  hint                 ${first.fireHint ?? '(none)'}`);
console.log(`  card, opened         ${first.fireCard?.join(' | ') || '(none)'}`);
console.log(`\nattribution: ${first.attribution ?? '(none)'}`);
console.log(`  colour: ${first.attributionColor}`);
console.log(`marker label: ${first.markerLabel ?? '(none)'}`);

// Monotonic on every backdrop the basemap presents, not just the common one —
// the same band scripts/smoke-ramp-audit.mjs proves the ramp against, now
// measured on pixels a browser actually painted.
let rising = true;
console.log(`\nmeasured on the painted canvas:`);
for (const { key, rgb: bg } of SMOKE_BASEMAP_BACKDROPS) {
  const ratios = rows.map((r) =>
    r.rgba ? contrast(over(r.rgba.slice(0, 3), bg, r.rgba[3]), bg) : 0,
  );
  const ok = ratios.every((v, i) => i === 0 || v >= ratios[i - 1] - 1e-6);
  rising &&= ok;
  console.log(
    `  ${pad(key, 14)} vs rgb(${bg.join(',')}): ` +
      `${ratios.map((v) => v.toFixed(2)).join(' -> ')}  ${ok ? 'RISING' : 'NOT MONOTONIC'}`,
  );
}

writeFileSync(`${OUT}/map-${TAG}.json`, JSON.stringify({ tag: TAG, base: BASE, rows }, null, 2));
console.log(`\ncaptures: ${OUT}/map-${TAG}-<level>.png, page-${TAG}-<level>.png\n`);
process.exit(rising ? 0 : 1);
