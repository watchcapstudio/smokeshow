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
//   TILES ARE SYNTHETIC — flat rgb(20,23,26) land plus vector furniture, so
//   the composite arithmetic is real while the cartography is not.
//
//   HRRR FRAMES ARE REAL — pulled out of the `data` branch (origin/data) as
//   published. That is genuine 3 km NOAA smoke.
//
//   CAMS FRAMES ARE SYNTHETIC — rendered by scripts/cams/render_frames.py
//   --source synthetic, because ADS credentials live in a GitHub Actions
//   secret and never touch a workstation. The pipeline, the palette, the
//   resolution, the manifest and the byte sizes are exactly what ships; the
//   meteorology is invented. See scripts/cams/synthetic_field.py.
//
// Judge coverage, domain selection, the badge and the byte budget here. Judge
// the plumes themselves against the live site once the ADS job has run.
//
// Run:  npx vite --port 5173 &  node scripts/verify-domains.mjs
import puppeteer from 'puppeteer-core';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ugm3ToAqi } from '../src/lib/aqi.js';

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
  mkdirSync(join(DATA, 'hrrr'), { recursive: true });
  const git = (path) => execFileSync('git', ['show', `origin/data:${path}`], { maxBuffer: 1 << 28 });

  // Published HRRR, verbatim. Its v1 manifest becomes a v2 domain block.
  // The data branch moved to a root manifest.json (v2, domains[]) when CAMS
  // joined HRRR. Fall back to the old per-domain path so a run against an
  // un-republished branch still builds instead of crashing.
  let v1;
  try {
    const root = JSON.parse(git('manifest.json').toString());
    const hrrr = (root.domains || []).find((d) => d.id === 'hrrr');
    if (!hrrr) throw new Error('no hrrr domain in root manifest.json');
    v1 = { ...hrrr, frames: hrrr.frames ?? JSON.parse(git('hrrr/domain.json').toString()).frames };
  } catch {
    v1 = JSON.parse(git('hrrr/manifest.json').toString());
  }
  for (const f of v1.frames) writeFileSync(join(DATA, 'hrrr', f.file), git(`hrrr/${f.file}`));
  try {
    writeFileSync(join(DATA, 'hrrr', 'series.json'), git('hrrr/series.json'));
  } catch {
    /* the band is additive */
  }
  writeFileSync(
    join(DATA, 'hrrr', 'domain.json'),
    JSON.stringify({
      id: 'hrrr',
      label: 'NOAA HRRR-Smoke',
      model: 'HRRR-Smoke near-surface (MASSDEN, 8m AGL)',
      source: 'NOAA HRRR-Smoke',
      resolutionKm: 3,
      priority: 100,
      bounds: v1.bounds,
      width: v1.width,
      height: v1.height,
      wraps: false,
      run: v1.run,
      generated: v1.generated,
      series: 'series.json',
      frames: v1.frames,
    }),
  );

  // Global domain, from the synthetic source. Pinned to the same cycle the
  // published HRRR run covers so both domains span the same hours.
  const run = v1.run.slice(0, 13).replace(':', '');
  const r = spawnSync(
    'python3',
    ['scripts/cams/render_frames.py', '--source', 'synthetic', '--run', run],
    { env: { ...process.env, OUT_DIR: DATA }, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`cams render failed:\n${r.stderr}`);

  spawnSync('python3', ['scripts/render/assemble_manifest.py', DATA], { stdio: 'inherit' });
  return v1;
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

// The stubbed forecast has to span the hours the frames cover, or the app's
// clock lands on a time no domain has and everything falls back.
const HOURS = 24 * 3 + 24;
function series() {
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() - 72);
  const time = [];
  for (let i = 0; i < HOURS; i++) {
    time.push(new Date(start.getTime() + i * 3_600_000).toISOString().slice(0, 16));
  }
  return { time, pm2_5: time.map(() => PM) };
}

// ------------------------------------------------------------- stubbed tiles

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}</svg>`;
const DARK_NOLABELS = svg(
  `<rect width="256" height="256" fill="#14171a"/>` +
    `<path d="M0 176 C 60 150, 120 200, 256 168 L256 256 L0 256Z" fill="#0e1417"/>` +
    `<g stroke="#242a2e" stroke-width="2" fill="none">` +
    `<path d="M-10 60 L266 92"/><path d="M40 -10 L72 266"/><path d="M-10 210 L266 190"/>` +
    `</g>`,
);
const DARK_ONLY_LABELS = svg(
  `<g font-family="Helvetica,Arial" font-size="11" text-anchor="middle" ` +
    `paint-order="stroke" stroke="#000" stroke-width="3" stroke-opacity="0.7" fill="#b9c0c4">` +
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

    if (url.includes('dark_only_labels')) return tile(DARK_ONLY_LABELS);
    if (url.includes('basemaps.cartocdn.com')) return tile(DARK_NOLABELS);
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
