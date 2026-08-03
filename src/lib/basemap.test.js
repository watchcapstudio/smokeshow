import { describe, expect, it, vi } from 'vitest';
import { TILE_FAIL_MIN, createTileHealth, shouldFallback } from './basemap.js';

describe('shouldFallback', () => {
  it('ignores a handful of errors on an otherwise working map', () => {
    // The blip case: a few tiles time out while dozens land. This is the one
    // that matters — a fallback here would blank the basemap for no reason.
    expect(shouldFallback({ errors: 5, loads: 40 })).toBe(false);
    expect(shouldFallback({ errors: 20, loads: 200 })).toBe(false);
  });

  it('trips when a host is refusing everything', () => {
    // A 403/429 block fails every tile, so loads never accumulate.
    expect(shouldFallback({ errors: TILE_FAIL_MIN, loads: 0 })).toBe(true);
  });

  it('needs volume, not just a bad ratio', () => {
    // One error before the first tile lands is not evidence of anything.
    expect(shouldFallback({ errors: 1, loads: 0 })).toBe(false);
    expect(shouldFallback({ errors: TILE_FAIL_MIN - 1, loads: 0 })).toBe(false);
  });
});

describe('createTileHealth', () => {
  it('calls onTrip once, no matter how many more tiles fail after', () => {
    const onTrip = vi.fn();
    const health = createTileHealth(onTrip);
    for (let i = 0; i < 50; i++) health.onError();
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(onTrip).toHaveBeenCalledWith({ errors: TILE_FAIL_MIN, loads: 0 });
  });

  it('stays quiet while the map is drawing itself', () => {
    const onTrip = vi.fn();
    const health = createTileHealth(onTrip);
    // Interleaved the way a real load goes: mostly successes, a few failures.
    for (let i = 0; i < 60; i++) {
      health.onLoad();
      if (i % 12 === 0) health.onError();
    }
    expect(onTrip).not.toHaveBeenCalled();
    expect(health.stats.tripped).toBe(false);
  });

  it('trips when a working map later loses its tile host', () => {
    const onTrip = vi.fn();
    const health = createTileHealth(onTrip);
    for (let i = 0; i < 10; i++) health.onLoad();
    expect(onTrip).not.toHaveBeenCalled();
    // Host goes away mid-session; errors have to catch up to the loads first.
    for (let i = 0; i < 10; i++) health.onError();
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(onTrip.mock.calls[0][0]).toEqual({ errors: 10, loads: 10 });
  });
});
