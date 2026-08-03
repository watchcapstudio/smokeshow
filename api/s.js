import { levelForPM25 } from '../src/lib/rating.js';
import { computeVerdict, verdictHeadline } from '../src/lib/verdict.js';
import { applySensorAnchor } from '../src/lib/sensors.js';
import { ugm3ToAqi } from '../src/lib/aqi.js';
import { measuredSources } from '../src/lib/measured.js';
import { parseSnappedCoord } from '../src/lib/grid.js';

export const config = { runtime: 'edge' };

const MAX_NAME = 80;

const FALLBACK_TITLE = 'SMOKESHOW';
const FALLBACK_DESC =
  "Live wildfire smoke forecast for your location. See the smoke in the air right now, where it's coming from, and when it clears — in plain language.";

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Open-Meteo is queried with timezone=auto here, so hourly times arrive as
// local wall-clock strings with no offset. Parsing them as UTC and formatting
// in UTC yields correct local labels ("Thursday ~6 PM") without needing the
// location's IANA zone at the formatting layer.
function formatWallClock(timeStr) {
  const d = new Date(timeStr + 'Z');
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(d);
  const hour = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: true,
    timeZone: 'UTC',
  }).format(d);
  return `${weekday} ~${hour}`;
}

// Same pooled sensor anchor as the app (AirNow + PurpleAir median) so the
// link preview and the page tell the same story. Soft-fails to model-only.
async function measuredNearby(lat, lon) {
  try {
    const sources = await measuredSources(lat, lon, {
      airnowKey: process.env.AIRNOW_API_KEY,
      purpleairKey: process.env.PURPLEAIR_API_KEY,
    });
    // Previews lead with the official picture — it's what other apps show.
    return sources.official?.ug ?? sources.local?.ug ?? null;
  } catch {
    return null;
  }
}

async function buildVerdictStrings(lat, lon) {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&hourly=pm2_5&past_days=1&forecast_days=5&timezone=auto`;
  const [res, measured] = await Promise.all([fetch(url), measuredNearby(lat, lon)]);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = await res.json();
  const times = data.hourly.time;
  const modelPm25 = data.hourly.pm2_5;

  // "Now" in the location's wall-clock frame, matching the naive-as-UTC parse.
  const nowWallMs = Date.now() + (data.utc_offset_seconds || 0) * 1000;
  let nowIndex = 0;
  let best = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i] + 'Z').getTime() - nowWallMs);
    if (diff < best) {
      best = diff;
      nowIndex = i;
    }
  }

  const pm25 = applySensorAnchor(modelPm25, nowIndex, measured);
  const level = levelForPM25(pm25[nowIndex]);
  const aqi = ugm3ToAqi(pm25[nowIndex]);
  const verdict = computeVerdict({ pm25, nowIndex });
  const headline = verdictHeadline(verdict, (i) => formatWallClock(times[i]));

  // Per-day worst levels for the OG image strip
  const dayMax = new Map();
  const order = [];
  for (let i = nowIndex; i < times.length; i++) {
    const key = times[i].slice(0, 10);
    if (!dayMax.has(key)) order.push(key);
    dayMax.set(key, Math.max(dayMax.get(key) ?? -Infinity, pm25[i] ?? -Infinity));
  }
  const strip = order.slice(0, 5).map((key) => {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(key + 'T12:00Z'),
    );
    return `${weekday}:${levelForPM25(dayMax.get(key)).index}`;
  });

  return { levelName: level.name, levelKey: level.key, aqi, headline, strip: strip.join(',') };
}

export default async function handler(req) {
  const { origin, searchParams } = new URL(req.url);
  const lat = Number.parseFloat(searchParams.get('lat'));
  const lon = Number.parseFloat(searchParams.get('lon'));
  // Snapped copy used only for the (keyed, billed) upstream fetches, so a
  // crawler hitting many distinct share links shares the cache lattice. The
  // redirect target below keeps the sender's exact coords.
  const snapLat = parseSnappedCoord(searchParams.get('lat'), 'lat');
  const snapLon = parseSnappedCoord(searchParams.get('lon'), 'lon');
  const name = (searchParams.get('name') || '').slice(0, MAX_NAME);
  const utm = searchParams.get('utm_source');

  const targetParams = new URLSearchParams();
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    targetParams.set('lat', String(lat));
    targetParams.set('lon', String(lon));
  }
  if (name) targetParams.set('name', name);
  if (utm) targetParams.set('utm_source', utm);
  const target = `/${targetParams.size ? `?${targetParams.toString()}` : ''}`;

  let title = FALLBACK_TITLE;
  let desc = FALLBACK_DESC;
  let ogImage = null;

  if (snapLat != null && snapLon != null) {
    try {
      const v = await buildVerdictStrings(snapLat, snapLon);
      title = name ? `${name} — AQI ${v.aqi}, ${v.levelName}` : `AQI ${v.aqi} — ${v.levelName}`;
      // Live verdict in the SERP/preview description — when a search engine
      // or messenger shows this instead of rewriting it, it's unbeatable.
      desc = `${name ? `${name}: ` : ''}AQI ${v.aqi}, ${v.levelName}. ${v.headline}. Live wildfire smoke map and 5-day forecast.`;
      const imgParams = new URLSearchParams({
        rating: v.levelName,
        key: v.levelKey,
        aqi: String(v.aqi),
        place: name,
        line: v.headline,
        strip: v.strip,
      });
      ogImage = `${origin}/api/og?${imgParams.toString()}`;
    } catch (err) {
      // fall back to static tags — never block the redirect on OG generation
      console.error('s: verdict build failed', String(err));
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}
<meta property="og:type" content="website">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)})</script>
</head>
<body><a href="${esc(target)}">SMOKESHOW</a></body>
</html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=1800',
    },
  });
}
