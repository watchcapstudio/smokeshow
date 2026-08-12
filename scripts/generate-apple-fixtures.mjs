// Generates apple/Sources/SmokeshowKit/Resources/Fixtures/*.json — the mock /api/forecast payloads the Apple
// clients are built and tested against (contract §10).
//
// They are produced by running synthetic upstream series through the *real*
// payload builder (src/lib/forecast.js), not by hand-writing JSON from the
// prose. That means the scale copy, the verdict maths, the 6-hour hold, the
// sky, and the day strip in every fixture are the ones the endpoint will
// actually serve — a Swift decoder that passes here passes in production.
//
// Every fixture is validated against design/forecast-api-v1.schema.json before
// it is written, so a drifting fixture fails the script rather than the app.
//
// Run: npm run fixtures:apple
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { buildForecastPayload } from '../src/lib/forecast.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Inside the target's own directory: SwiftPM only bundles resources that live
// under the target path, and the widget extension needs them at runtime for
// previews and for the mock endpoint mode.
const outDir = path.join(root, 'apple/Sources/SmokeshowKit/Resources/Fixtures');
const schema = JSON.parse(
  readFileSync(path.join(root, 'design/forecast-api-v1.schema.json'), 'utf8'),
);

// A fixed instant so fixtures are byte-stable across runs: 2026-08-02T17:03:11Z.
const NOW_MS = Date.UTC(2026, 7, 2, 17, 3, 11);
const TZ = 'America/Chicago';
const UTC_OFFSET = -5 * 3600; // CDT, in effect at NOW_MS
const REQUESTED = { lat: 44.9778, lon: -93.265 };
const SNAPPED = { lat: 45.0, lon: -93.3 };

const PAST_HOURS = 3 * 24;
const TOTAL_HOURS = 8 * 24; // past_days=3 + forecast_days=5

const pad = (n) => String(n).padStart(2, '0');

/** Open-Meteo local wall-clock stamps: 'YYYY-MM-DDTHH:00', no zone. */
function localTimes(count) {
  // The series starts at local midnight of (today − 3 days).
  const firstMs = NOW_MS + UTC_OFFSET * 1000;
  const d = new Date(firstMs);
  const startMs =
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - PAST_HOURS * 3600 * 1000;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = new Date(startMs + i * 3600 * 1000);
    out.push(
      `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:00`,
    );
  }
  return out;
}

// nowIndex for the full-length series: local midnight three days back to 17:00Z.
const NOW_INDEX = PAST_HOURS + 12;

const diurnal = (i) => 1 + 0.16 * Math.sin(((i % 24) - 4) * (Math.PI / 12));

/** Series shapes. `h` is hours relative to now (negative = past). */
const SHAPES = {
  clear: (h, i) => 5.5 * diurnal(i) + (h > 0 ? 0.6 : 0),
  clearing: (h, i) => {
    const base = 7;
    const peak = 78;
    const amp = h < 0 ? peak * Math.exp(-Math.pow(h + 6, 2) / 900) : peak * Math.exp(-h / 9);
    return (base + amp) * diurnal(i);
  },
  stuck: (h, i) => (86 + 22 * Math.sin(h / 7)) * diurnal(i),
  arriving: (h, i) => {
    const rise = h < 14 ? 0 : Math.min(1, (h - 14) / 10);
    return (8 + 62 * rise) * diurnal(i);
  },
};

function series(shape, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(Number(SHAPES[shape](i - NOW_INDEX, i).toFixed(1)));
  return out;
}

function raw(shape, { count = TOTAL_HOURS, gaps = null } = {}) {
  const pm = series(shape, count);
  if (gaps) for (let i = gaps[0]; i < gaps[1]; i += 1) pm[i] = null;
  return {
    timezone: TZ,
    utc_offset_seconds: UTC_OFFSET,
    hourly: { time: localTimes(count), pm2_5: pm },
  };
}

const SENSORS_CLOSE = {
  official: {
    ug: 44.4,
    count: 6,
    area: 'Minneapolis',
    distanceMi: 38,
    observedAt: '2026-08-02T16:00',
  },
  local: { ug: 51.0, count: 27, medianDistanceMi: 8 },
};

const SENSORS_APART = {
  official: {
    ug: 26.0,
    count: 4,
    area: 'Minneapolis',
    distanceMi: 41,
    observedAt: '2026-08-02T16:00',
  },
  local: { ug: 58.5, count: 31, medianDistanceMi: 6 },
};

/**
 * Each fixture is a case from contract §10. `note` is written into the Swift
 * mock catalogue so the reason a fixture exists travels with it.
 */
