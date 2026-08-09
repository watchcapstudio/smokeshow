// The /api/forecast payload builder — contract v1.
//
// Every number a client renders is computed here, once, from the same
// src/lib/* modules the browser has always used. Nothing in this file is
// re-derivable by a client without reimplementing the maths, which is the
// whole point: see docs/forecast-api-contract.md and platform plan §2.
//
// Deliberately pure. No fetch, no process.env, no Date.now() except as a
// default argument — api/forecast.js does the I/O and hands the raw upstream
// body in. That keeps the payload testable against a fixed fixture and keeps
// the web-vs-endpoint agreement test honest.
import {
  LEVELS,
  RANGES,
  NOT_LINES,
  EPA_LINES,
  EPA_SENS,
  levelForPM25,
} from './rating.js';
import { ugm3ToAqi } from './aqi.js';
import { computeVerdict, verdictHeadline } from './verdict.js';
import { buildDaySummaries, buildPastDaySummaries } from './days.js';
import { trendAt } from './trend.js';
import { skyFor } from './sky.js';
import { applySensorAnchor, DECAY_HOURS } from './sensors.js';
import { computeAgreement, summarizeAgreement } from './agreement.js';
import { findNowIndex } from './openMeteo.js';
import { formatVerdictTime } from './time.js';

export const CONTRACT_VERSION = 1;
export const FORECAST_MODEL = 'cams-global';
export const PAST_DAYS = 3;
export const FORECAST_DAYS = 5;

const SOURCES = ['official', 'local', 'model'];

// Thrown for the cases the contract names in §9; api/forecast.js maps `code`
// straight onto the error envelope.
export class ForecastError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ForecastError';
    this.code = code;
  }
}

export function normalizeSource(value) {
  return SOURCES.includes(value) ? value : 'official';
}

// Open-Meteo through /api/aq: one snapped point, timezone=auto. `auto` (rather
// than the UTC the grid fetch uses) is what carries the location's IANA zone
// and offset back, and every label in the payload is formatted in that zone —
// "when does it clear" is a question about the air over that place, not about
// the reader's laptop.
export function upstreamPath({ lat, lon }) {
  return (
    `/api/aq?latitude=${lat}&longitude=${lon}&hourly=pm2_5` +
    `&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=auto`
  );
}

const round = (v, places) =>
  v == null || Number.isNaN(v) ? null : Number(v.toFixed(places));
const round1 = (v) => round(v, 1);

// 'YYYY-MM-DDTHH:mm' — the naive-UTC form every src/lib function already
// speaks (they all do `new Date(t + 'Z')`). The payload adds the seconds and
// the Z on the way out.
function toNaiveUTC(localWallClock, utcOffsetSeconds) {
  const ms = Date.parse(`${localWallClock}Z`) - utcOffsetSeconds * 1000;
  if (Number.isNaN(ms)) throw new ForecastError('no-series', 'unparseable hourly time');
  return new Date(ms).toISOString().slice(0, 16);
}

const stampUTC = (naive) => `${naive}:00Z`;
const instantUTC = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// The rating ladder, shipped whole so no client hardcodes health copy —
// CLAUDE.md requires the explainer copy to ship verbatim, and copy retyped
// into a Swift file is copy that drifts.
export const SCALE = LEVELS.map((level, i) => ({
  index: level.index,
  key: level.key,
  name: level.name,
  rangeUg: RANGES[i],
  maxUg: level.max === Infinity ? null : level.max,
  visibility: level.visibility,
  notice: level.notice,
  notLine: NOT_LINES[i],
  guidance: { general: EPA_LINES[i], sensitive: EPA_SENS[i] },
}));

function officialRow(row) {
  if (!row || row.ug == null) return null;
  return {
    ug: round1(row.ug),
    aqi: ugm3ToAqi(row.ug),
    count: row.count ?? 0,
    area: row.area ?? null,
    distanceMi: row.distanceMi ?? null,
    // AirNow's own local wall-clock stamp, no zone. Passed through only when
    // it looks like one — inventing a zone would be worse than dropping it.
    observedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(row.observedAt ?? '')
      ? row.observedAt
      : null,
  };
}

