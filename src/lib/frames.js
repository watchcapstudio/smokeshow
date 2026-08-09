// Client for the pre-rendered smoke domains on the `data` branch.
//
// A DOMAIN is one rectangular pre-rendered field: a model, an extent, a pixel
// size, and hourly PNG frames keyed by absolute valid time. Today there are
// two — NOAA HRRR-Smoke at 3 km over CONUS, and Copernicus CAMS at 40 km over
// most of the populated world. The map paints the sharpest domain that FILLS
// the viewport (see pickForView) — never two at once, never one running out
// mid-screen. Where no domain has the hour, the caller falls back to the
// 81-point CAMS grid and the badge says so.
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
  // Domains are published per basemap theme. This map draws CARTO Positron, so
  // it takes the light ones; a domain with no theme predates the field and is
  // light by definition. Painting a dark-ramp domain here would put the pale
  // end of the ramp on pale tiles, which is the convergence the ramp exists to
  // avoid.
  if (domain?.theme && domain.theme !== 'light') return false;
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

// Does `domain` contain the WHOLE viewport? `view` is {south,north,west,east}.
export function domainCoversView(domain, view) {
  if (!domain || !view) return false;
  const b = domain.bounds;
  if (view.south < b.latS || view.north > b.latN) return false;
  if (domain.wraps) return true;
  if (view.west > view.east) return false; // panned across the antimeridian
  return view.west >= b.lonW && view.east <= b.lonE;
}

// Every domain that could serve this viewport: covers it entirely, and has a
// frame for the hour. Sharpest first. More than one entry means the reader has
// a real choice and the map can offer it; one entry means there is nothing to
// switch to and no control should appear.
export function candidatesForView(frames, timeUTC, view) {
  if (!view) return [];
  const lat = (view.south + view.north) / 2;
  const lon = (view.west + view.east) / 2;
  return pickDomains(frames, timeUTC, lat, lon).filter((p) => domainCoversView(p.domain, view));
}

// What the map should paint: the reader's choice if it can still serve this
// viewport, otherwise the sharpest domain that FILLS the viewport, otherwise
// the widest one available.
//
// The automatic rule is not "the sharpest domain containing the centre" — that
// draws the sharp domain's rectangular edge across the map whenever you can
// see past it, and a straight line through Montana reads as geography, not as
// a model boundary. Nothing fills the gap either, because the domains measure
// different things (see docs/global-frames.md). So the map never shows two at
// once and never shows one running out.
//
// `preferredId` is honoured only while that domain still covers the whole
// viewport, which is what keeps a pin from resurrecting the edge: zoom out
// past HRRR and you get the global field whatever you picked, zoom back in and
// your choice returns. The pin is remembered, not enforced.
export function pickForView(frames, timeUTC, view, preferredId = null) {
  const covering = candidatesForView(frames, timeUTC, view);
  if (preferredId) {
    const pinned = covering.find((p) => p.domain.id === preferredId);
    if (pinned) return pinned;
  }
  if (covering.length) return covering[0];
  const lat = view ? (view.south + view.north) / 2 : NaN;
  const lon = view ? (view.west + view.east) / 2 : NaN;
  const all = pickDomains(frames, timeUTC, lat, lon);
  return all[all.length - 1] ?? null;
}

// What a domain measures, for the switch label. HRRR-Smoke reports smoke;
// CAMS reports total PM2.5 including dust, sea salt and traffic. Falls back to
// the label for a domain published before the field existed.
export function domainMeasures(domain) {
  return domain?.measures ?? null;
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
