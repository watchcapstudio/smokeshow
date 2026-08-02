// Production routes through /api/aq, an edge proxy that adds CDN cache
// headers (Open-Meteo sends none) so a traffic spike shares cached responses
// instead of burning the upstream quota. Dev calls Open-Meteo directly —
// there's no edge function under the Vite dev server.
const AIR_QUALITY_URL = import.meta.env?.DEV
  ? 'https://air-quality-api.open-meteo.com/v1/air-quality'
  : '/api/aq';

// Fetches hourly PM2.5 for every grid point in one batched request via
// Open-Meteo's comma-separated multi-coordinate syntax (verified against the
// live docs: &latitude=a,b,c&longitude=x,y,z -> response becomes a list).
//
// Requested in UTC rather than `timezone=auto`: the grid can in principle
// straddle a timezone/DST boundary, and every point's `hourly.time` array
// needs to line up on the exact same instant for the scrubber/map animation
// to stay in sync. Local-time display is handled separately at render time
// via the browser's own Intl timezone, so the user still only ever sees
// local time — this only changes how the raw series is fetched.
// pastDays=3 feeds the strip's slide-out "last three days" panel; every fetch
// (center, grid, zoom tiers) must share the same value so hour indices align
// across all series for the scrubber and field animation.
export async function fetchGridPM25(points, { pastDays = 3, forecastDays = 5 } = {}) {
  const latitude = points.map((p) => p.lat).join(',');
  const longitude = points.map((p) => p.lon).join(',');
  const url =
    `${AIR_QUALITY_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=pm2_5&past_days=${pastDays}&forecast_days=${forecastDays}&timezone=UTC`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo air quality request failed: ${res.status}`);
  }
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];

  return points.map((point, idx) => {
    const entry = list[idx];
    return {
      ...point,
      timesUTC: entry.hourly.time, // ISO strings, no offset — treat as UTC
      pm25: entry.hourly.pm2_5,
    };
  });
}

// nowMs is injectable so the edge function (api/forecast.js) and the browser
// pick "now" with the same code — a second nearest-hour search written
// server-side is exactly the kind of drift the forecast contract exists to
// prevent.
export function findNowIndex(timesUTC, nowMs = Date.now()) {
  let closest = 0;
  let closestDiff = Infinity;
  for (let i = 0; i < timesUTC.length; i++) {
    const diff = Math.abs(new Date(timesUTC[i] + 'Z').getTime() - nowMs);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = i;
    }
  }
  return closest;
}
