import { describe, it, expect } from 'vitest';
import { cellCoords, cellKeyFor, normalizeLocation } from '../src/cells.js';
import { snapCoord } from '../../../src/lib/grid.js';

// The lattice is shared with `/api/forecast`, which snaps with the same
// `snapCoord()` before calling upstream. If these two ever disagree the
// service starts fetching cells the CDN has never cached, and the cost model
// in the README stops being true — so the agreement is asserted, not assumed.

describe('cellKeyFor', () => {
  it('uses the same lattice as src/lib/grid.js', () => {
    const key = cellKeyFor(44.9778, -93.265);
    expect(key).toBe(`${snapCoord(44.9778).toFixed(4)},${snapCoord(-93.265).toFixed(4)}`);
  });

  it('collapses neighbouring addresses onto one cell', () => {
    // Downtown Denver, Capitol Hill, and Baker — three neighbourhoods, one
    // forecast, one fetch.
    const keys = new Set([
      cellKeyFor(39.7392, -104.9903),
      cellKeyFor(39.7301, -104.9711),
      cellKeyFor(39.7100, -105.0122),
    ]);
    expect(keys.size).toBe(1);
  });

  it('splits at a lattice boundary — two cells for one metro is expected', () => {
    // ~11 km apart across the 39.75° line. Both get correct answers; the run
    // costs two fetches instead of one. The alternative, a coarser lattice,
    // would start returning the wrong city's air.
    expect(cellKeyFor(39.7392, -104.99)).not.toBe(cellKeyFor(39.7621, -104.99));
  });

  it('keeps genuinely different places apart', () => {
    expect(cellKeyFor(39.7392, -104.9903)).not.toBe(cellKeyFor(40.0150, -105.2705)); // Denver vs Boulder
  });

  it('normalises negative zero, which would otherwise fork a key', () => {
    expect(cellKeyFor(0.01, -0.01)).toBe('0.0000,0.0000');
    expect(cellKeyFor(-0.02, 0.02)).toBe('0.0000,0.0000');
  });

  it('round-trips back to coordinates the forecast endpoint accepts', () => {
    const { lat, lon } = cellCoords(cellKeyFor(39.7392, -104.9903));
    expect(lat).toBeCloseTo(39.7, 4);
    expect(lon).toBeCloseTo(-105.0, 4);
    expect(cellKeyFor(lat, lon)).toBe(cellKeyFor(39.7392, -104.9903)); // snapping is idempotent
  });
});

describe('normalizeLocation', () => {
  it('keeps the real coordinates alongside the cell key', () => {
    const loc = normalizeLocation({ label: 'Home', lat: 39.7392, lon: -104.9903 });
    expect(loc).toEqual({ label: 'Home', lat: 39.7392, lon: -104.9903, cellKey: '39.7000,-105.0000' });
  });

  it('rejects coordinates that are not on Earth', () => {
    expect(normalizeLocation({ lat: 91, lon: 0 })).toBeNull();
    expect(normalizeLocation({ lat: 0, lon: 181 })).toBeNull();
    expect(normalizeLocation({ lat: 'north', lon: 0 })).toBeNull();
    expect(normalizeLocation(null)).toBeNull();
  });

  it('trims a label to something a notification title can hold', () => {
    const loc = normalizeLocation({ label: 'x'.repeat(200), lat: 0, lon: 0 });
    expect(loc.label).toHaveLength(64);
  });
});
