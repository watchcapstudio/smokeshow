#!/usr/bin/env node
import { createMemoryStore, buildDeviceRecord } from '../src/store.js';
import { runEvaluation } from '../src/evaluate.js';
import { buildForecastPayload } from '../../../src/lib/forecast.js';
import { cellCoords, cellKeyFor } from '../src/cells.js';
import { cellStateFrom } from '../src/events.js';

// Measures the two numbers the load estimate rests on: how long one cell's
// fetch-diff-decide costs, and how fast fan-out runs once a cell has changed.
// Everything else in docs/smokeshow-notify-backend.md §Load is arithmetic on
// top of these.
//
//   node services/notify/bin/loadcheck.js [subscribers] [cells]
//
// The push dispatcher is stubbed: delivery is APNs/FCM's problem and is free.
// What is being measured is our own compute, which is the part that scales
// with signups.

const subscribers = Number(process.argv[2] ?? 10_000);
const cellCount = Number(process.argv[3] ?? 1);
const HOUR_MS = 3600_000;
const NOW = Date.UTC(2026, 7, 2, 18, 0, 0);
const PAST_HOURS = 72;
const LENGTH = 192;

// A spread of real cells, so the store is exercised with the key distribution
// it would actually see rather than one hot key.
const cells = Array.from({ length: cellCount }, (_, i) =>
  cellKeyFor(30 + (i % 180) * 0.1, -120 + Math.floor(i / 180) * 0.1),
);

function payloadFor(cellKey, after) {
  const { lat, lon } = cellCoords(cellKey);
  const series = Array.from({ length: LENGTH }, (_, i) => (i < PAST_HOURS ? 4 : after));
  const start = Math.floor(NOW / HOUR_MS) * HOUR_MS - PAST_HOURS * HOUR_MS;
  const time = series.map((_, i) => new Date(start + i * HOUR_MS - 6 * 3600_000).toISOString().slice(0, 16));
  return buildForecastPayload({
    raw: { hourly: { time, pm2_5: series }, utc_offset_seconds: -6 * 3600, timezone: 'America/Denver' },
    requested: { lat, lon },
    snapped: { lat, lon },
    requestedSource: 'model',
    nowMs: NOW,
  });
}

const store = createMemoryStore({ now: () => NOW });
let delivered = 0;
const dispatcher = {
  async deliver() {
    delivered++;
    return { delivered: true };
  },
  close() {},
};

for (let i = 0; i < subscribers; i++) {
  const cellKey = cells[i % cells.length];
  const { lat, lon } = cellCoords(cellKey);
  const record = buildDeviceRecord({
    id: `dev-${i}`,
    secret: 'x',
    platform: i % 2 ? 'ios' : 'android',
    pushToken: `tok-${i}`,
    timezone: 'America/Denver',
    quietHours: { enabled: false, startHour: 22, endHour: 7 },
    locations: [{ label: 'Home', lat, lon, cellKey, threshold: null }],
    nowMs: NOW,
  });
  await store.registerDevice(record);
  await store.upsertEntitlement(record.appUserId, { active: true, expiresAtMs: NOW + 30 * 24 * HOUR_MS });
}

// Two payload bodies, built once, outside every timer. Building a mock
// forecast is expensive (192 hours of solar maths per cell) and it is not a
// cost this service pays — in production the payload arrives over the wire.
// What the service does pay is the JSON parse plus the diff, so the fetch stub
// returns a fresh parse of a fixed body.
const BODIES = {
  clear: JSON.stringify(payloadFor(cells[0], 4)),
  smoky: JSON.stringify(payloadFor(cells[0], 60)),
};

let mode = 'clear';
const fetchForecast = async () => JSON.parse(BODIES[mode]);

const bytes = Buffer.byteLength(BODIES.clear);
// What the service actually consumes out of that payload. The gap between the
// two is the bandwidth a slim `/api/forecast` mode would save (see the load
// estimate in docs/smokeshow-notify-backend.md).
const stateBytes = Buffer.byteLength(JSON.stringify(cellStateFrom(JSON.parse(BODIES.clear))));

const seedStart = performance.now();
const seed = await runEvaluation({ store, dispatcher, fetchForecast, nowMs: NOW, concurrency: 8 });
const seedMs = performance.now() - seedStart;

mode = 'smoky'; // every cell crosses a threshold at once — the worst hour of the year
const changeStart = performance.now();
const changed = await runEvaluation({ store, dispatcher, fetchForecast, nowMs: NOW, concurrency: 8 });
const changeMs = performance.now() - changeStart;

const quietStart = performance.now();
const quiet = await runEvaluation({ store, dispatcher, fetchForecast, nowMs: NOW, concurrency: 8 });
const quietMs = performance.now() - quietStart;

const fmt = (n) => n.toLocaleString('en-US');
console.log(`subscribers        ${fmt(subscribers)}`);
console.log(`occupied cells     ${fmt(seed.cells)}`);
console.log(`payload bytes/cell ${fmt(bytes)}  (state kept: ${fmt(stateBytes)})`);
console.log('');
console.log(`seed run           ${seedMs.toFixed(0)} ms   (${(seedMs / seed.cells).toFixed(2)} ms/cell)`);
console.log(`change run         ${changeMs.toFixed(0)} ms   (${fmt(changed.sent)} notifications)`);
console.log(`steady-state run   ${quietMs.toFixed(0)} ms   (${fmt(quiet.unchanged)} cells unchanged, ${quiet.sent} sent)`);
console.log('');
console.log(`upstream fetches   ${fmt(seed.cells)} per hour = ${fmt(seed.cells * 720)} per 30-day month`);
console.log(`deliveries sent    ${fmt(delivered)}`);
