export const config = { runtime: 'edge' };

// Active-wildfire fact layer for the map's hover cards.
//
// Source: NIFC's WFIGS "Incident Locations — Current", the interagency feed
// the incident management teams themselves file into. It is the same origin
// behind InciWeb and the public fire dashboards. We surface only the reported
// facts — name, containment, size, discovery date, cause — and never anything
// that would amount to reporting on the fire.
//
// This is a proxy rather than a direct browser fetch for three reasons, in
// order of how much they'd hurt: ArcGIS does not promise CORS headers to us,
// the upstream would see one request per pan per visitor during exactly the
// event that makes people open this site, and the raw features carry ~90
// fields each when the card needs six. Normalising here means the client
// payload is small and the field-name tolerance below lives in one place.
const UPSTREAM =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
  'WFIGS_Incident_Locations_Current/FeatureServer/0/query';

// Largest first, so the cap below drops the fires least likely to be the one
// somebody is pointing at.
const MAX_FEATURES = 200;
const ORDER_BY = 'DailyAcres DESC';

// WFIGS field names have moved between service revisions (and the perimeter
// layer prefixes its attributes with `attr_`). Rather than pin one spelling
// and go blank on the next revision, ask for everything and read the first
// name that answers. A missing field yields null and the card omits that line.
const FIELDS = {
  name: ['IncidentName', 'attr_IncidentName', 'poly_IncidentName'],
  contained: ['PercentContained', 'attr_PercentContained'],
  acres: ['DailyAcres', 'attr_DailyAcres', 'IncidentSize', 'attr_IncidentSize', 'GISAcres'],
  discovered: ['FireDiscoveryDateTime', 'attr_FireDiscoveryDateTime'],
  cause: ['FireCause', 'attr_FireCause'],
  state: ['POOState', 'attr_POOState'],
  updated: ['ModifiedOnDateTime_dt', 'attr_ModifiedOnDateTime', 'ModifiedOnDateTime'],
  category: ['IncidentTypeCategory', 'attr_IncidentTypeCategory'],
  id: ['IrwinID', 'attr_IrwinID', 'GlobalID', 'UniqueFireIdentifier'],
};

function pick(attrs, names) {
  for (const n of names) {
    const v = attrs?.[n];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// ArcGIS returns epoch milliseconds for date fields. Hand the client an ISO
// string so nothing downstream has to know that.
const isoDate = (v) => {
  const n = num(v);
  if (n === null) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// POOState arrives as a census-style code, "US-MT". The card wants "MT".
const stateCode = (v) => (typeof v === 'string' ? v.replace(/^US-/, '') : null);

// "Natural" is the WFIGS term for what everyone else calls lightning, and
// reading "Cause: Natural" on a fire card invites the wrong guess. The other
// two values pass through as-is; anything unrecognised is dropped rather than
// reworded, because guessing at a cause is exactly the line we don't cross.
const CAUSES = { Natural: 'Lightning', Human: 'Human', Undetermined: 'Under investigation' };

// Exported for src/lib/fires.test.js. The clamping and cause mapping below are
// the only places this app reinterprets the feed rather than passing it
// through, so they are the parts worth pinning down.
export function normalize(feature) {
  const a = feature.attributes || {};
  const g = feature.geometry || {};
  const lat = num(g.y);
  const lon = num(g.x);
  if (lat === null || lon === null) return null;

  const name = pick(a, FIELDS.name);
  if (!name) return null; // an unnamed incident has nothing to say in a tooltip

  const contained = num(pick(a, FIELDS.contained));
  return {
    id: String(pick(a, FIELDS.id) ?? `${lat.toFixed(4)},${lon.toFixed(4)}`),
    name: String(name).trim(),
    lat,
    lon,
    acres: num(pick(a, FIELDS.acres)),
    // Clamped, not trusted: the feed occasionally carries 0-1 fractions and
    // out-of-range values, and "247% contained" would discredit the whole card.
    contained: contained === null ? null : Math.max(0, Math.min(100, Math.round(contained))),
    discovered: isoDate(pick(a, FIELDS.discovered)),
    cause: CAUSES[pick(a, FIELDS.cause)] ?? null,
    state: stateCode(pick(a, FIELDS.state)),
    updated: isoDate(pick(a, FIELDS.updated)),
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const bbox = (searchParams.get('bbox') || '').split(',').map(Number);
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
    return json({ error: 'bbox required as west,south,east,north' }, 400, 'no-store');
  }
  // Snapped to whole degrees, deliberately coarser than any pan: two people
  // looking at the same city produce the same upstream URL and the same cache
  // key. Same trick as the grid snapping in src/lib/grid.js.
  const [w, s, e, n] = [
    Math.floor(clamp(bbox[0], -180, 180)),
    Math.floor(clamp(bbox[1], -90, 90)),
    Math.ceil(clamp(bbox[2], -180, 180)),
    Math.ceil(clamp(bbox[3], -90, 90)),
  ];

  const upstream = new URL(UPSTREAM);
  upstream.searchParams.set('f', 'json');
  upstream.searchParams.set('geometry', `${w},${s},${e},${n}`);
  upstream.searchParams.set('geometryType', 'esriGeometryEnvelope');
  upstream.searchParams.set('inSR', '4326');
  upstream.searchParams.set('outSR', '4326');
  upstream.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  // Wildfires only. The same layer carries prescribed burns and non-fire
  // incidents, and labelling a planned burn as a wildfire on a smoke map would
  // be worse than showing nothing.
  upstream.searchParams.set('where', "IncidentTypeCategory = 'WF'");
  upstream.searchParams.set('outFields', '*');
  upstream.searchParams.set('returnGeometry', 'true');
  upstream.searchParams.set('orderByFields', ORDER_BY);
  upstream.searchParams.set('resultRecordCount', String(MAX_FEATURES));

  let res;
  try {
    res = await fetch(upstream, { headers: { accept: 'application/json' } });
  } catch {
    return json({ error: 'upstream unreachable' }, 502, 'no-store');
  }
  if (!res.ok) return json({ error: `upstream ${res.status}` }, 502, 'no-store');

  const body = await res.json();
  // ArcGIS reports its own failures inside a 200. Treating that as an empty
  // result would quietly show a fire-free map during a fire.
  if (body?.error) return json({ error: `upstream ${body.error.code ?? 'error'}` }, 502, 'no-store');

  const fires = (body.features || []).map(normalize).filter(Boolean);

  // Fire reports are filed on a daily operational rhythm, not hourly — a
  // shorter window would just re-fetch the same numbers. Long stale-while-
  // revalidate because a card one refresh behind is far better than no card.
  return json(
    { fires, truncated: fires.length >= MAX_FEATURES, source: 'NIFC WFIGS' },
    200,
    'public, s-maxage=3600, stale-while-revalidate=21600',
  );
}

function json(body, status, cacheControl) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': cacheControl,
      'access-control-allow-origin': '*',
    },
  });
}
