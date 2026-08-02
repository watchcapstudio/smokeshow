import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

import handler from '../../api/forecast.js';
import { fetchServerForecast, isForecastPayload, adaptForecast } from './forecastApi.js';

// The edge function and the browser client, exercised end to end against a
// stubbed network. Between them they cover the two ways this can go wrong in
// production: the endpoint emitting a shape the contract forbids, and the
// client failing to notice that it did.

const TZ = 'America/Chicago';
const OFFSET = -5 * 3600;
const START_UTC = Date.parse('2026-08-01T00:00:00Z');
const HOURS = 192;
const ORIGIN = 'https://smokeshow.earth';

const naive = (ms) => new Date(ms).toISOString().slice(0, 16);

function openMeteoBody({ hours = HOURS, value = 60 } = {}) {
  return {
    latitude: 45,
    longitude: -93.3,
    utc_offset_seconds: OFFSET,
    timezone: TZ,
    hourly: {
      time: Array.from({ length: hours }, (_, i) =>
        naive(START_UTC + i * 3_600_000 + OFFSET * 1000),
      ),
      // smoky for the first three days, then a sustained clear
      pm2_5: Array.from({ length: hours }, (_, i) => (i < 96 ? value : 4)),
    },
  };
}

const SENSORS_BODY = {
  official: { ug: 66.1, aqi: 156, count: 4, area: 'Minneapolis', distanceMi: 22, observedAt: '2026-08-03T19:00' },
  local: { ug: 78.9, aqi: 164, count: 19, medianDistanceMi: 6 },
};

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

// --- network stub ----------------------------------------------------------
let seenUrls;
let routes;
const realFetch = globalThis.fetch;

