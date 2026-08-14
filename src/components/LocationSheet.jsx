// Add a place — the web twin of iOS PlacePickerView.
//
// A bottom-sheet roll-up over a scrim, not the old inline chooser that expanded
// in document flow and pushed the verdict below the fold. Same mechanics as
// ExplainSheet (fixed sheet, backdrop, Esc, focus trap, a real close control
// since web has no drag-to-dismiss) and the same design as the iOS picker:
// warm panel, ember accent, mono eyebrows, city name over a mono region.
//
// Interaction is open -> search -> add-and-go. Clicking a result (or a saved
// row, or "Use my current location") pins the pill, switches the verdict to
// that place, and closes the sheet. Search is Open-Meteo's geocoder, debounced
// so a five-letter city is one request, not five.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { searchPlaces } from '../lib/geocoding.js';
import './LocationSheet.css';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function LocationSheet({
  open,
  onClose,
  onAddPlace,
  onUseMyLocation,
  saved = [],
  currentPlaceId,
}) {
  const sheetRef = useRef(null);
  const inputRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // Reset each time it opens, and trap focus / handle Esc like ExplainSheet.
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setResults([]);
    previouslyFocusedRef.current = document.activeElement;

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = sheetRef.current?.querySelectorAll(FOCUSABLE_SELECTOR);
      if (!items || items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

  // Focus the search field on open so the keyboard is up and ready to type. This
  // runs in a layout effect, and App opens the sheet inside flushSync, so the
  // focus lands synchronously within the tap that opened it — the only way iOS
  // will actually raise the keyboard for a programmatic focus.
  useLayoutEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Pin the sheet to the VISUAL viewport, not the layout one. iOS does not
  // shrink the layout viewport for the keyboard; it scrolls the visual viewport
  // instead. A sheet fixed to the layout viewport therefore slides its head and
  // search field off the top of the screen the moment the keyboard opens, and
  // the reader is left staring at the sheet's empty lower half with no way to
  // type without scrolling back up. Tracking visualViewport keeps the search
  // field parked directly above the keyboard, where it was tapped.
  //
  // Lock the document while it is open, too: a stray page scroll behind a
  // fixed backdrop is what lets the page bleed through at the edges.
  useEffect(() => {
    if (!open) return undefined;
    const vv = window.visualViewport;
    const body = document.body;
    const priorOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    if (!vv) {
      return () => {
        body.style.overflow = priorOverflow;
      };
    }
    // Write straight through rather than through rAF: the keyboard slide fires a
    // stream of scroll/resize events, and a frame of lag between them and the
    // sheet is a frame of the page showing at the seam.
    const sync = () => {
      const root = sheetRef.current;
      if (!root) return;
      root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
      root.style.setProperty('--vv-height', `${vv.height}px`);
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--vv-keyboard', `${keyboard}px`);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      body.style.overflow = priorOverflow;
    };
  }, [open]);

  // Debounced type-ahead.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      const found = await searchPlaces(q);
      setResults(found);
      setSearching(false);
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

  if (!open) return null;

  const region = (r) => r.admin1 || r.country || '';

  return (
    <>
      <div className="place-sheet-backdrop" onClick={onClose} />
      <div
        className="place-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add a place"
        tabIndex={-1}
      >
        <button type="button" className="place-sheet__grab" aria-label="Close" onClick={onClose} />

        <div className="place-sheet__head">
          <div>
            <div className="place-sheet__eyebrow mono">Where to</div>
            <h2 className="place-sheet__title">Add a place</h2>
          </div>
          <button type="button" className="place-sheet__done mono" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="place-sheet__search">
          <span className="place-sheet__search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a city"
            aria-label="Search for a city"
          />
          {query && (
            <button
              type="button"
              className="place-sheet__clear"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              ×
            </button>
          )}
        </div>

        <div className="place-sheet__body">
          {results.length > 0 ? (
            <>
              <div className="place-sheet__section mono">Results</div>
              <ul className="place-sheet__list">
                {results.map((r) => (
                  <li key={`${r.lat},${r.lon}`}>
                    <button
                      type="button"
                      className="place-sheet__row"
                      onClick={() => onAddPlace(r)}
                    >
                      <span className="place-sheet__place">
                        <span className="place-sheet__name">{r.name}</span>
                        {region(r) && (
                          <span className="place-sheet__region mono">{region(r)}</span>
                        )}
                      </span>
                      <span className="place-sheet__add" aria-hidden="true">+</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <button
                type="button"
                className="place-sheet__locate"
                onClick={onUseMyLocation}
              >
                <span className="place-sheet__locate-icon" aria-hidden="true">➤</span>
                Use my current location
              </button>

              {searching && <p className="place-sheet__searching mono">Searching…</p>}

              {saved.length > 0 && (
                <>
                  <div className="place-sheet__section mono">Saved</div>
                  <ul className="place-sheet__list">
                    {saved.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="place-sheet__row"
                          onClick={() => onAddPlace(p)}
                        >
                          <span className="place-sheet__place">
                            <span className="place-sheet__name">
                              {p.shortName}
                              {p.isCurrentLocation && (
                                <span className="place-sheet__here" aria-hidden="true"> ➤</span>
                              )}
                            </span>
                            {p.label && p.label.includes(',') && (
                              <span className="place-sheet__region mono">
                                {p.label.split(',').slice(1).join(',').trim()}
                              </span>
                            )}
                          </span>
                          {p.id === currentPlaceId && (
                            <span className="place-sheet__check" aria-hidden="true">✓</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
