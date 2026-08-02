import { describe, it, expect } from 'vitest';
import { LEVELS, levelForPM25, ARRIVAL_THRESHOLD, cigaretteEquivalent } from './rating.js';

describe('levelForPM25 — boundaries', () => {
  it('returns null for missing/invalid readings', () => {
    expect(levelForPM25(null)).toBeNull();
    expect(levelForPM25(undefined)).toBeNull();
    expect(levelForPM25(NaN)).toBeNull();
  });

  it('0 µg/m³ is all-clear', () => {
    expect(levelForPM25(0).key).toBe('all-clear');
  });

  // LEVELS uses `pm25 < max`, so the boundary value itself belongs to the
  // NEXT level, not the one it's the max of.
  it.each([
    [11.9, 'all-clear'],
    [12, 'something'],
    [34.9, 'something'],
    [35, 'smells'],
    [54.9, 'smells'],
    [55, 'tastes'],
    [149.9, 'tastes'],
    [150, 'smokeshow'],
    [1000, 'smokeshow'],
  ])('%s µg/m³ -> %s', (pm25, key) => {
    expect(levelForPM25(pm25).key).toBe(key);
  });

  it('LEVELS are ordered by ascending max with a final Infinity catch-all', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].max).toBeGreaterThan(LEVELS[i - 1].max);
    }
    expect(LEVELS[LEVELS.length - 1].max).toBe(Infinity);
  });

  it('ARRIVAL_THRESHOLD is the PM2.5 value where "smells like fire" begins', () => {
    expect(ARRIVAL_THRESHOLD).toBe(LEVELS.find((l) => l.key === 'something').max);
    expect(levelForPM25(ARRIVAL_THRESHOLD).key).toBe('smells');
  });
});

describe('cigaretteEquivalent', () => {
  it('22 µg/m³ sustained over 24h is ~1 cigarette', () => {
    expect(cigaretteEquivalent(22)).toBeCloseTo(1, 5);
  });

  it('scales linearly', () => {
    expect(cigaretteEquivalent(44)).toBeCloseTo(2, 5);
    expect(cigaretteEquivalent(0)).toBe(0);
  });
});
