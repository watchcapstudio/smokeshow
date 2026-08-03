import { snapCoord } from '../../../src/lib/grid.js';

// The whole economics of this service live in this file.
//
// A notification run must cost O(unique cells), not O(subscribers). Ten
// thousand people in Denver ask about the same air, so they must collapse to
// one forecast fetch and one verdict diff. `snapCoord()` — the same 0.1°
// lattice `/api/forecast` snaps to before it calls upstream — is what makes
// that collapse exact: subscribers who snap to the same cell provably receive
// the same payload, because the endpoint would have fetched the same URL for
// each of them anyway.
//
// Do not "improve" this with a finer lattice. 0.1° is ~11 km, comfortably
// inside CAMS's ~40 km resolution, so a finer grid buys no accuracy and
// multiplies the run cost by the square of the refinement.

// -0 and 0 are the same cell but stringify differently, and the key is a
// primary key in every store — normalise before formatting.
function fmt(value) {
  return (Object.is(value, -0) ? 0 : value).toFixed(4);
}

export function isValidCoord(lat, lon) {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  );
}

// "45.0000,-93.3000" — stable, sortable, and byte-identical to what any other
// subscriber in the same cell produces.
export function cellKeyFor(lat, lon) {
  return `${fmt(snapCoord(lat))},${fmt(snapCoord(lon))}`;
}

export function cellCoords(cellKey) {
  const [lat, lon] = cellKey.split(',').map(Number);
  return { lat, lon };
}

// A subscribed location as stored: the user's coordinates are kept for display
// and for a future lattice migration, but every join happens on `cellKey`.
export function normalizeLocation(input) {
  const lat = Number(input?.lat);
  const lon = Number(input?.lon);
  if (!isValidCoord(lat, lon)) return null;
  const label = String(input?.label ?? '').trim().slice(0, 64);
  return {
    label: label || null,
    lat,
    lon,
    cellKey: cellKeyFor(lat, lon),
  };
}
