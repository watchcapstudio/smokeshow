// Basemap sources and what to do when they stop answering.
//
// The tiles are CARTO's, fetched keyless from basemaps.cartocdn.com. Keyless is
// why they were easy to adopt and also why there is nothing to monitor: no key
// means no account, no dashboard, no usage endpoint. The only signal available
// to us is the one the map itself produces — tiles failing — so that is what
// this watches.
//
// Note also that CARTO's basemap-styles LICENSE.md (changed Oct-Nov 2025) now
// restricts their hosted tile services to enterprise customers and non-profit
// grants. Whether that covers this app is a licensing question, not a
// rate-limit question, and it resolves as a block rather than as a slowdown.
// A block is exactly what this detects.

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

export const CARTO_BASE_URL = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png';
export const CARTO_LABELS_URL =
  'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';

// There is no keyless dark raster basemap to fail over to, and the fallback
// CANNOT be a light one: the HRRR frames are PNGs pre-rendered with the pale
// smoke ramp, so a light basemap would make the plume invisible and we cannot
// re-render server-side output at runtime. So the fallback is no basemap at
// all — the map keeps the smoke field and the location marker on a flat dark
// surface. That surface is `--map-surface` in SmokeMap.css, which is set to
// exactly the tone the ramp was audited against, so every contrast number in
// scripts/smoke-ramp-audit.mjs still holds with the tiles gone.

// Trip threshold. A blocked or throttled host fails every tile, so errors
// climb while loads stay at zero; a transient blip produces a few errors
// against dozens of successes. Requiring errors to at least match loads is
// what separates the two without a timer.
export const TILE_FAIL_MIN = 6;

export function shouldFallback({ errors, loads }) {
  return errors >= TILE_FAIL_MIN && errors >= loads;
}

// Counts tile outcomes across every layer it is attached to and calls onTrip
// once, the first time the map stops being able to draw itself.
export function createTileHealth(onTrip) {
  let errors = 0;
  let loads = 0;
  let tripped = false;

  const check = () => {
    if (tripped || !shouldFallback({ errors, loads })) return;
    tripped = true;
    onTrip({ errors, loads });
  };

  return {
    onError: () => {
      errors++;
      check();
    },
    onLoad: () => {
      loads++;
    },
    get stats() {
      return { errors, loads, tripped };
    },
  };
}
