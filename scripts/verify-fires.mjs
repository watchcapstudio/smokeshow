// Visual + measured check of the FIRMS fire layer, in a real browser, at the
// zoom levels the layer exists for.
//
// Same rig shape as verify-map.mjs: tiles and Open-Meteo are stubbed so a run
// is reproducible and needs no network. fires.json is stubbed too — with the
// output of the REAL clusterer (scripts/hrrr/fetch_fires.py) run over the
// synthetic FIRMS CSVs from scripts/hrrr/fires_fixture.py, because a live
// fetch needs a MAP_KEY that only GitHub Actions holds.
//
// THE FIRES ARE SYNTHETIC. The filter thresholds, the clustering, the payload
// shape, the merge, the icon sizing and every pixel of the drawing are real.
// Judge the legibility and the clutter here; judge the fire locations against
// the live feed.
//
// Each scene is captured twice, against both backdrops the icon has to beat:
//   clear  — bare CARTO Positron tiles, the light land tone
//   plume  — 220 µg/m³ everywhere, which the darkening ramp composites to near-black
// and the second one is the normal case, since fires sit under their own smoke.
//
// Measured, by screenshotting the largest icon and reading its pixels back:
//   - the backdrop it is actually sitting on
//   - the darkest and brightest tone inside the icon, and each one's contrast
//     against that backdrop (the two rings, doing their opposite jobs)
//
// Run:  npx vite --port 5173 &  node scripts/verify-fires.mjs
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ugm3ToAqi } from '../src/lib/aqi.js';

const CHROME =
  process.env.CHROME_PATH ||
  ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(Boolean);
const OUT = process.env.SCRATCH || 'scratch';
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const TAG = arg('tag', 'after');
const BASE = arg('base', process.env.BASE_URL || 'http://localhost:5173');

mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------- fires fixture
// Built by the real pipeline, so the cluster counts printed below are the
// numbers fetch_fires.py actually produces — not numbers invented here.
// Keep-clear distance from the map's edges when picking an icon to photograph:
// a padded clip around an edge icon spills onto the page behind the map.
const ICON_EDGE_MARGIN = 34;
const FIRES_PATH = `${OUT}/fires.json`;
if (!existsSync(FIRES_PATH)) {
  console.log('building fires.json via the real clusterer…');
  execFileSync('python3', ['scripts/hrrr/fires_fixture.py', '--out', `${OUT}/firms`], {
    stdio: 'inherit',
  });
  execFileSync('python3', ['scripts/hrrr/fetch_fires.py'], {
    stdio: 'inherit',
    env: { ...process.env, FIRMS_FIXTURE_DIR: `${OUT}/firms`, FIRES_OUT: OUT },
  });
}
const FIRES = JSON.parse(readFileSync(FIRES_PATH, 'utf8'));

// ------------------------------------------------------------------- scenes
// Zoom 5 over the Canadian boreal and zoom 4 over CONUS: the scales at which
// "where is this coming from" actually gets asked. Zoom 11 is the clutter
// check — the layer must recede, not dominate, once you are looking at a city.
// The CONUS scene runs at a desktop width because the shell caps content at
// 720px and the map inherits it: 430px of map at zoom 4 is 38 degrees of
// longitude, which is not CONUS. Everything else is the phone.
const PHONE = { width: 430, height: 932 };
const DESKTOP = { width: 900, height: 1100 };
const SCENES = [
  { key: 'canada', name: 'BC/Alberta boreal', lat: 57.9, lon: -121.5, zoom: 5, vp: PHONE },
  { key: 'conus', name: 'CONUS', lat: 39.5, lon: -97.0, zoom: 4, vp: DESKTOP },
  { key: 'conus-phone', name: 'CONUS (phone)', lat: 41.0, lon: -105.0, zoom: 4, vp: PHONE },
  { key: 'zoomed-in', name: 'Zoomed in (clutter)', lat: 57.62, lon: -122.85, zoom: 11, vp: PHONE },
];
const BACKDROPS = [
  { key: 'clear', name: 'bare tiles', pm: 6 },
  { key: 'plume', name: 'heavy smoke', pm: 220 },
];

