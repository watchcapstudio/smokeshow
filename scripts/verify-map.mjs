// Visual + measured check of the map's basemap and smoke ramp, in a real
// browser, at every rating level.
//
// Same rig shape as verify-sky.mjs: Open-Meteo is stubbed with a synthesised
// PM2.5 series so a run is reproducible and needs no network. This script adds
// a tile stub, because map tiles are the thing under test and a capture rig
// that depends on CARTO being reachable is a capture rig that stops working.
//
// THE TILES ARE SYNTHETIC. `dark_nolabels` is stubbed with a flat
// rgb(20,23,26) field — the tone SMOKE_STOPS is validated against, and the
// tone CARTO actually paints for land — plus faint vector furniture so the
// stack order is visible. `dark_only_labels` is stubbed with pale place names
// on a transparent tile. That makes the composite arithmetic in these captures
// real (the smoke really is being drawn over rgb(20,23,26) and under the
// labels) while the cartography is not. Judge the ramp and the layer order
// here; judge the cartography against the live site.
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
  { key: 'smells', name: 'Smells like fire', pm: 45 },
  { key: 'tastes', name: 'Tastes like fire', pm: 100 },
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

// CARTO dark_nolabels: near-black land, a slightly lighter water body, thin
// road lines. Everything here is below the smoke.
const DARK_NOLABELS = svg(
  `<rect width="256" height="256" fill="#14171a"/>` +
    `<path d="M0 176 C 60 150, 120 200, 256 168 L256 256 L0 256Z" fill="#0e1417"/>` +
    `<g stroke="#242a2e" stroke-width="2" fill="none">` +
    `<path d="M-10 60 L266 92"/><path d="M40 -10 L72 266"/><path d="M-10 210 L266 190"/>` +
    `</g>`,
);
// CARTO dark_only_labels: pale place names with a dark halo, transparent
// elsewhere. Drawn ABOVE the smoke, which is the point of the sandwich.
const DARK_ONLY_LABELS = svg(
  `<g font-family="Helvetica,Arial" font-size="11" text-anchor="middle" ` +
    `paint-order="stroke" stroke="#000" stroke-width="3" stroke-opacity="0.7" fill="#b9c0c4">` +
    `<text x="64" y="48">RIVERTON</text><text x="180" y="120">ASHFIELD</text>` +
    `<text x="96" y="212">LAKE BEND</text></g>`,
);
// What production used to serve here: bright OpenStreetMap raster.
const OSM = svg(
  `<rect width="256" height="256" fill="#f2efe9"/>` +
    `<path d="M0 176 C 60 150, 120 200, 256 168 L256 256 L0 256Z" fill="#aad3df"/>` +
    `<g stroke="#e0d8c8" stroke-width="3" fill="none">` +
    `<path d="M-10 60 L266 92"/><path d="M40 -10 L72 266"/><path d="M-10 210 L266 190"/>` +
    `</g>` +
    `<g font-family="Helvetica,Arial" font-size="11" text-anchor="middle" fill="#4a463f">` +
    `<text x="64" y="48">RIVERTON</text><text x="180" y="120">ASHFIELD</text>` +
    `<text x="96" y="212">LAKE BEND</text></g>`,
);

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

    if (url.includes('dark_only_labels')) return tile(DARK_ONLY_LABELS);
    if (url.includes('basemaps.cartocdn.com')) return tile(DARK_NOLABELS);
    if (url.includes('tile.openstreetmap.org')) return tile(OSM);
    if (url.includes('air-quality')) {
      const n = (new URL(url).searchParams.get('latitude') || '').split(',').length;
      const one = { hourly: series(level.pm) };
      return json(n > 1 ? Array.from({ length: n }, () => one) : one);
    }
    if (url.includes('geocoding-api')) return json({ results: [{ name: 'Minneapolis' }] });
    if (url.includes('/api/sensors')) return json({});
    // No pre-rendered domains here: this rig is about the ramp and the layer
    // order, so the map paints the point grid and nothing else.
    if (url.includes('/smokeshow/data/')) return req.respond({ status: 404, body: '' });
    return req.continue();
  });

  // mockOfficial pinned to the stub's own AQI so applySensorAnchor is a no-op
  // and the map paints exactly `pm` — same trick verify-sky.mjs uses.
  await page.goto(
    `${BASE}/?lat=44.98&lon=-93.27&name=Minneapolis&mockOfficial=${ugm3ToAqi(level.pm)}`,
    { waitUntil: 'networkidle2' },
  );
  await page.waitForSelector('.smoke-canvas-layer', { timeout: 30000 });
  await page.evaluate(() =>
    document.getElementById('map-slot')?.scrollIntoView({ block: 'center' }),
  );
  await new Promise((r) => setTimeout(r, 1200)); // tiles + the canvas redraw

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
      chip: document.querySelector('.rating-chip__level, .rating-chip h1, .rating-chip')
        ?.textContent?.slice(0, 40),
    };
  });

  const el = await page.$('.smoke-map');
  await el.screenshot({ path: `${OUT}/map-${TAG}-${level.key}.png` });
  await page.screenshot({ path: `${OUT}/page-${TAG}-${level.key}.png` });

  rows.push({ ...level, ...measured });
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

