// Active-wildfire facts for the map's hover cards. Served by /api/fires,
// which normalises NIFC's WFIGS feed (see that file for the source and the
// field-name tolerance).
//
// This layer answers "where is this coming from" — the question people have
// once they've read the verdict. It is not a forecast layer and it does not
// move with the scrubber: a fire is a fact reported as of a moment, so
// everything here carries its own timestamp and the UI says so.

const ENDPOINT = '/api/fires';

// One in-flight request per bbox, and the answers kept for the session. Panning
// the map re-asks constantly and the underlying reports change on a daily
// rhythm; without this a slow drag is a dozen identical round trips.
const cache = new Map();

const key = (w, s, e, n) => `${w},${s},${e},${n}`;

// Snapped the same way /api/fires snaps, so the client cache key and the CDN
// cache key move together. Without this the client would miss on every pan
// while the edge kept serving the same response.
const snap = (bounds) => [
  Math.floor(bounds.west),
  Math.floor(bounds.south),
  Math.ceil(bounds.east),
  Math.ceil(bounds.north),
];

/**
 * @param {{west:number,south:number,east:number,north:number}} bounds
 * @returns {Promise<{fires: Array, truncated: boolean} | null>} null on any
 *   failure — the fire layer is additive and the map is fully usable without
 *   it, so a caller should never have to handle an error here.
 */
export async function fetchFires(bounds) {
  const box = snap(bounds);
  const k = key(...box);
  if (cache.has(k)) return cache.get(k);

  const promise = (async () => {
    try {
      const res = await fetch(`${ENDPOINT}?bbox=${box.join(',')}`);
      if (!res.ok) return null;
      const body = await res.json();
      if (!Array.isArray(body?.fires)) return null;
      return { fires: body.fires, truncated: !!body.truncated };
    } catch {
      return null;
    }
  })();

  cache.set(k, promise);
  // A failure must not be cached for the session — the next pan should retry.
  promise.then((v) => {
    if (!v) cache.delete(k);
  });
  return promise;
}

// Marker radius in pixels. Area — not radius — tracks acreage, so a fire that
// covers ten times the ground reads as ten times the dot rather than a
// hundred. Floored so a small fire is still a target you can hit, capped so a
// megafire doesn't swallow the county it's in.
const MIN_RADIUS = 4;
const MAX_RADIUS = 14;
const RADIUS_REFERENCE_ACRES = 100_000;

export function fireRadius(acres) {
  if (!acres || acres <= 0) return MIN_RADIUS;
  const t = Math.min(1, Math.sqrt(acres / RADIUS_REFERENCE_ACRES));
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * t;
}

const fmtAcres = (acres) => {
  if (acres == null) return null;
  if (acres < 10) return `${acres.toFixed(1)} acres`;
  return `${Math.round(acres).toLocaleString()} acres`;
};

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * The lines of a fire card, in reading order. Returns only lines the feed
 * actually supports — a fire with no containment figure gets no containment
 * line rather than "Containment: unknown", which reads as a fact about the
 * fire when it is a fact about the paperwork.
 */
export function fireCard(fire) {
  const facts = [];
  if (fire.contained != null) facts.push(`${fire.contained}% contained`);
  const acres = fmtAcres(fire.acres);
  if (acres) facts.push(acres);

  const meta = [];
  const started = fmtDate(fire.discovered);
  if (started) meta.push(`Reported ${started}`);
  if (fire.cause) meta.push(fire.cause);

  return {
    title: fire.state ? `${fire.name}, ${fire.state}` : fire.name,
    facts: facts.join(' · '),
    meta: meta.join(' · '),
    // Never "as of now": these are filed on the incident's own schedule and
    // can be a day old. Saying which is the difference between a fact and a
    // claim.
    stamp: fire.updated ? `Incident report updated ${fmtDate(fire.updated)}` : null,
  };
}
