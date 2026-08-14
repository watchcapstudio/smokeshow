// Basemap sources and what to do when they stop answering.
//
// The tiles are CARTO's, fetched keyless from basemaps.cartocdn.com. Keyless is
// why they were easy to adopt and also why there is nothing to monitor: no key
// means no account, no dashboard, no usage endpoint to poll. The only signal
// available to us is the one the map itself produces, tiles failing.
//
// Two reasons that signal matters. CARTO's basemap-styles LICENSE.md, changed
// Oct-Nov 2025, restricts their hosted tile services to enterprise customers
// and non-profit grants; the 75,000 mapviews/month free tier still quoted in
// older docs looks stale. Independently, smokeshow.earth is free and unmetered,
// so tile volume is unbounded. Either way the failure mode is not a slowdown
// you can watch approach, it is a block. A block is observable, and until this
// landed it was observed by nobody: the map simply went blank.

import { BASEMAP_THEME } from './frames.js';

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

// Derived from BASEMAP_THEME rather than written out, the same rule SmokeMap
// already follows: the tiles, the accepted frame domains and the fallback ramp
// can only ever flip together.
export const CARTO_BASE_URL = `https://{s}.basemaps.cartocdn.com/${BASEMAP_THEME}_nolabels/{z}/{x}/{y}{r}.png`;
export const CARTO_LABELS_URL = `https://{s}.basemaps.cartocdn.com/${BASEMAP_THEME}_only_labels/{z}/{x}/{y}{r}.png`;

// The fallback is no basemap at all, not a substitute one. There is no keyless
// drop-in replacement, and the substitute would have to match the theme: the
// frames are PNGs pre-rendered with a ramp (scripts/render/ramp.py) audited
// against the dark backdrops, and server-rendered output cannot be re-coloured
// at runtime, so a light stand-in would converge the ramp with the tiles. Bare
// it is. The smoke field, the fires and the marker keep working on
// `--map-surface`, which SmokeMap.css already paints behind the tiles at
// #090909. Losing the tiles therefore costs geography and nothing else; every
// contrast number in scripts/smoke-ramp-audit.mjs still holds.

// Trip threshold. A blocked or throttled host fails every tile, so errors climb
// while loads stay at zero; a transient blip produces a few errors against
// dozens of successes. Requiring errors to at least match loads is what
// separates the two without a timer.
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