// The tone each basemap paints for land, as stubbed above.
const CARTO_DARK = [20, 23, 26];
const OSM_LIGHT = [242, 239, 233];

const pad = (s, w) => String(s).padEnd(w);
console.log(`\nSMOKESHOW map verify — tag "${TAG}", ${BASE}`);
console.log(`  tiles are STUBBED (see header); ramp and layer order are real\n`);
console.log(
  pad('level', 20) + pad('pm', 6) + pad('smoke rgba', 26) + pad('cover', 8) + pad('vs dark', 10) + 'vs light',
);
console.log('-'.repeat(88));
for (const r of rows) {
  const c = r.rgba ? r.rgba.slice(0, 3).map(Math.round) : null;
  const a = r.rgba ? r.rgba[3] : 0;
  console.log(
    pad(r.name, 20) +
      pad(r.pm, 6) +
      pad(c ? `${c.join(',')} @ ${a.toFixed(2)}` : '(empty)', 26) +
      pad(`${(r.cover * 100).toFixed(0)}%`, 8) +
      pad(c ? `${contrast(over(c, CARTO_DARK, a), CARTO_DARK).toFixed(2)}` : '—', 10) +
      (c ? `${contrast(over(c, OSM_LIGHT, a), OSM_LIGHT).toFixed(2)}` : '—'),
  );
}

const first = rows[0];
console.log(`\nlayer stack (z-index, read from the DOM):`);
console.log(`  smoke overlay pane   ${first.smokeZ}`);
console.log(`  labels pane          ${first.labelsZ ?? '(absent)'}`);
console.log(`  marker pane          ${first.markerZ}`);
console.log(`  tile sets loaded     ${first.tileSets.join(', ')}`);
console.log(`\nattribution: ${first.attribution ?? '(none)'}`);
console.log(`  colour: ${first.attributionColor}`);
console.log(`marker label: ${first.markerLabel ?? '(none)'}`);

// Monotonic against the basemap the tiles actually are, per tag.
const dark = first.tileSets.some((t) => /dark/.test(t));
const bg = dark ? CARTO_DARK : OSM_LIGHT;
const ratios = rows.map((r) =>
  r.rgba ? contrast(over(r.rgba.slice(0, 3), bg, r.rgba[3]), bg) : 0,
);
const rising = ratios.every((v, i) => i === 0 || v >= ratios[i - 1] - 1e-6);
console.log(
  `\nmeasured on the painted canvas, against rgb(${bg.join(',')}): ` +
    `${ratios.map((v) => v.toFixed(2)).join(' -> ')}  ${rising ? 'RISING' : 'NOT MONOTONIC'}`,
);

writeFileSync(`${OUT}/map-${TAG}.json`, JSON.stringify({ tag: TAG, base: BASE, rows }, null, 2));
console.log(`\ncaptures: ${OUT}/map-${TAG}-<level>.png, page-${TAG}-<level>.png\n`);
process.exit(rising ? 0 : 1);