beforeEach(() => {
  seenUrls = [];
  routes = {
    aq: () => json(openMeteoBody()),
    sensors: () => json(SENSORS_BODY),
    forecast: null, // set by the client-side tests
  };
  globalThis.fetch = async (input) => {
    const url = String(input instanceof URL ? input : (input?.url ?? input));
    seenUrls.push(url);
    if (url.includes('/api/aq')) return routes.aq();
    if (url.includes('/api/sensors')) return routes.sensors();
    if (url.includes('/api/forecast')) {
      // Relative URLs from the browser client — run the real handler.
      return routes.forecast
        ? routes.forecast(url)
        : handler({ url: new URL(url, ORIGIN).toString() });
    }
    throw new Error(`unstubbed fetch: ${url}`);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const call = (query) => handler({ url: `${ORIGIN}/api/forecast${query}` });
const urlFor = (fragment) => seenUrls.find((u) => u.includes(fragment));

let validate;
beforeAll(() => {
  const schema = JSON.parse(
    readFileSync(new URL('../../design/forecast-api-v1.schema.json', import.meta.url), 'utf8'),
  );
  const Ajv = Ajv2020.default ?? Ajv2020;
  validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
});

// --- the edge function -----------------------------------------------------
describe('GET /api/forecast', () => {
  it('serves a conforming payload and says how long it may be cached', async () => {
    const res = await call('?lat=44.9778&lon=-93.265');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toContain('s-maxage=600');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');

    const body = await res.json();
    if (!validate(body)) {
      throw new Error(validate.errors.map((e) => `${e.instancePath} ${e.message}`).join('\n'));
    }
    expect(body.v).toBe(1);
    expect(body.verdict.headline).toMatch(/^Clears /);
  });

  it('snaps coordinates and routes Open-Meteo through /api/aq, never directly', async () => {
    await call('?lat=44.9778&lon=-93.265');
    const aq = urlFor('/api/aq');
    expect(aq).toContain('latitude=45&longitude=-93.3');
    expect(aq).toContain('timezone=auto');
    expect(seenUrls.some((u) => u.includes('air-quality-api.open-meteo.com'))).toBe(false);
  });

  it('reuses the /api/sensors proxy for the keyed measured feeds', async () => {
    const res = await call('?lat=44.9778&lon=-93.265');
    const body = await res.json();
    expect(urlFor('/api/sensors')).toContain('lat=45&lon=-93.3');
    expect(body.measured.official.ug).toBe(66.1);
    expect(body.measured.anchor.source).toBe('official');
  });

  it('honours ?source and reports what it actually applied', async () => {
    const body = await (await call('?lat=44.9778&lon=-93.265&source=local')).json();
    expect(body.source).toMatchObject({ requested: 'local', applied: 'local' });
    expect(body.hours[body.now.index].pm25).toBe(78.9);
  });

  it('is model-only, not broken, when the sensor proxy has nothing', async () => {
    routes.sensors = () => json({ measured: null, reason: 'no-sensors-nearby' });
    const body = await (await call('?lat=44.9778&lon=-93.265')).json();
    expect(body.measured.official).toBeNull();
    expect(body.measured.anchor.source).toBe('model');
    expect(validate(body)).toBe(true);
  });

  it('is model-only when the sensor proxy fails outright', async () => {
    routes.sensors = () => {
      throw new Error('network');
    };
    const res = await call('?lat=44.9778&lon=-93.265');
    expect(res.status).toBe(200);
    expect((await res.json()).measured.anchor.source).toBe('model');
  });

  it.each([
    ['?lat=&lon=', 'missing'],
    ['?lat=abc&lon=-93.3', 'unparseable'],
    ['?lat=91&lon=-93.3', 'out of range'],
    ['?lat=45&lon=200', 'out of range longitude'],
  ])('rejects %s coordinates with the error envelope', async (query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({ v: 1, error: { code: 'bad-coords', message: expect.any(String) } });
    expect(validate(body)).toBe(true);
  });

  it('reports an upstream failure as 502 rather than a half-built forecast', async () => {
    routes.aq = () => json({ error: true }, { status: 503 });
    const res = await call('?lat=44.9778&lon=-93.265');
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('upstream-failed');
  });

  it('reports an empty series as 502 no-series', async () => {
    routes.aq = () => json({ timezone: TZ, utc_offset_seconds: 0, hourly: {} });
    const res = await call('?lat=44.9778&lon=-93.265');
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('no-series');
  });

  it('turns an unreachable upstream into a decodable envelope, not an HTML page', async () => {
    routes.aq = () => {
      throw new Error('connect ECONNREFUSED');
    };
    const res = await call('?lat=44.9778&lon=-93.265');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('internal');
    expect(validate(body)).toBe(true);
  });
});

// --- the browser client ----------------------------------------------------
describe('fetchServerForecast — degrade, never crash', () => {
  it('adapts a good payload into the shapes the components already speak', async () => {
    const f = await fetchServerForecast(44.9778, -93.265);
    expect(f).not.toBeNull();
    expect(f.timezone).toBe(TZ);
    // naive-UTC strings: every component parses `t + 'Z'`
    expect(f.timesUTC[0]).toBe('2026-08-01T00:00');
    expect(f.timesUTC).toHaveLength(f.pm25.length);
    // computeVerdict()'s field names, which TrendChip and AppWidgetCTA read
    expect(f.verdict).toEqual({
      above: expect.any(Boolean),
      clearIdx: expect.any(Number),
      arrivalIdx: null,
      peakIdx: expect.any(Number),
      trend: 'clearing',
      nowLevelIndex: expect.any(Number),
    });
    // buildDaySummaries()'s shape, which ShareButton draws from
    expect(f.days[0].level.key).toBeTypeOf('string');
    expect(f.days[0].level.name).toBeTypeOf('string');
    expect(f.days[0]).toHaveProperty('max');
    // fetchSensorsNear()'s shape, which RatingChip's toggle reads
    expect(f.measured.official.ug).toBe(66.1);
  });

  it('passes the requested source through and reports it back', async () => {
    const f = await fetchServerForecast(44.9778, -93.265, { source: 'local' });
    expect(urlFor('/api/forecast')).toContain('source=local');
    expect(f.requestedSource).toBe('local');
    expect(f.appliedSource).toBe('local');
  });

  it.each([
    ['a 502', () => json({ v: 1, error: { code: 'upstream-failed', message: 'x' } }, { status: 502 })],
    ['a 404 from a dev server', () => new Response('Not found', { status: 404 })],
    ['an HTML body', () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['a future contract version', () => json({ v: 2, hours: [], now: { index: 0 } })],
    ['a truncated payload', () => json({ v: 1, hours: [{ t: 'x' }] })],
    ['nowIndex past the end', () => json({ v: 1, hours: [{ t: 'x' }], now: { index: 9 }, verdict: { headline: 'x' }, days: [], pastDays: [], measured: { anchor: {} }, location: { timezone: 'UTC' } })],
    ['a network error', () => { throw new Error('offline'); }],
  ])('returns null for %s so the client-side path takes over', async (_name, route) => {
    routes.forecast = route;
    expect(await fetchServerForecast(44.9778, -93.265)).toBeNull();
  });
});

describe('isForecastPayload', () => {
  it('accepts what the endpoint actually emits', async () => {
    const body = await (await call('?lat=44.9778&lon=-93.265')).json();
    expect(isForecastPayload(body)).toBe(true);
    expect(adaptForecast(body).headline).toBe(body.verdict.headline);
  });

  it('rejects an error envelope even though its version matches', () => {
    expect(isForecastPayload({ v: 1, error: { code: 'internal', message: 'x' } })).toBe(false);
  });
});