const FIXTURES = [
  {
    name: 'clear-staying-clear',
    note: 'verdict.above=false, every index null, headline "Clear as far as the forecast goes".',
    build: () =>
      buildForecastPayload({
        raw: raw('clear'),
        requested: REQUESTED,
        snapped: SNAPPED,
        measured: { official: { ug: 5.2, count: 5, area: 'Minneapolis', distanceMi: 38 } },
        requestedSource: 'official',
        nowMs: NOW_MS,
      }),
  },
  {
    name: 'smoke-now-clearing',
    note: 'The headline case: above=true with a sustained clear inside the window.',
    build: () =>
      buildForecastPayload({
        raw: raw('clearing'),
        requested: REQUESTED,
        snapped: SNAPPED,
        measured: SENSORS_CLOSE,
        requestedSource: 'official',
        nowMs: NOW_MS,
      }),
  },
  {
    name: 'smoke-never-clears',
    note: 'above=true, all clear fields null, headline "No clear air as far as the forecast goes".',
    build: () =>
      buildForecastPayload({
        raw: raw('stuck'),
        requested: REQUESTED,
        snapped: SNAPPED,
        measured: SENSORS_CLOSE,
        requestedSource: 'official',
        nowMs: NOW_MS,
      }),
  },
  {
    name: 'clean-smoke-arriving',
    note: 'above=false with arrivalIndex set — the countdown accessory runs the other way.',
    build: () =>
      buildForecastPayload({
        raw: raw('arriving'),
        requested: REQUESTED,
        snapped: SNAPPED,
        measured: { official: { ug: 9.1, count: 6, area: 'Minneapolis', distanceMi: 38 } },
        requestedSource: 'official',
        nowMs: NOW_MS,
      }),
  },
  {
    name: 'no-sensors',
    note: 'measured.official and measured.local both null, anchor.source "model", offsetUg 0.',
    build: () =>
      buildForecastPayload({
        raw: raw('clearing'),
        requested: REQUESTED,
        snapped: SNAPPED,
        measured: null,
        requestedSource: 'official',
        nowMs: NOW_MS,
      }),
  },
  {
    name: 'sensors-diverge',
    note: 'Official and local far apart — the case the explainer copy exists to justify.',
    build: () =>
      buildForecastPayload({
        raw: raw('clearing'),
        requested: REQUESTED,
        snapped: SNAPPED,
        measured: SENSORS_APART,
        requestedSource: 'official',
        nowMs: NOW_MS,
      }),
  },
  {
    name: 'model-gaps',
    note: 'A run of null pm25 mid-array. Nothing may render 0 µg/m³ for these hours.',
    build: () =>
      buildForecastPayload({
        raw: raw('clearing', { gaps: [NOW_INDEX + 9, NOW_INDEX + 16] }),
        requested: REQUESTED,
        snapped: SNAPPED,
        measured: SENSORS_CLOSE,
        requestedSource: 'official',
        nowMs: NOW_MS,
      }),
  },
  {
    name: 'short-window',
    note: 'hours.length well under 192 and days.length of 3 — never hardcode the window.',
    build: () =>
      buildForecastPayload({
        raw: raw('clearing', { count: PAST_HOURS + 36 }),
        requested: REQUESTED,
        snapped: SNAPPED,
        measured: SENSORS_CLOSE,
        requestedSource: 'official',
        nowMs: NOW_MS,
      }),
  },
];

const ERROR_FIXTURES = [
  {
    name: 'error-upstream-failed',
    note: '502 envelope. Clients fall back to cache or an explicit unavailable state.',
    payload: {
      v: 1,
      error: { code: 'upstream-failed', message: 'air quality upstream returned 503' },
    },
  },
  {
    name: 'error-bad-coords',
    note: '400 envelope.',
    payload: { v: 1, error: { code: 'bad-coords', message: 'lat and lon must be finite numbers' } },
  },
];

const Ajv = Ajv2020.default ?? Ajv2020;
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const fixture of [
  ...FIXTURES.map((f) => ({ ...f, payload: f.build() })),
  ...ERROR_FIXTURES,
]) {
  const { name, note, payload } = fixture;
  if (!validate(payload)) {
    console.error(`✗ ${name} does not match the contract schema:`);
    console.error(ajv.errorsText(validate.errors, { separator: '\n  ' }));
    process.exit(1);
  }
  writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  const summary = payload.error
    ? `error ${payload.error.code}`
    : `${payload.hours.length}h · ${payload.verdict.headline}`;
  manifest.push({ name, note, summary });
  console.log(`✓ ${name.padEnd(24)} ${summary}`);
}

writeFileSync(
  path.join(outDir, 'manifest.json'),
  `${JSON.stringify({ generatedFrom: 'scripts/generate-apple-fixtures.mjs', nowMs: NOW_MS, fixtures: manifest }, null, 2)}\n`,
);
console.log(`\n${manifest.length} fixtures written to apple/Sources/SmokeshowKit/Resources/Fixtures/`);