// ------------------------------------------------------------- stubbed tiles
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${body}</svg>`;
// CARTO Positron, matching scripts/verify-map.mjs and the tones
// SMOKE_BASEMAP_BACKDROPS in src/lib/rating.js is audited against.
const LIGHT_NOLABELS = svg(
  `<rect width="256" height="256" fill="rgb(242,240,236)"/>` +
    `<path d="M0 176 C 60 150, 120 200, 256 168 L256 256 L0 256Z" fill="rgb(202,210,211)"/>` +
    `<rect x="150" y="24" width="86" height="64" rx="4" fill="rgb(176,180,182)"/>` +
    `<g stroke="#e2e0dc" stroke-width="3" fill="none">` +
    `<path d="M-10 60 L266 92"/><path d="M40 -10 L72 266"/><path d="M-10 210 L266 190"/></g>`,
);
const LIGHT_ONLY_LABELS = svg(
  `<g font-family="Helvetica,Arial" font-size="11" text-anchor="middle" ` +
    `paint-order="stroke" stroke="#fff" stroke-width="3" stroke-opacity="0.8" fill="#43484b">` +
    `<text x="64" y="48">RIVERTON</text><text x="180" y="120">ASHFIELD</text>` +
    `<text x="96" y="212">LAKE BEND</text></g>`,
);

const HOURS = 24 * 3 + 24;
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

// ---------------------------------------------------------------- pixel math
const toLinear = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const contrast = (a, b) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});

const rows = [];
let popupText = null;

for (const scene of SCENES) {
  for (const backdrop of BACKDROPS) {
    const page = await browser.newPage();
    await page.setViewport({ ...scene.vp, deviceScaleFactor: 2 });
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
      if (url.includes('fires.json')) return json(FIRES);
      if (url.includes('only_labels'))
        return req.respond({
          status: 200,
          contentType: 'image/svg+xml',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: LIGHT_ONLY_LABELS,
        });
      if (url.includes('basemaps.cartocdn.com'))
        return req.respond({
          status: 200,
          contentType: 'image/svg+xml',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: LIGHT_NOLABELS,
        });
      if (url.includes('air-quality')) {
        const n = (new URL(url).searchParams.get('latitude') || '').split(',').length;
        const one = { hourly: series(backdrop.pm) };
        return json(n > 1 ? Array.from({ length: n }, () => one) : one);
      }
      if (url.includes('geocoding-api')) return json({ results: [{ name: 'Fort Nelson' }] });
      if (url.includes('/api/sensors')) return json({});
      if (url.includes('/hrrr/')) return req.respond({ status: 404, body: '' });
      return req.continue();
    });

    await page.goto(
      `${BASE}/?lat=${scene.lat}&lon=${scene.lon}&name=${encodeURIComponent(scene.name)}` +
        `&mockOfficial=${ugm3ToAqi(backdrop.pm)}`,
      { waitUntil: 'networkidle2' },
    );
    // The map rides in the top canvas now, behind a Sky/Map toggle, and mounts
    // lazily on first flip — switch to it before waiting for the smoke layer.
    await page.waitForSelector('.sbar__seg', { timeout: 30000 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.sbar__seg')].find(
        (b) => b.textContent.trim() === 'Map',
      );
      btn?.click();
    });
    await page.waitForSelector('.smoke-canvas-layer', { timeout: 30000 });
    // Drive zoom directly — the map exposes itself in DEV for exactly this.
    await page.evaluate((z) => window.__smokeshowMap?.setZoom(z), scene.zoom);
    await page.waitForFunction(() => document.querySelectorAll('.fire-icon').length > 0, {
      timeout: 20000,
    });
    await new Promise((r) => setTimeout(r, 1400)); // tiles + canvas redraw settle

    const measured = await page.evaluate((MARGIN) => {
      const icons = [...document.querySelectorAll('.fire-icon')];
      const sizes = icons.map((el) => Math.round(el.getBoundingClientRect().width));
      // The one to photograph: the biggest icon that sits clear of the map's
      // own edges. A padded clip around an edge icon spills onto the page
      // behind the map, and the backdrop reading would be of the page, not
      // the basemap.
      const map = document.querySelector('.smoke-map').getBoundingClientRect();
      let best = null;
      for (const el of icons) {
        const r = el.getBoundingClientRect();
        const inset =
          r.left - MARGIN > map.left &&
          r.right + MARGIN < map.right &&
          r.top - MARGIN > map.top &&
          r.bottom + MARGIN < map.bottom;
        if (inset && (!best || r.width > best.w)) best = { w: r.width, x: r.x, y: r.y };
      }

      const canvas = document.querySelector('.smoke-canvas-layer');
      const ctx = canvas.getContext('2d');
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

      const paneZ = (sel) => {
        const el = document.querySelector(sel);
        return el ? Number(getComputedStyle(el).zIndex) || 0 : null;
      };

      return {
        icons: icons.length,
        maxPx: sizes.length ? Math.max(...sizes) : 0,
        minPx: sizes.length ? Math.min(...sizes) : 0,
        labelled: document.querySelectorAll('.fire-icon__count').length,
        opacity: icons.length ? Number(getComputedStyle(icons[0]).opacity) : null,
        legend: document.querySelector('.fire-legend')?.textContent?.trim() ?? null,
        smokeMean: n ? [r / n, g / n, b / n, a / n / 255] : null,
        smokeZ: paneZ('.leaflet-overlay-pane'),
        labelsZ: paneZ('.leaflet-pane.leaflet-labels-pane'),
        hotspotsZ: paneZ('.leaflet-pane.leaflet-hotspots-pane'),
        markerZ: paneZ('.leaflet-marker-pane'),
        // getBoundingClientRect is viewport-relative; page.screenshot's clip is
        // document-relative, and this page is scrolled to the map.
        probe: best
          ? { x: best.x + window.scrollX, y: best.y + window.scrollY, w: best.w }
          : null,
      };
    }, ICON_EDGE_MARGIN);

    // --- read the icon's real pixels back --------------------------------
    // Screenshot a padded box around the largest icon, load it back into the
    // page as an image, and sample it. This measures the composite that
    // actually paints — gradient, both rings, the bloom, and whatever the
    // smoke canvas put underneath — rather than the CSS we hoped for.
    let probe = null;
    if (measured.probe) {
      const PAD = 22;
      const clip = {
        x: Math.max(0, Math.round(measured.probe.x - PAD)),
        y: Math.max(0, Math.round(measured.probe.y - PAD)),
        width: Math.round(measured.probe.w + PAD * 2),
        height: Math.round(measured.probe.w + PAD * 2),
      };
      const shot = await page.screenshot({ clip, encoding: 'base64' });
      probe = await page.evaluate(
        async (b64, pad, w) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const c = document.createElement('canvas');
              c.width = img.width;
              c.height = img.height;
              const cx = c.getContext('2d');
              cx.drawImage(img, 0, 0);
              const { data } = cx.getImageData(0, 0, c.width, c.height);
              const s = img.width / (w + pad * 2); // device pixel ratio
              const mid = c.width / 2;
              // The icon plus its 2px dark ring, in device pixels.
              const rIcon = ((w / 2) + 3) * s;
              const px = (i) => [data[i], data[i + 1], data[i + 2]];
              const L = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

              let dark = null;
              let bright = null;
              const outer = [];
              for (let y = 0; y < c.height; y++) {
                for (let x = 0; x < c.width; x++) {
                  const i = (y * c.width + x) * 4;
                  const d = Math.hypot(x - mid, y - mid);
                  const p = px(i);
                  if (d <= rIcon) {
                    if (!dark || L(p) < L(dark)) dark = p;
                    if (!bright || L(p) > L(bright)) bright = p;
                  } else if (d > rIcon + 11 * s) {
                    // Clear of the warm bloom, so the backdrop number is the
                    // map behind the icon and not the icon's own halo.
                    outer.push(p);
                  }
                }
              }
              // Median backdrop, so a place label or a road clipped into the
              // corner cannot drag the number around.
              outer.sort((a, b) => L(a) - L(b));
              resolve({
                backdrop: outer.length ? outer[Math.floor(outer.length / 2)] : null,
                dark,
                bright,
              });
            };
            img.src = `data:image/png;base64,${b64}`;
          }),
        shot,
        PAD,
        measured.probe.w,
      );
    }

    const el = await page.$('.smoke-map');
    await el.screenshot({ path: `${OUT}/fires-${TAG}-${scene.key}-${backdrop.key}.png` });
    await page.screenshot({ path: `${OUT}/fires-page-${TAG}-${scene.key}-${backdrop.key}.png` });

    // The tap copy, captured once, from the scene where it matters most.
    // Re-find the icon rather than reusing the id tagged above: the layer
    // rebuilds its DOM on every moveend/resize, and taking the screenshots
    // just now scrolled the map, which is one.
    if (scene.key === 'canada' && backdrop.key === 'plume') {
      await page.evaluate(() => {
        const icons = [...document.querySelectorAll('.fire-icon')];
        icons
          .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
          ?.click();
      });
      await new Promise((r) => setTimeout(r, 400));
      popupText = await page.evaluate(
        () => document.querySelector('.fire-popup .leaflet-popup-content')?.innerText,
      );
      await (await page.$('.smoke-map')).screenshot({ path: `${OUT}/fires-${TAG}-popup.png` });
    }

    rows.push({ scene, backdrop, ...measured, probe });
    await page.close();
  }
}


await browser.close();

// -------------------------------------------------------------- the readback
const pad = (s, w) => String(s).padEnd(w);
console.log(`\nSMOKESHOW fire layer verify — tag "${TAG}", ${BASE}`);
console.log('  tiles and FIRMS detections are STUBBED (see header)');
console.log(`  fires.json: ${FIRES.counts.clustersKept} clusters from ${FIRES.counts.kept} detections\n`);

console.log(
  pad('scene', 26) + pad('backdrop', 14) + pad('icons', 8) + pad('px', 10) + pad('labels', 8) + 'opacity',
);
console.log('-'.repeat(78));
for (const r of rows) {
  console.log(
    pad(r.scene.name, 26) +
      pad(r.backdrop.name, 14) +
      pad(r.icons, 8) +
      pad(`${r.minPx}-${r.maxPx}`, 10) +
      pad(r.labelled, 8) +
      (r.opacity ?? '—'),
  );
}

console.log(`\nicon legibility, measured off the rendered pixels:`);
console.log(
  '\n' +
    pad('scene', 26) +
    pad('backdrop', 14) +
    pad('behind icon', 18) +
    pad('darkest tone', 24) +
    pad('brightest tone', 24) +
    'best',
);
console.log('-'.repeat(114));
let worst = Infinity;
// A scene we could not sample is a scene we did not verify. Collect them and
// fail on them: the earlier version `continue`d past these, left `worst` at
// Infinity, and reported PASS over zero measurements — a check that could not
// fail, which is worse than no check at all.
const unmeasured = [];
for (const r of rows) {
  if (!r.probe?.backdrop) {
    unmeasured.push({
      scene: r.scene.name,
      backdrop: r.backdrop.name,
      why:
        r.icons === 0
          ? 'no icons rendered'
          : !r.probe
            ? `none of the ${r.icons} icons sat clear of the map edge (MARGIN=${ICON_EDGE_MARGIN}px)`
            : 'icon found, but no backdrop pixels outside its bloom radius',
    });
    continue;
  }
  const bg = r.probe.backdrop;
  const cd = contrast(r.probe.dark, bg);
  const cb = contrast(r.probe.bright, bg);
  const best = Math.max(cd, cb);
  worst = Math.min(worst, best);
  const fmt = (c, v) => `rgb(${c.map(Math.round).join(',')}) ${v.toFixed(1)}:1`;
  console.log(
    pad(r.scene.name, 26) +
      pad(r.backdrop.name, 14) +
      pad(`rgb(${bg.map(Math.round).join(',')})`, 18) +
      pad(fmt(r.probe.dark, cd), 24) +
      pad(fmt(r.probe.bright, cb), 24) +
      `${best.toFixed(1)}:1`,
  );
}

console.log(`\nlayer stack (z-index, read from the DOM):`);
console.log(`  smoke overlay pane   ${rows[0].smokeZ}`);
console.log(`  labels pane          ${rows[0].labelsZ ?? '(absent)'}`);
console.log(`  hotspots pane        ${rows[0].hotspotsZ ?? '(absent)'}`);
console.log(`  marker pane          ${rows[0].markerZ}`);
console.log(`\nlegend: ${rows[0].legend ?? '(none)'}`);
if (popupText) console.log(`\ntap copy:\n${popupText.split('\n').map((l) => '  ' + l).join('\n')}`);

writeFileSync(
  `${OUT}/fires-${TAG}.json`,
  JSON.stringify({ tag: TAG, base: BASE, counts: FIRES.counts, rows, popupText }, null, 2),
);
console.log(`\ncaptures: ${OUT}/fires-${TAG}-<scene>-<backdrop>.png\n`);

// The whole design claim in one number: on every backdrop, at least one of the
// two rings clears 3:1 against what is actually behind the icon.
const PASS = 3.0;
const measured = rows.length - unmeasured.length;

if (unmeasured.length) {
  console.log(`\ncould not measure ${unmeasured.length} of ${rows.length} scene/backdrop pairs:`);
  for (const u of unmeasured) console.log(`  ${u.scene} · ${u.backdrop} — ${u.why}`);
}

if (measured === 0) {
  console.log(`\nFAIL — nothing was measured. ${rows.length} pairs captured, 0 sampled.`);
  process.exit(1);
}
if (unmeasured.length) {
  console.log(
    `\nFAIL — ${measured}/${rows.length} pairs measured (worst ${worst.toFixed(1)}:1). ` +
      `Every pair must be measurable; an unsampled backdrop is an unverified one.`,
  );
  process.exit(1);
}
console.log(
  worst >= PASS
    ? `PASS — worst-case ${worst.toFixed(1)}:1 across all ${measured} pairs`
    : `FAIL — worst-case ${worst.toFixed(1)}:1`,
);
process.exit(worst >= PASS ? 0 : 1);
