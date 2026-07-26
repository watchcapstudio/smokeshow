// Server-side measured-air pooling, used by the edge functions (api/sensors,
// api/s). Combines AirNow regulatory monitors with PurpleAir consumer sensors
// into one median. Pure fetch logic — no window, no Vite.
import { aqiToUgm3, ugm3ToAqi } from './aqi.js';

// Both providers are garnish on a verdict the model can render alone, so
// neither is allowed to hold the request open. Without a cap, one stalled
// upstream rode out the whole edge invocation until Vercel killed it at 25s
// and the Official/Local tabs never painted. 3.5s leaves room for a slow but
// real response while keeping the pooled call comfortably inside the limit.
const UPSTREAM_TIMEOUT_MS = 3500;

// The timer spans the body read too, not just the headers: an upstream that
// answers fast and then stalls mid-stream is the same hang.
async function fetchJsonCapped(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function haversineMi(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function airnowUgm3(lat, lon, key) {
  if (!key) return [];
  try {
    const body = await fetchJsonCapped(
      `https://www.airnowapi.org/aq/observation/latLong/current/` +
        `?format=application/json&latitude=${lat}&longitude=${lon}&distance=50&API_KEY=${key}`,
    );
    if (!Array.isArray(body)) return [];
    const rows = body.filter((r) => r.ParameterName === 'PM2.5' && r.AQI >= 0);
    return rows.map((r) => ({
      ug: aqiToUgm3(r.AQI),
      distanceMi: Number.isFinite(r.Latitude)
        ? haversineMi(lat, lon, r.Latitude, r.Longitude)
        : null,
      area: r.ReportingArea ?? null,
      observedAt: `${r.DateObserved?.trim()}T${String(r.HourObserved).padStart(2, '0')}:00`,
    }));
  } catch {
    return [];
  }
}

// EPA correction for PurpleAir (Barkjohn et al.): raw cf_1 readings run high,
// especially in humid air and heavy smoke.
function epaCorrect(paCf1, rh) {
  const h = Number.isFinite(rh) ? rh : 50;
  if (paCf1 < 343) return Math.max(0, 0.524 * paCf1 - 0.0862 * h + 5.75);
  return Math.max(0, 0.46 * paCf1 + 3.93e-4 * paCf1 * paCf1 + 2.97);
}

async function purpleairUgm3(lat, lon, key) {
  if (!key) return [];
  try {
    const url =
      `https://api.purpleair.com/v1/sensors` +
      `?fields=pm2.5_cf_1,humidity,latitude,longitude&location_type=0&max_age=3600` +
      `&nwlng=${lon - 0.5}&nwlat=${lat + 0.4}&selng=${lon + 0.5}&selat=${lat - 0.4}`;
    const data = await fetchJsonCapped(url, { headers: { 'X-API-Key': key } });
    if (!data?.fields || !data?.data) return [];
    const iPm = data.fields.indexOf('pm2.5_cf_1');
    const iRh = data.fields.indexOf('humidity');
    const iLat = data.fields.indexOf('latitude');
    const iLon = data.fields.indexOf('longitude');
    return data.data
      .map((row) => ({ pm: row[iPm], rh: row[iRh], slat: row[iLat], slon: row[iLon] }))
      .filter((s) => Number.isFinite(s.pm))
      .slice(0, 200)
      .map((s) => ({
        ug: epaCorrect(s.pm, s.rh),
        distanceMi: Number.isFinite(s.slat) ? haversineMi(lat, lon, s.slat, s.slon) : null,
      }));
  } catch {
    return [];
  }
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Two honest answers, kept separate: "official" is the NEAREST government
// monitor's reading with its actual distance (what Apple/weather.com-family
// apps reflect), "local" is the median of EPA-corrected PurpleAir units with
// their typical distance. During fast-moving smoke they legitimately
// disagree; blending them yields a number neither source said.
export async function measuredSources(lat, lon, { airnowKey, purpleairKey }) {
  const [airnowRows, purpleairRows] = await Promise.all([
    airnowUgm3(lat, lon, airnowKey),
    purpleairUgm3(lat, lon, purpleairKey),
  ]);

  const round = (v) => Math.round(v * 10) / 10;
  const roundMi = (v) => (v == null ? null : v < 10 ? Math.round(v * 10) / 10 : Math.round(v));

  const nearestOfficial = airnowRows
    .slice()
    .sort((a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity))[0];
  const localUg = median(purpleairRows.map((s) => s.ug));
  const localDist = median(
    purpleairRows.map((s) => s.distanceMi).filter((d) => Number.isFinite(d)),
  );

  return {
    official: nearestOfficial
      ? {
          ug: round(nearestOfficial.ug),
          aqi: ugm3ToAqi(nearestOfficial.ug),
          count: airnowRows.length,
          area: nearestOfficial.area,
          distanceMi: roundMi(nearestOfficial.distanceMi),
          observedAt: nearestOfficial.observedAt,
        }
      : null,
    local:
      localUg != null
        ? {
            ug: round(localUg),
            aqi: ugm3ToAqi(localUg),
            count: purpleairRows.length,
            medianDistanceMi: roundMi(localDist),
          }
        : null,
  };
}
