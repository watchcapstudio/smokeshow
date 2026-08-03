// Client for the HRRR-Smoke data branch (rendered by .github/workflows/hrrr.yml).
// Frames are absolute-valid-time keyed, so a stale run simply stops matching
// recent hours and the map falls back to the CAMS field — no freshness gate.
const BASE = 'https://raw.githubusercontent.com/watchcapstudio/smokeshow/data/hrrr';

export async function fetchHRRR() {
  const [manifestRes, seriesRes] = await Promise.all([
    fetch(`${BASE}/manifest.json`),
    fetch(`${BASE}/series.json`),
  ]);
  if (!manifestRes.ok) throw new Error(`hrrr manifest ${manifestRes.status}`);
  const manifest = await manifestRes.json();
  const series = seriesRes.ok ? await seriesRes.json() : null;

  const frameByTime = new Map(
    manifest.frames.map((f) => [f.time, `${BASE}/${f.file}`]),
  );
  return { manifest, series, frameByTime };
}

export function hrrrFrameURL(hrrr, timeUTC) {
  return hrrr?.frameByTime.get(timeUTC) ?? null;
}

// Nearest 1-degree cell's forecast series for a location, as a time->µg/m³
// map. Returns null outside the HRRR CONUS domain.
export function hrrrSeriesAt(series, lat, lon) {
  if (!series) return null;
  const row = Math.round((lat - series.lat0) / series.dlat);
  const col = Math.round((lon - series.lon0) / series.dlon);
  if (row < 0 || row >= series.nlat || col < 0 || col >= series.nlon) return null;

  const byTime = new Map();
  let any = false;
  series.times.forEach((t, ti) => {
    const v = series.values[ti]?.[row]?.[col];
    if (v != null && v >= 0) {
      byTime.set(t, v);
      any = true;
    }
  });
  return any ? byTime : null;
}
