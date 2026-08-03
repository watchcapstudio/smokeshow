import { snapCoordList } from '../src/lib/grid.js';

export const config = { runtime: 'edge' };

const UPSTREAM = 'https://air-quality-api.open-meteo.com/v1/air-quality';
// Only timezone rides through verbatim; hourly + the day windows are forced
// to the single shape the app uses so no param can bloat the response.
const ALLOWED_PARAMS = new Set(['timezone']);

// Clamp a small integer param to a sane range so a caller can't request a
// 92-day series to bloat the response / bust the cache.
function clampInt(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function json400(reason) {
  return new Response(JSON.stringify({ error: reason }), {
    status: 400,
    headers: {
      'content-type': 'application/json',
      // Short cache so a flood of identical bad requests doesn't re-run this.
      'cache-control': 'public, s-maxage=60',
      'access-control-allow-origin': '*',
    },
  });
}

// Cache proxy for Open-Meteo: the free tier (~10k locations/day) would fail
// exactly during a viral smoke event, so identical grid requests must hit
// Vercel's CDN cache instead of the upstream. Client-side coordinate
// snapping (see grid.js) makes nearby users produce identical URLs; this
// function adds the cache headers Open-Meteo doesn't send. Smoke runs update
// hourly — 30min freshness with an hour of stale-while-revalidate keeps one
// upstream fetch per area per half hour regardless of traffic.
export default async function handler(req) {
  const { searchParams } = new URL(req.url);

  // Snap + range-validate the coordinates server-side (the client-side lattice
  // is bypassable). Handles the comma-separated grid batch and caps its size.
  const latitude = snapCoordList(searchParams.get('latitude'), 'lat');
  const longitude = snapCoordList(searchParams.get('longitude'), 'lon');
  if (!latitude || !longitude) return json400('bad-coords');
  if (latitude.split(',').length !== longitude.split(',').length) {
    return json400('coord-count-mismatch');
  }

  const upstream = new URL(UPSTREAM);
  upstream.searchParams.set('latitude', latitude);
  upstream.searchParams.set('longitude', longitude);
  for (const [key, value] of searchParams) {
    if (ALLOWED_PARAMS.has(key)) upstream.searchParams.set(key, value);
  }
  upstream.searchParams.set('hourly', 'pm2_5');
  // Bound the window regardless of what the caller asked for.
  upstream.searchParams.set('past_days', String(clampInt(searchParams.get('past_days'), 3, 7)));
  upstream.searchParams.set(
    'forecast_days',
    String(clampInt(searchParams.get('forecast_days'), 5, 7)),
  );

  let res;
  try {
    res = await fetch(upstream);
  } catch (err) {
    console.error('aq: open-meteo fetch threw', String(err));
    // Cache the failure briefly so a throttle doesn't become a retry storm.
    return json400('upstream-unreachable');
  }
  if (!res.ok) console.error('aq: open-meteo', res.status);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      'content-type': 'application/json',
      // On error, cache briefly (was no-store) so one upstream throttle doesn't
      // re-hit Open-Meteo on every subsequent request and sustain the throttle.
      'cache-control': res.ok
        ? 'public, s-maxage=1800, stale-while-revalidate=3600'
        : 'public, s-maxage=30, stale-while-revalidate=300',
      'access-control-allow-origin': '*',
    },
  });
}
