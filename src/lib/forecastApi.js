// Browser client for /api/forecast (contract v1).
//
// Two jobs, and only two:
//   1. Decide whether a response is a usable contract-v1 payload. Anything
//      else — wrong version, an error envelope, a non-JSON body, a timeout,
//      a dev server with no edge functions — returns null, and null means the
//      app falls back to its original client-side path. A bad deploy of the
//      endpoint must degrade the web, not break it (contract §9).
//   2. Adapt the payload's field names to the shapes the existing components
//      already consume, so switching to the endpoint changes no component.
//
// It deliberately does NOT recompute anything. Every number here came off the
// wire; re-deriving one would reintroduce exactly the drift the endpoint
// exists to remove.
import { LEVELS } from './rating.js';

const CONTRACT_VERSION = 1;
const REQUEST_TIMEOUT_MS = 6000;

// Structural check only — enough to know a decoder won't throw. Field-level
// null handling lives in the components, per the contract's "nulls are
// normal" rule.
export function isForecastPayload(data) {
  if (!data || data.v !== CONTRACT_VERSION || data.error) return false;
  if (!Array.isArray(data.hours) || data.hours.length === 0) return false;
  if (!Number.isInteger(data.now?.index)) return false;
  if (data.now.index < 0 || data.now.index >= data.hours.length) return false;
  if (!data.verdict || typeof data.verdict.headline !== 'string') return false;
  if (!Array.isArray(data.days) || !Array.isArray(data.pastDays)) return false;
  if (!data.measured?.anchor || !data.location?.timezone) return false;
  return true;
}

// 'YYYY-MM-DDTHH:mm:00Z' -> 'YYYY-MM-DDTHH:mm', the naive-UTC form every
// existing component and src/lib function already parses as `t + 'Z'`.
const toNaive = (t) => t.slice(0, 16);

export function adaptForecast(payload) {
  const hours = payload.hours;
  const v = payload.verdict;
  return {
    payload,
    generatedAt: payload.generatedAt,
    timezone: payload.location.timezone,
    requestedSource: payload.source.requested,
    appliedSource: payload.source.applied,

    timesUTC: hours.map((h) => toNaive(h.t)),
    pm25: hours.map((h) => h.pm25),
    pm25Model: hours.map((h) => h.pm25Model),
    nowIndex: payload.now.index,

    // computeVerdict()'s own field names — TrendChip and AppWidgetCTA read
    // this object directly and must not learn a second vocabulary.
    verdict: {
      above: v.above,
      clearIdx: v.clearIndex,
      arrivalIdx: v.arrivalIndex,
      peakIdx: v.peakIndex,
      trend: v.trend,
      nowLevelIndex: v.levelIndex,
    },
    headline: v.headline,

    // buildDaySummaries()'s shape, for ShareButton and ExplainSheet.
    days: payload.days.map((d) => ({
      key: d.key,
      weekday: d.weekday,
      level: LEVELS[d.levelIndex ?? 0],
      min: d.minPm25,
      max: d.maxPm25,
      dayParts: d.dayParts,
    })),

    // fetchSensorsNear()'s shape, for RatingChip's source toggle. Null when
    // nothing measured was available, exactly as the standalone fetch does.
    measured:
      payload.measured.official || payload.measured.local
        ? { official: payload.measured.official, local: payload.measured.local }
        : null,
  };
}

/**
 * Fetch and adapt the server verdict. Returns null on ANY failure — callers
 * treat null as "endpoint unavailable" and run the client-side path instead.
 */
export async function fetchServerForecast(lat, lon, { source = 'official' } = {}) {
  // Not gated on import.meta.env.DEV, so `vercel dev` can exercise the real
  // endpoint locally. Under a plain Vite dev server there are no edge
  // functions and this path serves api/forecast.js as a JS module instead —
  // which the content-type check below rejects, dropping dev onto the
  // client-side path. That is the right default: the fallback is the thing
  // most likely to rot unnoticed.
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const res = await fetch(
      `/api/forecast?lat=${lat}&lon=${lon}&source=${encodeURIComponent(source)}`,
      { signal: controller?.signal },
    );
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('application/json')) return null;
    const data = await res.json();
    return isForecastPayload(data) ? adaptForecast(data) : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
