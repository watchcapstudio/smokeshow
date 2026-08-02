import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

import { buildForecastPayload, normalizeSource, upstreamPath, ForecastError } from './forecast.js';
import { findNowIndex } from './openMeteo.js';
import { applySensorAnchor } from './sensors.js';
import { computeVerdict, verdictHeadline } from './verdict.js';
import { buildDaySummaries } from './days.js';
import { formatVerdictTime } from './time.js';

// --- fixture ---------------------------------------------------------------
// A location whose zone is emphatically not UTC, so any place the code
// accidentally formats in UTC shows up as a wrong weekday rather than a
// coincidence. August in Chicago is CDT, UTC-5.
const TZ = 'America/Chicago';
const OFFSET = -5 * 3600;
const START_UTC = Date.parse('2026-08-01T00:00:00Z');
const HOURS = 192; // past_days=3 + forecast_days=5
const NOW_INDEX = 72;
const NOW_MS = START_UTC + NOW_INDEX * 3_600_000 + 20 * 60_000; // 20 min into the hour
const REQUESTED = { lat: 44.9778, lon: -93.265 };
const SNAPPED = { lat: 45.0, lon: -93.3 };

const naive = (ms) => new Date(ms).toISOString().slice(0, 16);
const hourMs = (i) => START_UTC + i * 3_600_000;
const timesUTC = (n = HOURS) => Array.from({ length: n }, (_, i) => naive(hourMs(i)));
const timesLocal = (n = HOURS) =>
  Array.from({ length: n }, (_, i) => naive(hourMs(i) + OFFSET * 1000));

function raw(pm25, n = HOURS) {
  return {
    utc_offset_seconds: OFFSET,
    timezone: TZ,
    hourly: { time: timesLocal(n), pm2_5: pm25.slice(0, n) },
  };
}

// `spans` are [fromHour, toHour, value] relative to NOW_INDEX.
function series(base, spans = []) {
  const out = new Array(HOURS).fill(base);
  for (const [from, to, value] of spans) {
    for (let i = NOW_INDEX + from; i < Math.min(HOURS, NOW_INDEX + to); i++) out[i] = value;
  }
  return out;
}

const CLEARING = series(60, [[8, 999, 5]]); // smoky now, sustained clear at +8h
const STUCK = series(60); // smoky the whole window
const ARRIVING = series(4, [[10, 999, 70]]); // clean now, smoke lands at +10h
const CLEAR = series(3); // nothing all week

const OFFICIAL = { ug: 71.4, aqi: 0, count: 6, area: 'Minneapolis', distanceMi: 38, observedAt: '2026-08-03T19:00' };
const LOCAL = { ug: 84.2, aqi: 0, count: 27, medianDistanceMi: 8 };

function build(pm25, extra = {}) {
  return buildForecastPayload({
    raw: extra.raw ?? raw(pm25),
    requested: REQUESTED,
    snapped: SNAPPED,
    measured: extra.measured ?? null,
    requestedSource: extra.requestedSource ?? 'official',
    nowMs: NOW_MS,
  });
}

// --- schema conformance ----------------------------------------------------
let validate;

beforeAll(() => {
  const schema = JSON.parse(
    readFileSync(new URL('../../design/forecast-api-v1.schema.json', import.meta.url), 'utf8'),
  );
  const Ajv = Ajv2020.default ?? Ajv2020;
  validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
});

function expectValid(payload) {
  const ok = validate(payload);
  if (!ok) {
    throw new Error(
      `payload violates design/forecast-api-v1.schema.json:\n` +
        validate.errors.map((e) => `  ${e.instancePath || '/'} ${e.message}`).join('\n'),
    );
  }
  expect(ok).toBe(true);
}

