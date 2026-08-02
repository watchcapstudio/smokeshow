import { snapCoord } from '../src/lib/grid.js';
import {
  buildForecastPayload,
  normalizeSource,
  upstreamPath,
  ForecastError,
  CONTRACT_VERSION,
} from '../src/lib/forecast.js';

export const config = { runtime: 'edge' };

// GET /api/forecast?lat&lon[&source] — the one server-computed verdict all
// four clients render. Contract: docs/forecast-api-contract.md.
//
// This function is deliberately thin. It parses, fetches, and serialises;
// every derived number comes out of src/lib/forecast.js, which is the same
// code the browser runs. Node and browser must not fork the logic — a native
// app and a laptop disagreeing about "when does it clear" is the one failure
// this endpoint exists to prevent.
//
// Both upstreams are reached through our own cache proxies rather than
// directly: /api/aq for Open-Meteo (whose free tier would fail exactly during
// a viral smoke event) and /api/sensors for the keyed AirNow/PurpleAir calls
// (which the web already warms, so the two share CDN entries). Coordinates
// are snapped to the grid.js lattice first, so nearby users produce
// byte-identical upstream URLs.

const JSON_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
};

// 10 minutes: `now.index` advances hourly, so this bounds its staleness to
// well under one bucket. The expensive call underneath is cached for 30.
const CACHE_OK = 'public, s-maxage=600, stale-while-revalidate=1800';

function fail(status, code, message) {
  return new Response(JSON.stringify({ v: CONTRACT_VERSION, error: { code, message } }), {
    status,
    headers: { ...JSON_HEADERS, 'cache-control': 'no-store' },
  });
}

// Measured rows are additive: no keys, no monitors nearby, or a flaky
// upstream all mean model-only, never a failed forecast.
async function fetchMeasured(base, snapped) {
  try {
    const url = new URL(`/api/sensors?lat=${snapped.lat}&lon=${snapped.lon}`, base);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.official || data?.local ? data : null;
  } catch {
    return null;
  }
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const lat = Number.parseFloat(searchParams.get('lat'));
  const lon = Number.parseFloat(searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return fail(400, 'bad-coords', 'lat and lon must be finite numbers within range');
  }

  const requestedSource = normalizeSource(searchParams.get('source'));
  const snapped = { lat: snapCoord(lat), lon: snapCoord(lon) };

  try {
    const [aqRes, measured] = await Promise.all([
      fetch(new URL(upstreamPath(snapped), req.url)),
      fetchMeasured(req.url, snapped),
    ]);

    if (!aqRes.ok) {
      return fail(502, 'upstream-failed', `air quality upstream returned ${aqRes.status}`);
    }

    const payload = buildForecastPayload({
      raw: await aqRes.json(),
      requested: { lat, lon },
      snapped,
      measured,
      requestedSource,
      nowMs: Date.now(),
    });

    return new Response(JSON.stringify(payload), {
      headers: { ...JSON_HEADERS, 'cache-control': CACHE_OK },
    });
  } catch (e) {
    if (e instanceof ForecastError) return fail(502, e.code, e.message);
    // Anything unexpected still leaves the client a shape it can decode and
    // fall back from, rather than an HTML error page.
    return fail(500, 'internal', 'could not build the forecast');
  }
}
