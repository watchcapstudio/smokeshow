import { measuredSources } from '../src/lib/measured.js';
import { parseSnappedCoord } from '../src/lib/grid.js';

export const config = { runtime: 'edge' };

// Measured PM2.5 near a point: one median pooled from AirNow regulatory
// monitors (within 50mi) and EPA-corrected PurpleAir consumer sensors
// (~30mi box). Returns {measured:null} when no keys or nothing reports,
// so the client falls back to model-only exactly as before.
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  // Snap server-side so jittered coords can't bypass the cache and burn the
  // keyed upstreams (PurpleAir bills per call).
  const lat = parseSnappedCoord(searchParams.get('lat'), 'lat');
  const lon = parseSnappedCoord(searchParams.get('lon'), 'lon');

  const empty = (reason) =>
    new Response(JSON.stringify({ measured: null, reason }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, s-maxage=300',
      },
    });

  if (lat == null || lon == null) return empty('bad-coords');

  try {
    const sources = await measuredSources(lat, lon, {
      airnowKey: process.env.AIRNOW_API_KEY,
      purpleairKey: process.env.PURPLEAIR_API_KEY,
    });
    if (!sources.official && !sources.local) return empty('no-sensors-nearby');

    return new Response(
      JSON.stringify(sources),
      {
        headers: {
          'content-type': 'application/json',
          // Observations update hourly-ish; 10 min freshness keeps us close
          // without burning the keyed APIs (PurpleAir bills per call).
          'cache-control': 'public, s-maxage=600, stale-while-revalidate=1200',
        },
      },
    );
  } catch (err) {
    // Log so a throttled/banned AirNow or PurpleAir key is visible during a
    // traffic spike instead of silently degrading everyone to model-only.
    console.error('sensors: upstream error', String(err));
    return empty('error');
  }
}