function localRow(row) {
  if (!row || row.ug == null) return null;
  return {
    ug: round1(row.ug),
    aqi: ugm3ToAqi(row.ug),
    count: row.count ?? 0,
    medianDistanceMi: row.medianDistanceMi ?? null,
  };
}

function skyPayload(pm25, naiveTime, lat, lon) {
  // An hour with no model value still has a sun: compute the sky at 0 µg/m³
  // rather than dropping it, so a gap darkens nothing and hides nothing.
  const s = skyFor(pm25 ?? 0, new Date(`${naiveTime}Z`), lat, lon);
  return {
    zenith: s.zenithRGB,
    mid: s.midRGB,
    horizon: s.horizonRGB,
    isDark: s.isDark,
    starOpacity: round(s.starOpacity, 3),
    smoke: { s1: round(s.smoke.s1, 3), s2: round(s.smoke.s2, 3) },
    sun: {
      altitudeDeg: round(s.sun.altitudeDeg, 2),
      azimuthDeg: round(s.sun.azimuthDeg, 2),
      visible: s.sun.visible,
      xFrac: round(s.sun.xFrac, 3),
      yFrac: round(s.sun.yFrac, 3),
      dim: round(s.sun.dim, 3),
    },
    moon: {
      altitudeDeg: round(s.moon.altitudeDeg, 2),
      azimuthDeg: round(s.moon.azimuthDeg, 2),
      visible: s.moon.visible,
      xFrac: round(s.moon.xFrac, 3),
      yFrac: round(s.moon.yFrac, 3),
      phaseFraction: round(s.moon.phaseFraction, 4),
    },
  };
}

// Which measured row anchors the delivered series. Degrades
// official -> local -> model (or local -> official -> model when asked for
// local), and falls all the way to model whenever the anchor would be a
// no-op, so the contract's "applied === 'model' implies pm25 === pm25Model"
// promise holds.
function resolveAnchor(requested, measured, modelNowUg) {
  const preference =
    requested === 'model' ? [] : requested === 'local' ? ['local', 'official'] : ['official', 'local'];
  if (modelNowUg == null) return { applied: 'model', ug: null };
  for (const key of preference) {
    const ug = measured?.[key]?.ug;
    if (ug != null) return { applied: key, ug };
  }
  return { applied: 'model', ug: null };
}

/**
 * Build the full contract-v1 payload.
 *
 * @param {object}  args
 * @param {object}  args.raw        Open-Meteo body as returned through /api/aq
 *                                  (timezone=auto: hourly.time is local wall
 *                                  clock, utc_offset_seconds carries the zone).
 * @param {{lat,lon}} args.requested Coordinates as the client sent them.
 * @param {{lat,lon}} args.snapped   Coordinates actually fetched (grid.js lattice).
 * @param {object|null} args.measured `{ official, local }` from /api/sensors, or null.
 * @param {string}  args.requestedSource 'official' | 'local' | 'model'.
 * @param {number}  args.nowMs      The instant to treat as "now".
 */
