import { snapCoord } from './grid.js';
import { aqiToUgm3, ugm3ToAqi } from './aqi.js';

// Measured "Now" from nearby AirNow sensors via /api/sensors (key lives in a
// Vercel env var — never on the client). Returns null whenever unavailable:
// no key yet, no sensors nearby, dev server, network trouble. Null means the
// app behaves exactly as model-only.
// Returns { official, local } (either may be null) or null when nothing
// measured is available.
export async function fetchSensorsNear(lat, lon) {
  if (import.meta.env?.DEV) {
    // No edge functions under the Vite dev server. Mocks exercise the full
    // pipeline: ?mockOfficial=<AQI>&mockLocal=<AQI>, or legacy
    // ?mockSensors=<µg/m³> (treated as an official reading).
    const params = new URLSearchParams(window.location.search);
    const mo = Number(params.get('mockOfficial'));
    const ml = Number(params.get('mockLocal'));
    const ms = Number(params.get('mockSensors'));
    if ([mo, ml, ms].some(Number.isFinite)) {
      return {
        official: Number.isFinite(mo)
          ? { aqi: mo, ug: aqiToUgm3(mo), count: 1, area: 'Dev official', distanceMi: 38 }
          : Number.isFinite(ms)
            ? { aqi: ugm3ToAqi(ms), ug: ms, count: 3, area: 'Dev mock' }
            : null,
        local: Number.isFinite(ml)
          ? { aqi: ml, ug: aqiToUgm3(ml), count: 9, medianDistanceMi: 8 }
          : null,
      };
    }
    return null;
  }
  try {
    // Snap to the same cache lattice as the forecast fetches.
    const res = await fetch(`/api/sensors?lat=${snapCoord(lat)}&lon=${snapCoord(lon)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.official || data.local ? data : null;
  } catch {
    return null;
  }
}

// Measured daily AQI for past local dates (YYYY-MM-DD) via /api/history.
// Returns Map(dateKey -> {aqi, ug, count}); missing dates simply aren't in
// the map and those day boxes stay model-labeled.
export async function fetchMeasuredDays(lat, lon, dateKeys) {
  if (import.meta.env?.DEV) {
    const mock = new URLSearchParams(window.location.search).get('mockHistory');
    if (mock) {
      const aqis = mock.split(',').map(Number);
      return new Map(
        dateKeys.map((d, i) => [d, { aqi: aqis[i % aqis.length], ug: null, count: 2 }]),
      );
    }
    return new Map();
  }
  const results = await Promise.all(
    dateKeys.map(async (date) => {
      try {
        const res = await fetch(
          `/api/history?lat=${snapCoord(lat)}&lon=${snapCoord(lon)}&date=${date}`,
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data.aqi != null ? [date, data] : null;
      } catch {
        return null;
      }
    }),
  );
  return new Map(results.filter(Boolean));
}

// Exported because /api/forecast reports it to clients as
// `measured.anchor.decayHours` — the contract states the decay, so the number
// has to come from the implementation rather than be retyped next to it.
export const DECAY_HOURS = 12;

// Sensor-anchored series: shift the model by the measured-vs-model gap at
// "now", decaying the correction to zero over the next 12 hours. Past hours
// stay untouched (they're labeled "model estimate" and the map stays pure
// model too — a single-point offset doesn't generalize spatially).
export function applySensorAnchor(pm25, nowIndex, measured) {
  if (measured == null || pm25[nowIndex] == null) return pm25;
  const offset = measured - pm25[nowIndex];
  return pm25.map((v, i) => {
    if (v == null || i < nowIndex) return v;
    const age = i - nowIndex;
    if (age >= DECAY_HOURS) return v;
    const corrected = v + offset * (1 - age / DECAY_HOURS);
    return Math.max(0, Math.round(corrected * 10) / 10);
  });
}
