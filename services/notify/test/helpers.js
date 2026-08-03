import { buildForecastPayload } from '../../../src/lib/forecast.js';
import { cellCoords, cellKeyFor } from '../src/cells.js';
import { buildDeviceRecord } from '../src/store.js';

// Test doubles for the two things this service talks to: `/api/forecast` and
// the push providers.
//
// The forecast mock runs the *real* payload builder from src/lib/forecast.js
// over a synthetic PM2.5 series rather than hand-writing JSON. A hand-written
// mock drifts from the contract silently; this one cannot, because it is the
// same code the endpoint runs (contract §10: "Deriving these from the schema
// keeps the mock honest. Deriving them by hand from this prose does not.").

export const DENVER = cellKeyFor(39.7392, -104.9903);
export const HOUR_MS = 3600_000;

const hourFloor = (ms) => Math.floor(ms / HOUR_MS) * HOUR_MS;

export function mockForecast({
  cellKey = DENVER,
  series,
  nowMs,
  pastHours = 72,
  timezone = 'America/Denver',
  utcOffsetSeconds = -6 * 3600,
}) {
  const { lat, lon } = cellCoords(cellKey);
  const startUTC = hourFloor(nowMs) - pastHours * HOUR_MS;
  // Open-Meteo returns local wall-clock strings with no zone; the payload
  // builder converts them back with utc_offset_seconds.
  const time = series.map((_, i) =>
    new Date(startUTC + i * HOUR_MS + utcOffsetSeconds * 1000).toISOString().slice(0, 16),
  );
  return buildForecastPayload({
    raw: { hourly: { time, pm2_5: series }, utc_offset_seconds: utcOffsetSeconds, timezone },
    requested: { lat, lon },
    snapped: { lat, lon },
    requestedSource: 'model',
    nowMs,
  });
}

// A 192-hour series (3 past days + 5 forecast days) held at `value`.
export const flat = (value, length = 192) => new Array(length).fill(value);

// Past hours at `before`, everything from `now` forward at `after`.
export function step(before, after, { pastHours = 72, length = 192 } = {}) {
  return Array.from({ length }, (_, i) => (i < pastHours ? before : after));
}

export function fakeDispatcher({ results = [] } = {}) {
  const sent = [];
  let call = 0;
  return {
    sent,
    async deliver({ device, message }) {
      sent.push({ deviceId: device.id, platform: device.platform, message });
      return results[call++] ?? { delivered: true };
    },
    close() {},
  };
}

export async function seedDevice(store, {
  id,
  platform = 'ios',
  cellKey = DENVER,
  lat,
  lon,
  label = 'Home',
  threshold = 2,
  quietHours = { enabled: false, startHour: 22, endHour: 7 },
  sensitiveHousehold = false,
  timezone = 'America/Denver',
  entitled = true,
  expiresAtMs = null,
  nowMs = Date.now(),
}) {
  const coords = cellCoords(cellKey);
  const record = buildDeviceRecord({
    id,
    secret: `secret-${id}`,
    platform,
    pushToken: `token-${id}`,
    timezone,
    locations: [{ label, lat: lat ?? coords.lat, lon: lon ?? coords.lon, cellKey, threshold: null }],
    threshold,
    quietHours,
    sensitiveHousehold,
    nowMs,
  });
  await store.registerDevice(record);
  if (entitled) {
    await store.upsertEntitlement(record.appUserId, {
      active: true,
      revoked: false,
      expiresAtMs: expiresAtMs ?? nowMs + 30 * 24 * HOUR_MS,
    });
  }
  return record;
}
