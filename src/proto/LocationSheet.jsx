// Change location — the mechanic behind the place at the foot.
//
// Joe's question was whether the location banner should be tappable and open
// the change-location flow. It should, and it should be a sheet rather than
// the live site's inline chooser: the chooser expands in place, which pushes
// the verdict down the screen at the exact moment the reader is looking at it.
// A sheet leaves the answer where it was and gives the search room.
//
// Two ways in, in the order people actually want them: type a place, or hand
// it back to the device. "Use my current location" sits at the top rather than
// buried under the results, because on a phone it is the common case.
//
// REVIEW BUILD: the live component (LocationSearch.jsx) calls Open-Meteo's
// geocoder on every keystroke. This one filters a fixed list instead, so the
// page has no network dependency and works inside a self-contained artifact.
// The mechanic is the thing under review; the result set is not.

import { useEffect, useMemo, useRef, useState } from 'react';

// Enough spread to show the interaction — matching, near-misses, and a miss.
const PLACES = [
  { label: 'Minneapolis, MN', lat: 44.9778, lon: -93.265 },
  { label: 'Saint Paul, MN', lat: 44.9537, lon: -93.09 },
  { label: 'Duluth, MN', lat: 46.7867, lon: -92.1005 },
  { label: 'Chicago, IL', lat: 41.8781, lon: -87.6298 },
  { label: 'Denver, CO', lat: 39.7392, lon: -104.9903 },
  { label: 'Missoula, MT', lat: 46.8721, lon: -113.994 },
  { label: 'Bend, OR', lat: 44.0582, lon: -121.3153 },
  { label: 'Seattle, WA', lat: 47.6062, lon: -122.3321 },
  { label: 'Spokane, WA', lat: 47.6588, lon: -117.426 },
  { label: 'Sacramento, CA', lat: 38.5816, lon: -121.4944 },
  { label: 'Vancouver, BC', lat: 49.2827, lon: -123.1207 },
  { label: 'Calgary, AB', lat: 51.0447, lon: -114.0719 },
];

export default function LocationSheet({ open, onClose, onSelect, current }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    // Focus the field, but only where a keyboard is not going to slam up over
    // the sheet the moment it opens.
    if (!window.matchMedia('(pointer: coarse)').matches) inputRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PLACES.slice(0, 6);
    return PLACES.filter((p) => p.label.toLowerCase().includes(q));
  }, [query]);

  if (!open) return null;

  return (
    <div className="proto-sheet" role="dialog" aria-modal="true" aria-label="Change location">
      <button
        type="button"
        className="proto-sheet__scrim"
        aria-label="Close"
        onClick={onClose}
        tabIndex={-1}
      />
      <div className="proto-sheet__panel proto-sheet__panel--short">
        <div className="proto-sheet__head">
          <h2>Where?</h2>
          <button type="button" className="proto-sheet__done" onClick={onClose}>
            Cancel
          </button>
        </div>

        <button type="button" className="proto-locate" onClick={() => onSelect(null)}>
          <span className="proto-locate__pin" aria-hidden="true">
            ◎
          </span>
          Use my current location
        </button>

        <input
          ref={inputRef}
          type="text"
          className="proto-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="City, town, or ZIP…"
          aria-label="Search for a location"
        />

        {results.length === 0 ? (
          <p className="proto-sheet__dim">Nothing matching “{query.trim()}”.</p>
        ) : (
          <ul className="proto-results">
            {results.map((p) => (
              <li key={p.label}>
                <button
                  type="button"
                  className={
                    'proto-results__item' +
                    (p.label === current ? ' proto-results__item--on' : '')
                  }
                  onClick={() => onSelect(p)}
                >
                  {p.label}
                  {p.label === current && <span aria-hidden="true">✓</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="proto-sheet__dim proto-sheet__note">
          Review build: this list is fixed. The live search queries Open-Meteo’s geocoder as you
          type, and picking a place here only moves the label — the forecast stays on the fixture.
        </p>
      </div>
    </div>
  );
}