describe('contract shape — every documented case validates against the schema', () => {
  it('smoky now, clears later', () => expectValid(build(CLEARING, { measured: { official: OFFICIAL } })));
  it('smoky now, never clears', () => expectValid(build(STUCK)));
  it('clean now, smoke arriving', () => expectValid(build(ARRIVING)));
  it('clear all week', () => expectValid(build(CLEAR)));

  it('no sensors anywhere — model-only', () => {
    const p = build(CLEARING, { measured: null });
    expectValid(p);
    expect(p.measured.official).toBeNull();
    expect(p.measured.local).toBeNull();
    expect(p.measured.anchor).toEqual({ source: 'model', offsetUg: 0, decayHours: 12 });
  });

  it('official and local far apart — both rows survive, neither is averaged', () => {
    const p = build(CLEARING, { measured: { official: OFFICIAL, local: LOCAL } });
    expectValid(p);
    expect(p.measured.official.ug).toBe(71.4);
    expect(p.measured.local.ug).toBe(84.2);
    // The midpoint would be 77.8 — a number neither source said.
    expect(p.hours[p.now.index].pm25).not.toBeCloseTo(77.8, 1);
  });

  it('model gaps mid-series stay null — never zero', () => {
    const gappy = [...CLEARING];
    for (let i = NOW_INDEX + 2; i < NOW_INDEX + 6; i++) gappy[i] = null;
    const p = build(gappy);
    expectValid(p);
    const gap = p.hours.slice(NOW_INDEX + 2, NOW_INDEX + 6);
    expect(gap.every((h) => h.pm25 === null)).toBe(true);
    expect(gap.every((h) => h.aqi === null && h.levelIndex === null && h.trend === null)).toBe(true);
    // An hour with no data still has a sun.
    expect(gap.every((h) => h.sky !== null)).toBe(true);
  });

  it('a short window (truncated model run) still validates', () => {
    const n = 90;
    const p = build(CLEARING, { raw: raw(CLEARING, n) });
    expectValid(p);
    expect(p.hours).toHaveLength(n);
    expect(p.now.index).toBeLessThan(n);
  });

  it('an all-null day reports no level rather than "All clear"', () => {
    const blank = new Array(HOURS).fill(null);
    const p = build(blank);
    expectValid(p);
    expect(p.days[0].levelIndex).toBeNull();
    expect(p.days[0].maxPm25).toBeNull();
  });

  it('the error envelope validates too', () => {
    expectValid({ v: 1, error: { code: 'upstream-failed', message: 'open-meteo 503' } });
  });

  // A schema that accepts anything is worse than no schema — B7/B8/B9 build
  // their mocks against it, so it has to actually discriminate.
  it('rejects the shapes clients must never be handed', () => {
    const good = build(CLEARING);
    expect(validate({ ...good, v: 2 })).toBe(false);
    expect(validate({ ...good, hours: [] })).toBe(false);
    expect(validate({ ...good, scale: good.scale.slice(0, 4) })).toBe(false);
    // clear/arrival can never both be set — they are opposite futures.
    expect(
      validate({
        ...good,
        verdict: { ...good.verdict, arrivalIndex: 5, arrivalAtUTC: good.verdict.peakAtUTC, arrivalLabel: 'x' },
      }),
    ).toBe(false);
    // an index without its rendered label is a half-answer
    expect(validate({ ...good, verdict: { ...good.verdict, clearLabel: null } })).toBe(false);
    expect(validate({ ...good, hours: [{ ...good.hours[0], agreement: 'maybe' }] })).toBe(false);
    expect(validate({ v: 1, error: { code: 'teapot', message: 'x' } })).toBe(false);
  });
});

// --- the fields clients actually branch on ---------------------------------
describe('verdict', () => {
  it('clear fields travel together and exclude the arrival fields', () => {
    const v = build(CLEARING).verdict;
    expect(v.above).toBe(true);
    expect(v.clearIndex).toBe(NOW_INDEX + 8);
    expect(v.clearAtUTC).toBe('2026-08-04T08:00:00Z');
    expect(v.clearLabel).toMatch(/^\w+ ~\d{1,2} (AM|PM)$/);
    expect(v.arrivalIndex).toBeNull();
    expect(v.arrivalAtUTC).toBeNull();
    expect(v.arrivalLabel).toBeNull();
    expect(v.headline).toBe(`Clears ${v.clearLabel}`);
  });

  it('labels are in the location zone, not UTC', () => {
    // 2026-08-04T08:00Z is 3 AM Tuesday in Chicago, not 8 AM.
    expect(build(CLEARING).verdict.clearLabel).toBe('Tuesday ~3 AM');
  });

  it('no clear anywhere leaves all three clear fields null', () => {
    const v = build(STUCK).verdict;
    expect([v.clearIndex, v.clearAtUTC, v.clearLabel]).toEqual([null, null, null]);
    expect(v.trend).toBe('stuck');
    expect(v.headline).toBe('No clear air in the 5-day window');
  });

  it('an arrival fills the arrival fields and leaves the clear fields null', () => {
    const v = build(ARRIVING).verdict;
    expect(v.above).toBe(false);
    expect(v.arrivalIndex).toBe(NOW_INDEX + 10);
    expect(v.clearIndex).toBeNull();
    expect(v.headline).toBe(`Smoke arrives ${v.arrivalLabel}`);
  });

  it('peak always resolves — worst case it is now', () => {
    const v = build(CLEAR).verdict;
    expect(Number.isInteger(v.peakIndex)).toBe(true);
    expect(v.peakAtUTC).toMatch(/Z$/);
    expect(v.headline).toBe('Stays clear for the next 5 days');
  });
});

