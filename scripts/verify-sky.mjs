// Visual + measured check of the sky/ink system in a real browser.
//
// Open-Meteo is stubbed with a synthesised PM2.5 series so the sweep is
// reproducible and runs without network: `--pm=<n>` pins the whole series to
// one concentration, so a run per rating level covers the five levels, and
// scrubbing the timeline walks the sun through a day and a half.
//
// For each stop it reports the ink the page chose, the scrim it raised, and
// the contrast between the type and the pixel actually painted behind it —
// read back off the composited page, not recomputed.
//
// Run:  npx vite --port 5173 &  node scripts/verify-sky.mjs --pm=45
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { ugm3ToAqi } from '../src/lib/aqi.js';

const CHROME =
  process.env.CHROME_PATH ||
  ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(Boolean);
const OUT = process.env.SCRATCH || 'scratch';
const PM = Number(process.argv.find((a) => a.startsWith('--pm='))?.slice(5) ?? 45);
const BASE = process.env.BASE_URL || 'http://localhost:5173';

mkdirSync(OUT, { recursive: true });

const HOURS = 24 * 3 + 24; // past_days=3 + forecast, matching lib/openMeteo.js
function series() {
  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  start.setUTCHours(start.getUTCHours() - 72);
  const time = [];
  for (let i = 0; i < HOURS; i++) {
    const d = new Date(start.getTime() + i * 3_600_000);
    time.push(d.toISOString().slice(0, 16));
  }
  return { time, pm2_5: time.map(() => PM) };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });

await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  // The stubs stand in for cross-origin hosts, so they have to carry CORS
  // headers of their own or the page rejects them exactly like the real ones.
  const json = (body) =>
    req.respond({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });
  if (url.includes('air-quality')) {
    const n = (new URL(url).searchParams.get('latitude') || '').split(',').length;
    const one = { hourly: series() };
    return json(n > 1 ? Array.from({ length: n }, () => one) : one);
  }
  if (url.includes('geocoding-api')) return json({ results: [{ name: 'Minneapolis' }] });
  if (url.includes('/api/sensors')) return json({});
  if (url.includes('/hrrr/')) return req.respond({ status: 404, body: '' });
  return req.continue();
});

const errors = [];
// The HRRR feed and Vercel analytics are third-party and offline here; they
// are additive by design, so their failures are not what this script watches.
const EXPECTED_OFFLINE = /hrrr|vercel-scripts|ERR_TUNNEL|Failed to load resource: net::ERR_FAILED/;
const noteError = (text) => !EXPECTED_OFFLINE.test(text) && errors.push(text);
page.on('pageerror', (e) => noteError(String(e)));
page.on('console', (m) => m.type() === 'error' && noteError(m.text()));

// mockOfficial has to be passed explicitly: sensors.js reads it with
// Number(params.get(...)), and an absent param comes back as 0 — which is
// finite, so the dev mock always fires and anchors the verdict to AQI 0.
// Pinning it to the stubbed model's own AQI makes applySensorAnchor a no-op,
// so the sky shows exactly --pm.
await page.goto(
  `${BASE}/?lat=44.98&lon=-93.27&name=Minneapolis&mockOfficial=${ugm3ToAqi(PM)}`,
  { waitUntil: 'networkidle2' },
);
await page.waitForSelector('.rating-chip', { timeout: 30000 });
await new Promise((r) => setTimeout(r, 800)); // effects + the sky crossfade

// Read what the page actually painted: the ink it is using, and the pixel
// behind a given element, sampled from a screenshot of the sky layer alone.
const probe = async (label) => {
  const state = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const el = document.querySelector('.app-header__wordmark');
    const r = el.getBoundingClientRect();
    return {
      dark: document.documentElement.classList.contains('dark-air'),
      ink: cs.getPropertyValue('--ink').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
      scrim: ['--scrim-zen', '--scrim-mid', '--scrim-hor'].map((k) =>
        cs.getPropertyValue(k).trim(),
      ),
      sky: ['--sky-zen', '--sky-mid', '--sky-hor'].map((k) => cs.getPropertyValue(k).trim()),
      color: getComputedStyle(el).color,
      probe: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
      time: document.querySelector('.rating-chip__time')?.textContent ?? '',
    };
  });
  await page.screenshot({ path: `${OUT}/sky-pm${PM}-${label}.png` });
  return state;
};

const stops = [];
stops.push({ label: 'now', ...(await probe('now')) });

// Walk the timeline: the scrubber's range covers -12h to +48h, so a handful
// of positions sweeps two full solar days.
const slider = await page.$('.scrubber input[type=range], input[type=range]');
if (slider) {
  const range = await page.evaluate((el) => ({ min: +el.min, max: +el.max }), slider);
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const v = Math.round(range.min + (range.max - range.min) * f);
    await page.evaluate(
      (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        ).set;
        setter.call(el, String(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      slider,
      v,
    );
    await new Promise((r) => setTimeout(r, 500)); // let the crossfade land
    stops.push({ label: `t${f}`, ...(await probe(`t${f}`)) });
  }
}

console.log(JSON.stringify({ pm: PM, errors, stops }, null, 2));
await browser.close();
