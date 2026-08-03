const KM_PER_DEG_LAT = 110.574;

// Snap a coordinate to a lattice so nearby users generate byte-identical
// API URLs and share the edge cache (see api/aq.js). 0.1° ≈ 11km — well
// under CAMS's ~40km resolution, so the forecast itself doesn't change.
export function snapCoord(value, stepDeg = 0.1) {
  return Number((Math.round(value / stepDeg) * stepDeg).toFixed(4));
}

// Parse, range-validate, and snap one request coordinate. Returns the snapped
// number, or null if absent / non-finite / out of range. The edge functions
// call this so a direct API caller can't bypass the client-side snapping the
// cache lattice depends on (jittered coords would otherwise be all-miss and
// burn the keyed upstreams). kind is 'lat' (±90) or 'lon' (±180).
export function parseSnappedCoord(value, kind) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  const limit = kind === 'lat' ? 90 : 180;
  if (n < -limit || n > limit) return null;
  return snapCoord(n);
}

// Same, for the comma-separated multi-coordinate form /api/aq accepts (the
// grid batch). Returns a snapped comma-joined string, or null if any component
// is bad or the count exceeds max (an abuser can't send an unbounded batch).
export function snapCoordList(raw, kind, max = 128) {
  if (raw == null) return null;
  const parts = String(raw).split(',');
  if (parts.length === 0 || parts.length > max) return null;
  const out = [];
  for (const part of parts) {
    const snapped = parseSnappedCoord(part, kind);
    if (snapped == null) return null;
    out.push(snapped);
  }
  return out.join(',');
}

function kmPerDegLon(latDeg) {
  return 111.32 * Math.cos((latDeg * Math.PI) / 180);
}

// ~9x9 grid at ~25km spacing centered on (centerLat, centerLon) -> ~200km square, 81 points.
export function buildGrid(centerLat, centerLon, { size = 9, spacingKm = 25 } = {}) {
  const half = Math.floor(size / 2);
  const latStep = spacingKm / KM_PER_DEG_LAT;
  const lonStep = spacingKm / kmPerDegLon(centerLat);
  const points = [];
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      points.push({
        i,
        j,
        lat: Number((centerLat + i * latStep).toFixed(4)),
        lon: Number((centerLon + j * lonStep).toFixed(4)),
        isCenter: i === 0 && j === 0,
      });
    }
  }
  return points;
}
