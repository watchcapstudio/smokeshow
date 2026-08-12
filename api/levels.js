import { LOCATIONS } from '../src/data/locations.js';
import { buildLevelsPayload, LEVELS_CONTRACT_VERSION } from '../src/lib/cityLevels.js';

export const config = { runtime: 'edge' };

// GET /api/levels — one current level per city page, for the directory lists at
// /smoke-forecast/ and the corridor pages.
//
// Thin on purpose, like api/forecast.js: this parses nothing, fetches once, and
// hands the numbers to src/lib/cityLevels.js, which is the same module the
// browser runs. The hub must not be able to reach a different conclusion from the
// city page about the same air, and the only way to guarantee that is for both to
// call levelForPM25 on the same value.
//
// ONE request upstream for all 25 cities, via Open-Meteo's comma-separated
// multi-coordinate syntax. Called directly rather than through /api/aq, which
// resolves a relative URL and only exists to share cache entries between many
// nearby single-point callers. That is the wrong shape here: this endpoint is
// itself one global cache entry, so proxying would add a hop and cache the same
// bytes twice.
const UPSTREAM = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const JSON_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
};

// 15 minutes fresh, an hour of stale-while-revalidate. The underlying model runs
// hourly, so this bounds staleness to well under one run while collapsing any
// amount of directory traffic into one upstream call per window. The chip carries
// its own timestamp, so a reader served a 14-minute-old reading can see that.
const CACHE_OK = 'public, s-maxage=900, stale-while-revalidate=3600';

// A failure here must not be cached for long: the directory degrades to the plain
// link list it ships as, and the next reader should get a fresh attempt.
const CACHE_FAIL = 'public, s-maxage=30';

export default async function handler() {
  const cities = LOCATIONS.map((l) => ({ slug: l.slug, lat: l.lat, lon: l.lon }));
  const url =
    `${UPSTREAM}?latitude=${cities.map((c) => c.lat).join(',')}` +
    `&longitude=${cities.map((c) => c.lon).join(',')}` +
    // past_days=0 and forecast_days=1 keep the payload small: this endpoint needs
    // one hour's value per city, not the series the map and scrubber need.
    '&hourly=pm2_5&past_days=0&forecast_days=1&timezone=UTC';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    // Multi-coordinate responses are a list; a single coordinate is an object.
    const series = Array.isArray(data) ? data : [data];
    const payload = buildLevelsPayload({ cities, series, nowMs: Date.now() });
    return new Response(JSON.stringify(payload), {
      headers: { ...JSON_HEADERS, 'cache-control': CACHE_OK },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ v: LEVELS_CONTRACT_VERSION, asOf: null, cities: [] }),
      { status: 200, headers: { ...JSON_HEADERS, 'cache-control': CACHE_FAIL } },
    );
  }
}
