// Client for the pre-rendered smoke fields on the `data` branch.
//
// There are now two domains, not one: HRRR-Smoke at 3 km over CONUS, and CAMS
// at ~44 km over the populated world. Each is rendered by its own job on its
// own cadence (scripts/hrrr/render_frames.py, scripts/cams/render_global.py)
// and publishes its own manifest, so neither can clobber the other and a
// missing one simply narrows coverage.
//
// Frames are absolute-valid-time keyed, so a stale run stops matching recent
// hours on its own — there is no freshness gate to get wrong.
const BASE = 'https://raw.githubusercontent.com/josephrueter/smokeshow/data';

export const MANIFEST_VERSION = 2;

// Domain paths are a code-level fact, not data: fetching each manifest directly
// avoids a shared index file that two independent jobs would race to rewrite.
const DOMAIN_PATHS = ['hrrr', 'cams'];

// The HRRR manifest predates versioning and carries no domain metadata. Rather
// than strand the sharp field until its next run publishes, adopt it with the
// values it would have declared. Delete this once a v2 HRRR run has shipped.
const LEGACY_HRRR = {
  key: 'hrrr-conus',
  model: 'HRRR-Smoke near-surface (MASSDEN, 8m AGL)',
  label: '3 km smoke model',
  resolutionKm: 3,
  priority: 10,
};

function validBounds(b) {
  return (
    b &&
    [b.latS, b.latN, b.lonW, b.lonE].every(Number.isFinite) &&
    b.latN > b.latS &&
    b.lonE > b.lonW
  );
}

export function containsPoint(bounds, lat, lon) {
  if (!validBounds(bounds) || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= bounds.latS && lat <= bounds.latN && lon >= bounds.lonW && lon <= bounds.lonE;
}

// A manifest shape we do not understand is not a manifest we guess at: drop
// that domain and let the caller degrade to the point grid. Returns null rather
// than throwing, because one bad domain must not take the other down.
export function adoptManifest(path, manifest) {
  if (!manifest || typeof manifest !== 'object') return null;

  const version = manifest.v ?? (path === 'hrrr' ? 1 : null);
  if (version !== 1 && version !== MANIFEST_VERSION) return null;
  const legacy = version === 1;
  if (legacy && path !== 'hrrr') return null;

  if (!validBounds(manifest.bounds) || !Array.isArray(manifest.frames)) return null;

  const meta = legacy ? LEGACY_HRRR : manifest;
  if (!legacy && (!meta.key || !meta.label || !Number.isFinite(meta.priority))) return null;

  const frameByTime = new Map(
    manifest.frames
      .filter((f) => f?.time && f?.file)
      .map((f) => [f.time, `${BASE}/${path}/${f.file}`]),
  );
  if (!frameByTime.size) return null;

  return {
    key: meta.key,
    model: meta.model ?? null,
    // What the UI tells the reader they are looking at. The old fallback was
    // silent, and "which model is this" is the same honesty rule as
    // "model estimate, never observed".
    label: meta.label,
    resolutionKm: meta.resolutionKm ?? null,
    priority: meta.priority ?? LEGACY_HRRR.priority,
    bounds: manifest.bounds,
    width: manifest.width,
    height: manifest.height,
    run: manifest.run ?? null,
    generated: manifest.generated ?? null,
    frameByTime,
  };
}

async function loadDomain(path, fetchImpl) {
  try {
    const res = await fetchImpl(`${BASE}/${path}/manifest.json`);
    if (!res.ok) return null;
    return adoptManifest(path, await res.json());
  } catch {
    return null;
  }
}

export async function fetchSmokeFrames({ fetchImpl = fetch } = {}) {
  const [domains, series] = await Promise.all([
    Promise.all(DOMAIN_PATHS.map((p) => loadDomain(p, fetchImpl))),
    // The agreement band compares the point forecast against HRRR specifically,
    // so the series stays HRRR-only and is not part of the domain abstraction.
    fetchImpl(`${BASE}/hrrr/series.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  const usable = domains.filter(Boolean).sort((a, b) => b.priority - a.priority);
  if (!usable.length) return null; // caller degrades to the point grid
  return { domains: usable, series };
}

// The preference rule, unchanged in spirit from the single-domain version:
// prefer the sharpest field that actually has this hour. The addition is that
// it must also cover this PLACE — the old check was time-only, which pinned a
// CONUS image over a map that did not contain the reader and drew no smoke at
// all outside the box.
export function frameAt(frames, timeUTC, lat, lon) {
  if (!frames?.domains) return null;
  for (const domain of frames.domains) {
    if (!containsPoint(domain.bounds, lat, lon)) continue;
    const url = domain.frameByTime.get(timeUTC);
    if (url) return { url, domain };
  }
  return null;
}

// What to show the reader about the field they are looking at. Null means no
// pre-rendered field covers them and the point grid is painting.
export function coverageAt(frames, timeUTC, lat, lon) {
  const hit = frameAt(frames, timeUTC, lat, lon);
  if (!hit) return null;
  const { key, label, resolutionKm } = hit.domain;
  return { key, label, resolutionKm };
}

// Nearest 1-degree cell's HRRR forecast series for a location, as a
// time->µg/m³ map. Returns null outside the HRRR CONUS domain.
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
