// Client for the pre-rendered smoke domains on the `data` branch.
//
// A DOMAIN is one rectangular pre-rendered field: a model, an extent, a pixel
// size, and hourly PNG frames keyed by absolute valid time. Today there are
// two — NOAA HRRR-Smoke at 3 km over CONUS, and Copernicus CAMS at 40 km over
// most of the populated world. The map paints the sharpest domain that
// contains the view centre and has a frame for the hour; where none does, the
// caller falls back to the 81-point CAMS grid.
//
// Frames are absolute-valid-time keyed, so a stale run simply stops matching
// recent hours and the map falls back on its own — no freshness gate.
const BASE = 'https://raw.githubusercontent.com/watchcapstudio/smokeshow/data';

// The manifest shape this client understands. It went to 2 when one `bounds`
// became many domains (B11). If the branch ever serves a version this build
// has never heard of, fetchFrames() returns null and the map degrades to the
// point grid — guessing at an unknown shape is how you paint a plume in the
// wrong hemisphere.
export const SUPPORTED_MANIFEST_VERSION = 2;

function withURLs(domain) {
  return {
    ...domain,
    frameByTime: new Map(
      (domain.frames || []).map((f) => [f.time, `${BASE}/${domain.id}/${f.file}`]),
    ),
  };
}

function usable(domain) {
  return (
    domain &&
    typeof domain.id === 'string' &&
    domain.bounds &&
    Array.isArray(domain.frames) &&
    Number.isFinite(domain.bounds.latS) &&
    Number.isFinite(domain.bounds.latN) &&
    Number.isFinite(domain.bounds.lonW) &&
    Number.isFinite(domain.bounds.lonE)
  );
}

export async function fetchFrames() {
  const res = await fetch(`${BASE}/manifest.json`);
  if (!res.ok) throw new Error(`frames manifest ${res.status}`);
  const manifest = await res.json();

  if (manifest?.version !== SUPPORTED_MANIFEST_VERSION) {
    // Not an error — a newer publisher and an older client is a normal state
    // during a rollout. Degrade quietly and let the point grid carry the map.
    return null;
  }

  const domains = (manifest.domains || [])
    .filter(usable)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .map(withURLs);
  if (!domains.length) return null;

  return { manifest, domains, seriesDomain: domains.find((d) => d.series) ?? null };
}

// The agreement band's second model, fetched only for readers it can serve.
// It is a 2 MB file covering one domain's extent; pulling it in Madrid to
// discover Madrid is not in it is exactly the tax a global build should not
// charge. Returns null when there is nothing useful to fetch.
export async function fetchSeries(frames, lat, lon) {
  const d = frames?.seriesDomain;
  if (!d || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!domainContains(d, lat, lon)) return null;
  try {
    const r = await fetch(`${BASE}/${d.id}/${d.series}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null; // additive — the band just stays single-model
  }
}

export function domainContains(domain, lat, lon) {
  const b = domain.bounds;
  if (lat < b.latS || lat > b.latN) return false;
  if (domain.wraps) return true; // full 360°, so every longitude is inside
  const l = ((lon + 180) % 360 + 360) % 360 - 180;
  return l >= b.lonW && l <= b.lonE;
}

// Every domain that covers (lat, lon) and has a frame for this hour, sharpest
// first. Usually one entry; two when a sharp regional domain sits inside a
// coarser global one, which is what lets the map paint HRRR's 3 km field and
// still show what is happening past its edge.
export function pickDomains(frames, timeUTC, lat, lon) {
  if (!frames || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const out = [];
  for (const domain of frames.domains) {
    if (!domainContains(domain, lat, lon)) continue;
    const url = domain.frameByTime.get(timeUTC);
    if (url) out.push({ domain, url });
  }
  return out;
}

// The sharpest domain that covers (lat, lon) AND has a frame for this hour.
// Returns { domain, url } or null — null is the caller's cue to draw the
// coarse point grid and say so.
export function pickDomain(frames, timeUTC, lat, lon) {
  return pickDomains(frames, timeUTC, lat, lon)[0] ?? null;
}

// A second hour from the SAME domain, for the crossfade. Swapping domains
// mid-blend would dissolve one model's plume into another's.
export function domainFrameURL(domain, timeUTC) {
  return domain?.frameByTime.get(timeUTC) ?? null;
}

// Nearest 1-degree cell's forecast series for a location, as a time->µg/m³
// map. Returns null outside the publishing domain's extent.
export function seriesAt(series, lat, lon) {
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
