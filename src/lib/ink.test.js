import { describe, expect, it } from 'vitest';
import { skyFor } from './sky.js';
import {
  AA_BODY,
  DIM_ALPHA,
  INK_ON_DARK_AIR,
  INK_ON_LIGHT_AIR,
  SCRIM_MAX,
  composite,
  contrastRatio,
  hexToRgb,
  inkPlan,
  relativeLuminance,
  scrimAlphaFor,
} from './ink.js';

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

describe('WCAG maths', () => {
  it('anchors relative luminance at the ends of the range', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 6);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 6);
  });

  it('gives 21:1 for black on white, both ways round', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 4);
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 4);
  });

  it('matches a known third-party value (#767676 on white is the AA floor)', () => {
    expect(contrastRatio(hexToRgb('#767676'), WHITE)).toBeCloseTo(4.54, 2);
  });

  it('composites in sRGB space, the way the browser does', () => {
    expect(composite(WHITE, BLACK, 0.5)).toEqual([128, 128, 128]);
    expect(composite(WHITE, BLACK, 1)).toEqual(WHITE);
    expect(composite(WHITE, BLACK, 0)).toEqual(BLACK);
  });
});

describe('scrimAlphaFor', () => {
  const ink = hexToRgb(INK_ON_LIGHT_AIR);
  const veil = hexToRgb(INK_ON_DARK_AIR);

  it('asks for nothing when the background already carries the ink', () => {
    expect(scrimAlphaFor(WHITE, ink, veil)).toBe(0);
  });

  it('asks for a veil in the dead band between the two inks', () => {
    // A background at the demo's own flip point: too dark for ink, too light
    // for cream. This is the case the demo has no answer for.
    const atThreshold = [107, 107, 107]; // YIQ luma 0.42
    expect(contrastRatio(ink, atThreshold)).toBeLessThan(AA_BODY);
    expect(contrastRatio(veil, atThreshold)).toBeLessThan(AA_BODY);
    expect(scrimAlphaFor(atThreshold, ink, veil)).toBeGreaterThan(0);
  });

  it('returns an alpha that actually clears the target', () => {
    const bg = [120, 118, 110];
    const a = scrimAlphaFor(bg, ink, veil);
    const veiled = composite(veil, bg, a);
    expect(contrastRatio(ink, veiled)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrastRatio(composite(ink, veiled, DIM_ALPHA), veiled)).toBeGreaterThanOrEqual(AA_BODY);
  });
});

describe('inkPlan', () => {
  const MPLS = { lat: 44.98, lon: -93.27 };
  const at = (hourUTC, pm) => skyFor(pm, new Date(Date.UTC(2026, 7, 2, hourUTC)), MPLS.lat, MPLS.lon);

  it('keeps the demo ink on a clear afternoon and needs no scrim', () => {
    const plan = inkPlan(at(19, 3)); // ~2pm local
    expect(plan.isDark).toBe(false);
    expect(plan.ink).toBe(INK_ON_LIGHT_AIR);
    expect(plan.scrimPeak).toBe(0);
  });

  it('flips to cream in the middle of the night', () => {
    const plan = inkPlan(at(7, 3)); // ~2am local
    expect(plan.isDark).toBe(true);
    expect(plan.ink).toBe(INK_ON_DARK_AIR);
  });

  it('pairs a fill label with the opposite ink', () => {
    for (const h of [7, 19]) {
      const plan = inkPlan(at(h, 30));
      expect(plan.onAccent).toBe(plan.inkInverse);
      expect(contrastRatio(hexToRgb(plan.onAccent), hexToRgb(plan.accent))).toBeGreaterThanOrEqual(
        AA_BODY,
      );
    }
  });

  // The canvas colour is what iOS paints behind its bars, so it has to be the
  // sky as painted, not as authored. When the scrim is doing real work, the two
  // are far enough apart to read as a band.
  it('reports the top of the sky with the scrim already composited in', () => {
    for (const [lat, lon] of [
      [41.54, -73.3],
      [64.84, -147.72],
    ]) {
      for (const pm of [0, 20, 100]) {
        for (let h = 0; h < 24; h += 3) {
          const sky = skyFor(pm, new Date(Date.UTC(2026, 7, 14, h)), lat, lon);
          const plan = inkPlan(sky);
          const veil = hexToRgb(plan.inkInverse);
          const expected =
            plan.scrim[0] > 0 ? composite(veil, sky.zenithRGB, plan.scrim[0]) : sky.zenithRGB;
          expect(plan.canvasTop).toEqual([...expected]);
        }
      }
    }
  });

  // The invariant the whole module exists for. scripts/contrast-audit.mjs
  // runs the wide version of this; here it is small enough to be a unit test.
  it('holds 4.5:1 for every level at every hour, at both extremes of latitude', () => {
    for (const [lat, lon] of [
      [25.8, -80.2],
      [44.98, -93.27],
      [64.84, -147.72],
    ]) {
      for (const pm of [3, 20, 45, 100, 250]) {
        for (let h = 0; h < 24; h++) {
          for (const month of [0, 5]) {
            const plan = inkPlan(skyFor(pm, new Date(Date.UTC(2026, month, 21, h)), lat, lon));
            expect(plan.worstRatio).toBeGreaterThanOrEqual(AA_BODY);
            expect(plan.scrimPeak).toBeLessThanOrEqual(SCRIM_MAX);
          }
        }
      }
    }
  });
});
