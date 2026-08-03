import { aqiToUgm3, medianPM25Aqi } from '../src/lib/aqi.js';
import { parseSnappedCoord } from '../src/lib/grid.js';

export const config = { runtime: 'edge' };

// Measured daily PM2.5 AQI for a past date, from AirNow's historical
// observations — what the monitors actually recorded, replacing the model's
// guess about yesterday. Past dates are immutable, so cache hard.
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  // Snap server-side so jittered coords can't bust the cache and drain the
  // AirNow key quota.
  const lat = parseSnappedCoord(searchParams.get('lat'), 'lat');
  const lon = parseSnappedCoord(searchParams.get('lon'), 'lon');
  const date = searchParams.get('date'); // YYYY-MM-DD (local date at the location)
  const key = process.env.AIRNOW_API_KEY;

  const empty = (reason) =>
    new Response(JSON.stringify({ aqi: null, reason }), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, s-maxage=1800',
      },
    });

  if (lat == null || lon == null) return empty('bad-coords');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return empty('bad-date');
  if (!key) return empty('no-key');

  try {
    const url =
      `https://www.airnowapi.org/aq/observation/latLong/historical/` +
      `?format=application/json&latitude=${lat}&longitude=${lon}` +
      `&date=${date}T00-0000&distance=50&API_KEY=${key}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('history: airnow', res.status);
      return empty(`upstream-${res.status}`);
    }
    const median = medianPM25Aqi(await res.json());
    if (!median) return empty('no-pm25');

    return new Response(
      JSON.stringify({
        aqi: median.aqi,
        ug: Math.round(aqiToUgm3(median.aqi) * 10) / 10,
        count: median.count,
        date,
      }),
      {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        },
      },
    );
  } catch (err) {
    console.error('history: upstream error', String(err));
    return empty('error');
  }
}
