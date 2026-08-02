import { describe, it, expect } from 'vitest';
import { skyFor, solarPosition, clamp01, lerp, mix, lum } from './sky.js';
import { LEVELS } from './rating.js';

describe('math primitives', () => {
  it('clamp01 clamps to [0, 1]', () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(5)).toBe(1);
  });

  it('lerp interpolates linearly', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('mix rounds each channel of an rgb triple', () => {
    expect(mix([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
  });

  it('lum ranks white above black', () => {
    expect(lum([255, 255, 255])).toBeCloseTo(1, 5);
    expect(lum([0, 0, 0])).toBe(0);
  });
});

describe('solarPosition — NOAA calculation replaces the fixed 6am-9pm schedule', () => {
  it('equator near equinox at solar noon: sun is close to overhead', () => {
    // Equation of time near the March equinox is small (a few minutes), so
    // UTC noon at lon=0 is close enough to solar noon for this tolerance.
    const { altitudeDeg } = solarPosition(new Date('2025-03-20T12:00:00Z'), 0, 0);
    expect(altitudeDeg).toBeGreaterThan(85);
  });

  it('mid-latitude winter: solar noon is above the horizon, solar midnight is well below it', () => {
    // Minneapolis-ish (45N, 93W). Local solar time ~= UTC - lon/15 = UTC - 6h12m.
    const noon = solarPosition(new Date('2025-12-21T18:12:00Z'), 45, -93);
    const midnight = solarPosition(new Date('2025-12-21T06:12:00Z'), 45, -93);
    expect(noon.altitudeDeg).toBeGreaterThan(15); // low winter sun, but up
    expect(midnight.altitudeDeg).toBeLessThan(-15); // deep night
  });

  it('high latitude midsummer: the sun never sets (the demo\'s fixed schedule got this wrong)', () => {
    // 75N at the June solstice is inside the Arctic Circle's midnight-sun
    // band. Solar "midnight" here must still show a positive altitude —
    // the exact failure mode of a hard-coded 6am-9pm daylight window.
    const { altitudeDeg } = solarPosition(new Date('2025-06-21T00:00:00Z'), 75, 0);
    expect(altitudeDeg).toBeGreaterThan(0);
  });

  it('azimuth stays within [0, 360)', () => {
    for (const hour of [0, 6, 12, 18, 23]) {
      const { azimuthDeg } = solarPosition(new Date(`2025-06-21T${String(hour).padStart(2, '0')}:00:00Z`), 45, -93);
      expect(azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(azimuthDeg).toBeLessThan(360);
    }
  });
});

// One representative PM2.5 reading per rating level (midpoint of its band).
const LEVEL_ANCHORS = LEVELS.map((level, i) => {
  const lowerBound = i === 0 ? 0 : LEVELS[i - 1].max;
  const upperBound = Number.isFinite(level.max) ? level.max : lowerBound + 100;
  return { key: level.key, pm25: (lowerBound + upperBound) / 2 };
});

const TIMES_OF_DAY = [
  { label: 'deep night', date: new Date('2025-06-21T06:00:00Z') }, // ~midnight local (45N, -93)
  { label: 'sunrise-ish', date: new Date('2025-06-21T11:00:00Z') },
  { label: 'solar noon', date: new Date('2025-06-21T18:00:00Z') },
  { label: 'sunset-ish', date: new Date('2025-06-22T00:59:00Z') },
];
const LAT = 45,
  LON = -93;

function isValidRGB(rgb) {
  return rgb.length === 3 && rgb.every((c) => Number.isInteger(c) && c >= 0 && c <= 255);
}

describe('skyFor — level anchors x times of day', () => {
  for (const anchor of LEVEL_ANCHORS) {
    for (const t of TIMES_OF_DAY) {
      it(`${anchor.key} @ ${t.label}: produces valid, internally-consistent sky output`, () => {
        const sky = skyFor(anchor.pm25, t.date, LAT, LON);

        expect(isValidRGB(sky.zenithRGB)).toBe(true);
        expect(isValidRGB(sky.midRGB)).toBe(true);
        expect(isValidRGB(sky.horizonRGB)).toBe(true);

        expect(sky.starOpacity).toBeGreaterThanOrEqual(0);
        expect(sky.starOpacity).toBeLessThanOrEqual(1);

        expect(sky.isDark).toBe(lum(sky.midRGB) < 0.42);
        expect(sky.sun.dim).toBeCloseTo(clamp01(anchor.pm25 / 150), 5);
        expect(sky.sun.visible).toBe(sky.sun.altitudeDeg > 1.1);

        expect(sky.zenith).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      });
    }
  }

  it('night reads darker than solar noon at the same PM2.5', () => {
    const night = skyFor(6, TIMES_OF_DAY[0].date, LAT, LON);
    const noon = skyFor(6, TIMES_OF_DAY[2].date, LAT, LON);
    expect(lum(night.midRGB)).toBeLessThan(lum(noon.midRGB));
    expect(night.starOpacity).toBeGreaterThan(noon.starOpacity);
  });

  it('heavier smoke dims and darkens the sky at a fixed time', () => {
    const clear = skyFor(LEVEL_ANCHORS[0].pm25, TIMES_OF_DAY[2].date, LAT, LON);
    const smokeshow = skyFor(LEVEL_ANCHORS[4].pm25, TIMES_OF_DAY[2].date, LAT, LON);
    expect(smokeshow.sun.dim).toBeGreaterThan(clear.sun.dim);
    expect(lum(smokeshow.midRGB)).toBeLessThanOrEqual(lum(clear.midRGB));
  });
});
