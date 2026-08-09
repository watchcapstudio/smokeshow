// Saved places for the scrubber's chip row — the web twin of iOS PlaceStore.
// A small localStorage list: tap a chip to switch, × to drop, ＋ to add. The
// place the reader is currently looking at is folded in even if unsaved, so the
// row always shows where they are.

const KEY = 'ss_places';

// A stable id from the rounded coordinate, so the same spot never lands twice
// and there is no need for a random source.
export function placeId(lat, lon) {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

export function shortNameOf(label) {
  if (!label) return 'Here';
  return label.split(',')[0].trim();
}

export function toPlace({ lat, lon, label, isCurrentLocation = false }) {
  return {
    id: placeId(lat, lon),
    lat,
    lon,
    label: label ?? null,
    shortName: shortNameOf(label),
    isCurrentLocation,
  };
}

export function getPlaces() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: chips are session-only, no worse than before */
  }
  return list;
}

// Add or update; the current-location flag is sticky to one entry at most.
export function savePlace(place) {
  const list = getPlaces().filter((p) => p.id !== place.id);
  if (place.isCurrentLocation) list.forEach((p) => (p.isCurrentLocation = false));
  return write([place, ...list]);
}

export function removePlace(id) {
  return write(getPlaces().filter((p) => p.id !== id));
}

// The chip row: the saved list with the current place folded in at the front if
// it was reached by search or link and never saved.
export function placesWithCurrent(current) {
  const list = getPlaces();
  if (current && !list.some((p) => p.id === current.id)) return [current, ...list];
  return list;
}