export function buildForecastPayload({
  raw,
  requested,
  snapped,
  measured = null,
  requestedSource = 'official',
  nowMs = Date.now(),
}) {
  const localTimes = raw?.hourly?.time;
  const modelSeries = raw?.hourly?.pm2_5;
  if (!Array.isArray(localTimes) || !localTimes.length || !Array.isArray(modelSeries)) {
    throw new ForecastError('no-series', 'upstream returned no hourly series');
  }

  const utcOffsetSeconds = Number.isFinite(raw.utc_offset_seconds) ? raw.utc_offset_seconds : 0;
  const timezone = raw.timezone || 'UTC';
  const timesUTC = localTimes.map((t) => toNaiveUTC(t, utcOffsetSeconds));
  const nowIndex = findNowIndex(timesUTC, nowMs);

  const pm25Model = modelSeries.map((v) => (v == null || Number.isNaN(v) ? null : v));
  const source = normalizeSource(requestedSource);
  const anchor = resolveAnchor(source, measured, pm25Model[nowIndex]);
  const pm25 = applySensorAnchor(pm25Model, nowIndex, anchor.ug);
  const offsetUg = anchor.ug == null ? 0 : round1(anchor.ug - pm25Model[nowIndex]);

  const verdict = computeVerdict({ pm25, nowIndex });
  const label = (i) => (i == null ? null : formatVerdictTime(timesUTC[i], timezone));
  const at = (i) => (i == null ? null : stampUTC(timesUTC[i]));

  const agreementRows = computeAgreement({
    timesUTC,
    pm25: pm25Model, // the band compares models, so it reads the un-anchored series
    fetchedAtMs: nowMs,
    hrrrSeries: null, // v1 is lead-time fade only — see contract §8
  });
  const agreementSummary = summarizeAgreement(agreementRows, { multiModel: false });

  const hours = timesUTC.map((t, i) => ({
    t: stampUTC(t),
    pm25: round1(pm25[i]),
    pm25Model: round1(pm25Model[i]),
    aqi: ugm3ToAqi(pm25[i]),
    levelIndex: levelForPM25(pm25[i])?.index ?? null,
    trend: pm25[i] == null ? null : trendAt(pm25, i, verdict),
    agreement: agreementRows[i].status,
    sky: skyPayload(pm25[i], t, snapped.lat, snapped.lon),
  }));

  const daySummaries = buildDaySummaries({ timesUTC, pm25, nowIndex, timezone });
  const pastSummaries = buildPastDaySummaries({ timesUTC, pm25, nowIndex, timezone });

  return {
    v: CONTRACT_VERSION,
    generatedAt: instantUTC(nowMs),

    location: {
      requested: { lat: requested.lat, lon: requested.lon },
      snapped: { lat: snapped.lat, lon: snapped.lon },
      timezone,
      utcOffsetSeconds,
    },

    now: {
      index: nowIndex,
      timeUTC: stampUTC(timesUTC[nowIndex]),
      exactUTC: instantUTC(nowMs),
    },

    window: { pastHours: PAST_DAYS * 24, forecastHours: FORECAST_DAYS * 24 },

    source: { requested: source, applied: anchor.applied, model: FORECAST_MODEL },

    scale: SCALE,
    hours,

    verdict: {
      above: verdict.above,
      levelIndex: verdict.nowLevelIndex,
      trend: verdict.trend,
      headline: verdictHeadline(verdict, label),

      clearIndex: verdict.clearIdx,
      clearAtUTC: at(verdict.clearIdx),
      clearLabel: label(verdict.clearIdx),

      arrivalIndex: verdict.arrivalIdx,
      arrivalAtUTC: at(verdict.arrivalIdx),
      arrivalLabel: label(verdict.arrivalIdx),

      peakIndex: verdict.peakIdx,
      peakAtUTC: stampUTC(timesUTC[verdict.peakIdx]),
      peakPm25: round1(pm25[verdict.peakIdx]),
    },

    days: daySummaries.map((d) => ({
      key: d.key,
      weekday: d.weekday,
      // buildDaySummaries falls back to level 0 for an all-null day; the
      // contract says a day with nothing in it has no level.
      levelIndex: d.max == null ? null : (d.level?.index ?? null),
      minPm25: round1(d.min),
      maxPm25: round1(d.max),
      dayParts: d.dayParts.map((p) => ({
        key: p.key,
        label: p.label,
        bucket: p.bucket ? { name: p.bucket.name, color: p.bucket.color } : null,
      })),
    })),

    pastDays: pastSummaries.map((d) => ({
      key: d.key,
      weekday: d.weekday,
      levelIndex: d.level?.index ?? null,
      minPm25: round1(d.min),
      maxPm25: round1(d.max),
    })),

    measured: {
      official: officialRow(measured?.official),
      local: localRow(measured?.local),
      model: {
        ug: round1(pm25Model[nowIndex]),
        aqi: ugm3ToAqi(pm25Model[nowIndex]),
      },
      anchor: { source: anchor.applied, offsetUg, decayHours: DECAY_HOURS },
    },

    agreement: {
      multiModel: false,
      diverged: agreementSummary.diverged,
      label: agreementSummary.label,
    },
  };
}