describe('measured rows and the anchor', () => {
  it('defaults to the official row', () => {
    const p = build(CLEARING, { measured: { official: OFFICIAL, local: LOCAL } });
    expect(p.source.applied).toBe('official');
    expect(p.measured.anchor.source).toBe('official');
    expect(p.measured.anchor.offsetUg).toBe(11.4); // 71.4 - 60
    expect(p.hours[p.now.index].pm25).toBe(71.4);
  });

  it('?source=local anchors to the local row and can change the answer', () => {
    const official = build(CLEARING, { measured: { official: OFFICIAL, local: LOCAL } });
    const local = build(CLEARING, {
      measured: { official: OFFICIAL, local: LOCAL },
      requestedSource: 'local',
    });
    expect(local.source.applied).toBe('local');
    expect(local.hours[local.now.index].pm25).toBe(84.2);
    expect(local.hours[local.now.index].pm25).not.toBe(official.hours[official.now.index].pm25);
  });

  it('?source=local degrades to official when there is no local row', () => {
    const p = build(CLEARING, { measured: { official: OFFICIAL }, requestedSource: 'local' });
    expect(p.source.requested).toBe('local');
    expect(p.source.applied).toBe('official');
  });

  it('?source=model leaves the series untouched', () => {
    const p = build(CLEARING, {
      measured: { official: OFFICIAL, local: LOCAL },
      requestedSource: 'model',
    });
    expect(p.source.applied).toBe('model');
    expect(p.measured.anchor.offsetUg).toBe(0);
    expect(p.hours.map((h) => h.pm25)).toEqual(p.hours.map((h) => h.pm25Model));
    // The rows are still reported — the client renders the toggle from them.
    expect(p.measured.official).not.toBeNull();
    expect(p.measured.local).not.toBeNull();
  });

  it('degrades to model when the model has no value at now to anchor against', () => {
    const gappy = [...CLEARING];
    gappy[NOW_INDEX] = null;
    const p = build(gappy, { measured: { official: OFFICIAL } });
    expect(p.source.applied).toBe('model');
    expect(p.measured.anchor.offsetUg).toBe(0);
    expect(p.measured.model).toEqual({ ug: null, aqi: null });
  });

  it('drops an unparseable AirNow observedAt rather than inventing a zone', () => {
    const p = build(CLEARING, {
      measured: { official: { ...OFFICIAL, observedAt: 'undefinedT19:00' } },
    });
    expect(p.measured.official.observedAt).toBeNull();
  });
});

