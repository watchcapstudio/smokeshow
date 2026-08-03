// Client for the NASA FIRMS fire layer written by scripts/hrrr/fetch_fires.py
// and published to the `data` branch alongside the HRRR frames.
//
// Everything here is deliberately additive: the map is complete without it, a
// failed fetch resolves to null, and null means no icons.
//
// Vocabulary, because it matters for the copy: FIRMS reports HEAT DETECTIONS.
// A cluster is a group of detections linked within ~10 km — a proxy for one
// fire complex, not a confirmed incident, and never a perimeter or an acreage.
const BASE = 'https://raw.githubusercontent.com/watchcapstudio/smokeshow/data';

// Merge radius in screen pixels. Screen-space, so the icon count follows how
// much map a reader can see rather than how many hotspots exist. It widens as
// you zoom out because that is where two neighbouring complexes stop being two
// separate answers to "where is this coming from".
export function mergePxForZoom(zoom = 6) {
  if (zoom <= 4) return 44;
  if (zoom <= 6) return 34;
  return 28;
}

// Minimum detections an icon must represent, by zoom.
//
// At continental scale a 3-pixel hotspot and a 3,000-pixel complex render as
// nearly the same bead, which flatters the first and buries the second. The
// floor keeps the zoomed-out view about the fires that are actually driving
// the smoke, and zooming in restores everything.
//
// Applied AFTER the merge, so a small cluster beside a big one is still
// counted into it — only genuinely isolated small ones drop out. The layer
// reports how many, in the legend; this is not a silent cap.
export function minDetectionsForZoom(zoom = 6) {
  if (zoom <= 5) return 8;
  if (zoom <= 7) return 3;
  return 1;
}

// Safety valve only — the merge radius already bounds icons to roughly
// (width/radius) * (height/radius) per view.
export const MAX_ICONS = 250;

export async function fetchHotspots() {
  const res = await fetch(`${BASE}/fires.json`);
  if (!res.ok) throw new Error(`fires ${res.status}`);
  return normalizeFires(await res.json());
}

export function normalizeFires(raw) {
  if (!raw || !Array.isArray(raw.clusters)) return null;
  const generatedMs = Date.parse(raw.generated);
  return {
    generatedMs: Number.isNaN(generatedMs) ? Date.now() : generatedMs,
    sensors: raw.sensors || [],
    windowHours: raw.windowHours ?? 24,
    confidence: raw.confidence || null,
    counts: raw.counts || null,
    linkKm: raw.linkKm ?? 10,
    // [lat, lon, n, frp, ageMinutesAtGenerated, highConfidence]
    clusters: raw.clusters.map((c) => ({
      lat: c[0],
      lon: c[1],
      n: c[2],
      frp: c[3],
      age: c[4],
      hi: c[5],
    })),
  };
}

// Detection age is the honest number: how long ago the freshest detection in
// this cluster was made, measured from now — NOT from when the file was built.
// A 3-hour-old hotspot is not a live fire front, and a reader looking at a
// 6-hour-old file deserves to see 9 hours, not 3.
export function detectionAgeMs(cluster, generatedMs, nowMs = Date.now()) {
  return Math.max(0, nowMs - generatedMs) + cluster.age * 60_000;
}

export function formatAge(ms) {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 10 && m) return `${h}h ${m}m ago`;
  return `${h}h ago`;
}

// Icon diameter in px. Detection count spans four orders of magnitude (one
// lone hotspot to a few thousand over a boreal complex), so the scale is
// logarithmic — a linear one would make everything but the largest complexes
// a dot.
export function fireIconPx(n, zoom = 6) {
  const d = 9 + 7 * Math.log10(Math.max(1, n));
  // Zoomed in, the local air quality is the story and a centroid drawn from
  // detections spread over ~10 km is at its least precise. Let the fires
  // recede rather than sit on the plume as big claims.
  const scale = zoom >= 10 ? 0.7 : 1;
  return Math.round(Math.min(32, Math.max(9, d)) * scale);
}

export function fireOpacity(zoom = 6) {
  return zoom >= 10 ? 0.75 : 1;
}

// Screen-space merge. Clusters are visited largest-first so the survivor of a
// merge is the biggest one in the neighbourhood, which keeps the icon anchored
// on the dominant fire rather than drifting to a centroid of unrelated ones.
//
// project: (lat, lon) -> {x, y} in container pixels.
export function mergeClusters(clusters, project, radiusPx = mergePxForZoom()) {
  const sorted = [...clusters].sort((a, b) => b.n - a.n);
  const cell = radiusPx;
  const buckets = new Map();
  const out = [];

  for (const c of sorted) {
    const p = project(c.lat, c.lon);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const bx = Math.floor(p.x / cell);
    const by = Math.floor(p.y / cell);

    let host = null;
    for (let dx = -1; dx <= 1 && !host; dx++) {
      for (let dy = -1; dy <= 1 && !host; dy++) {
        for (const cand of buckets.get(`${bx + dx},${by + dy}`) || []) {
          const dist = Math.hypot(cand.x - p.x, cand.y - p.y);
          if (dist <= radiusPx) {
            host = cand;
            break;
          }
        }
      }
    }

    if (host) {
      host.n += c.n;
      host.frp += c.frp;
      host.hi += c.hi;
      host.parts += 1;
      host.age = Math.min(host.age, c.age);
      continue;
    }

    const merged = {
      lat: c.lat,
      lon: c.lon,
      x: p.x,
      y: p.y,
      n: c.n,
      frp: c.frp,
      hi: c.hi,
      age: c.age,
      parts: 1,
    };
    const key = `${bx},${by}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(merged);
    out.push(merged);
  }

  out.sort((a, b) => b.n - a.n);
  return out.length > MAX_ICONS ? out.slice(0, MAX_ICONS) : out;
}

// Copy lives here, next to the data, so the honesty rules are enforced in one
// place: these are heat detections, they are not confirmed fires, and FIRMS
// gives no name, no perimeter and no size.
export function fireSummary(merged, fires, nowMs = Date.now()) {
  const age = formatAge(detectionAgeMs(merged, fires.generatedMs, nowMs));
  const det = merged.n === 1 ? '1 heat detection' : `${merged.n} heat detections`;
  const highPct = merged.n ? Math.round((merged.hi / merged.n) * 100) : 0;
  return {
    title: det,
    age,
    lines: [
      `Most recent ${age}. Satellite passes update roughly every 3 hours.`,
      `${highPct}% high confidence. NASA FIRMS, ${fires.sensors.length || 4} sensors, ` +
        `last ${fires.windowHours} hours.`,
      `Detections within about ${fires.linkKm} km are counted as one cluster and ` +
        'plotted at their centre.',
      'This is a satellite heat signature, not a confirmed fire. FIRMS reports no ' +
        'name, perimeter, size or containment.',
    ],
  };
}

export const FIRE_LEGEND = 'Satellite heat detections, last 24h — not confirmed fires';

// Never let the zoom floor hide detections quietly: if isolated small clusters
// were dropped, the legend says so and points at the way to get them back.
export function fireLegendText(hidden) {
  return hidden > 0 ? `${FIRE_LEGEND} · zoom in for ${hidden} smaller` : FIRE_LEGEND;
}