describe('hours, days, and the rest of the envelope', () => {
  it('timestamps are UTC instants, one per hour, in order', () => {
    const p = build(CLEARING);
    expect(p.hours[0].t).toBe('2026-08-01T00:00:00Z');
    expect(p.now.timeUTC).toBe(p.hours[p.now.index].t);
    expect(p.now.index).toBe(NOW_INDEX);
    for (let i = 1; i < p.hours.length; i++) {
      expect(Date.parse(p.hours[i].t) - Date.parse(p.hours[i - 1].t)).toBe(3_600_000);
    }
  });

  it('echoes the requested coordinates and reports the snapped ones', () => {
    const p = build(CLEARING);
    expect(p.location.requested).toEqual(REQUESTED);
    expect(p.location.snapped).toEqual(SNAPPED);
    expect(p.location.timezone).toBe(TZ);
    expect(p.location.utcOffsetSeconds).toBe(OFFSET);
  });

  it('never contradicts itself: no "falling" hour while the verdict is stuck', () => {
    const wobbly = series(60, [[3, 6, 45]]); // a dip that never sustains 6 hours
    const p = build(wobbly);
    expect(p.verdict.trend).toBe('stuck');
    expect(p.hours.some((h) => h.trend === 'falling')).toBe(false);
  });

  it('day-parts are always three, in order, coarse-bucketed', () => {
    const p = build(CLEARING);
    for (const day of p.days) {
      expect(day.dayParts.map((d) => d.key)).toEqual(['morning', 'afternoon', 'evening']);
      for (const part of day.dayParts) {
        if (part.bucket) expect(part.bucket.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('ships the whole rating ladder so no client hardcodes health copy', () => {
    const p = build(CLEARING);
    expect(p.scale).toHaveLength(5);
    expect(p.scale.map((s) => s.key)).toEqual([
      'all-clear',
      'something',
      'smells',
      'tastes',
      'smokeshow',
    ]);
    expect(p.scale[4].maxUg).toBeNull();
    expect(p.scale.every((s) => s.guidance.general && s.guidance.sensitive)).toBe(true);
  });

  it('agreement is lead-time fade only in v1', () => {
    const p = build(CLEARING);
    expect(p.agreement.multiModel).toBe(false);
    expect(p.agreement.diverged).toBe(false);
    expect(p.hours.some((h) => h.agreement === 'fade')).toBe(true);
    expect(p.hours.some((h) => h.agreement === 'diverge')).toBe(false);
  });
});

describe('request plumbing', () => {
  it('routes Open-Meteo through the /api/aq cache proxy, never directly', () => {
    const path = upstreamPath(SNAPPED);
    expect(path.startsWith('/api/aq?')).toBe(true);
    expect(path).toContain('latitude=45&longitude=-93.3');
    expect(path).toContain('past_days=3');
    expect(path).toContain('forecast_days=5');
    expect(path).toContain('timezone=auto');
  });

  it('normalizes an unknown ?source to official', () => {
    expect(normalizeSource('nonsense')).toBe('official');
    expect(normalizeSource(null)).toBe('official');
    expect(normalizeSource('local')).toBe('local');
  });

  it('raises no-series rather than emitting a half-built payload', () => {
    expect(() => build([], { raw: { timezone: TZ, utc_offset_seconds: 0, hourly: {} } })).toThrow(
      ForecastError,
    );
  });
});

// --- the parity test this whole branch exists for --------------------------
// The web's original client-side path, reproduced exactly: fetch the series,
// find now, anchor it, compute. If this ever diverges from the endpoint, a
// user's phone and their laptop are about to disagree about when it clears.
function webPath(pm25Raw, measuredUg = null) {
  const t = timesUTC(pm25Raw.length);
  const nowIndex = findNowIndex(t, NOW_MS);
  const pm25 = applySensorAnchor(pm25Raw, nowIndex, measuredUg);
  const verdict = computeVerdict({ pm25, nowIndex });
  return {
    nowIndex,
    pm25,
    verdict,
    headline: verdictHeadline(verdict, (i) => formatVerdictTime(t[i], TZ)),
    days: buildDaySummaries({ timesUTC: t, pm25, nowIndex, timezone: TZ }),
  };
}

describe('web and endpoint agree — same coordinates, same verdict', () => {
  const cases = [
    ['clearing', CLEARING],
    ['stuck', STUCK],
    ['arriving', ARRIVING],
    ['clear', CLEAR],
  ];

  for (const [name, pm25] of cases) {
    it(`${name}: model-only`, () => {
      const web = webPath(pm25);
      const api = build(pm25);

      expect(api.now.index).toBe(web.nowIndex);
      expect(api.verdict.headline).toBe(web.headline);
      expect(api.verdict.above).toBe(web.verdict.above);
      expect(api.verdict.trend).toBe(web.verdict.trend);
      expect(api.verdict.clearIndex).toBe(web.verdict.clearIdx);
      expect(api.verdict.arrivalIndex).toBe(web.verdict.arrivalIdx);
      expect(api.verdict.peakIndex).toBe(web.verdict.peakIdx);
      expect(api.verdict.levelIndex).toBe(web.verdict.nowLevelIndex);
    });

    it(`${name}: sensor-anchored`, () => {
      const web = webPath(pm25, OFFICIAL.ug);
      const api = build(pm25, { measured: { official: OFFICIAL } });

      expect(api.verdict.headline).toBe(web.headline);
      expect(api.verdict.clearIndex).toBe(web.verdict.clearIdx);
      expect(api.verdict.arrivalIndex).toBe(web.verdict.arrivalIdx);
      expect(api.hours.map((h) => h.pm25)).toEqual(
        web.pm25.map((v) => (v == null ? null : Number(v.toFixed(1)))),
      );
    });

    it(`${name}: day summaries match hour for hour`, () => {
      const web = webPath(pm25, OFFICIAL.ug);
      const api = build(pm25, { measured: { official: OFFICIAL } });

      expect(api.days.map((d) => d.key)).toEqual(web.days.map((d) => d.key));
      expect(api.days.map((d) => d.weekday)).toEqual(web.days.map((d) => d.weekday));
      expect(api.days.map((d) => d.levelIndex)).toEqual(web.days.map((d) => d.level.index));
      expect(api.days.map((d) => d.maxPm25)).toEqual(
        web.days.map((d) => (d.max == null ? null : Number(d.max.toFixed(1)))),
      );
      expect(api.days.map((d) => d.dayParts.map((p) => p.bucket?.name ?? null))).toEqual(
        web.days.map((d) => d.dayParts.map((p) => p.bucket?.name ?? null)),
      );
    });
  }
});
