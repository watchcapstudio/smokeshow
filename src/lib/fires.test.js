import { describe, expect, it } from 'vitest';
import {
  detectionAgeMs,
  fireIconPx,
  fireLegendText,
  fireOpacity,
  fireSummary,
  formatAge,
  mergeClusters,
  mergePxForZoom,
  minDetectionsForZoom,
  normalizeFires,
  MAX_ICONS,
} from './fires.js';

const raw = (clusters) => ({
  generated: '2026-08-02T18:00:00Z',
  sensors: ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT'],
  windowHours: 24,
  linkKm: 10,
  clusters,
});

describe('normalizeFires', () => {
  it('expands the positional cluster rows', () => {
    const f = normalizeFires(raw([[57.6, -122.8, 3828, 500470.4, 120, 1064]]));
    expect(f.clusters[0]).toEqual({
      lat: 57.6,
      lon: -122.8,
      n: 3828,
      frp: 500470.4,
      age: 120,
      hi: 1064,
    });
    expect(f.generatedMs).toBe(Date.parse('2026-08-02T18:00:00Z'));
  });

  it('returns null for absent or malformed data', () => {
    expect(normalizeFires(null)).toBeNull();
    expect(normalizeFires({})).toBeNull();
  });
});

describe('detectionAgeMs', () => {
  const fires = normalizeFires(raw([[50, -100, 5, 12, 180, 2]]));

  it('adds the age of the file to the age of the detection', () => {
    // Detection was 180 min before the file was built; the file is 2h old.
    const now = fires.generatedMs + 2 * 3_600_000;
    expect(detectionAgeMs(fires.clusters[0], fires.generatedMs, now)).toBe(5 * 3_600_000);
  });

  it('never reports a negative age from a clock skewed backwards', () => {
    const now = fires.generatedMs - 60_000;
    expect(detectionAgeMs(fires.clusters[0], fires.generatedMs, now)).toBe(180 * 60_000);
  });
});

describe('formatAge', () => {
  it('reads minutes under the hour and hours above it', () => {
    expect(formatAge(42 * 60_000)).toBe('42m ago');
    expect(formatAge(3 * 3_600_000 + 10 * 60_000)).toBe('3h 10m ago');
    expect(formatAge(3 * 3_600_000)).toBe('3h ago');
    expect(formatAge(19 * 3_600_000 + 30 * 60_000)).toBe('19h ago');
  });
});

describe('fireIconPx', () => {
  it('rises with detection count on a log scale, bounded at both ends', () => {
    expect(fireIconPx(1)).toBe(9);
    expect(fireIconPx(10)).toBe(16);
    expect(fireIconPx(100)).toBe(23);
    expect(fireIconPx(4000)).toBe(32); // clamped — a complex cannot eat the map
    const sizes = [1, 5, 50, 500, 5000].map((n) => fireIconPx(n));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  it('shrinks and fades zoomed in, where the centroid means least', () => {
    expect(fireIconPx(100, 11)).toBeLessThan(fireIconPx(100, 6));
    expect(fireOpacity(11)).toBeLessThan(fireOpacity(6));
  });
});

describe('zoom thresholds', () => {
  it('merges harder and hides more the further out you are', () => {
    expect(mergePxForZoom(4)).toBeGreaterThan(mergePxForZoom(6));
    expect(mergePxForZoom(6)).toBeGreaterThan(mergePxForZoom(9));
    expect(minDetectionsForZoom(4)).toBeGreaterThan(minDetectionsForZoom(7));
    // Zoomed right in, nothing is hidden — the floor is an editorial choice
    // about continental scale, not a permanent filter on the data.
    expect(minDetectionsForZoom(9)).toBe(1);
    expect(minDetectionsForZoom(12)).toBe(1);
  });
});

describe('fireLegendText', () => {
  it('names the number of clusters the zoom floor is hiding', () => {
    expect(fireLegendText(0)).toBe(
      'Satellite heat detections, last 24h — not confirmed fires',
    );
    expect(fireLegendText(41)).toContain('zoom in for 41 smaller');
  });
});

describe('mergeClusters', () => {
  // 1 degree of longitude = 10 screen px, so distances are easy to reason about.
  const project = (lat, lon) => ({ x: lon * 10, y: lat * 10 });

  it('merges clusters that would overlap on screen and sums their detections', () => {
    const merged = mergeClusters(
      [
        { lat: 0, lon: 0, n: 100, frp: 10, age: 60, hi: 40 },
        { lat: 0, lon: 1, n: 20, frp: 2, age: 30, hi: 5 }, // 10px away
        { lat: 0, lon: 20, n: 7, frp: 1, age: 90, hi: 1 }, // 200px away
      ],
      project,
      28,
    );
    expect(merged).toHaveLength(2);
    expect(merged[0].n).toBe(120);
    expect(merged[0].hi).toBe(45);
    expect(merged[0].parts).toBe(2);
    // The freshest detection in the group wins — a merge must not age a fire.
    expect(merged[0].age).toBe(30);
    // Anchored on the biggest member, not drifted to a midpoint.
    expect(merged[0].lon).toBe(0);
    expect(merged[1].n).toBe(7);
  });

  it('keeps clusters apart once they are further than the merge radius', () => {
    const merged = mergeClusters(
      [
        { lat: 0, lon: 0, n: 5, frp: 1, age: 10, hi: 1 },
        { lat: 0, lon: 3, n: 5, frp: 1, age: 10, hi: 1 }, // 30px > 28px
      ],
      project,
      28,
    );
    expect(merged).toHaveLength(2);
  });

  it('is bounded, so a fire season cannot flood the DOM', () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({
      lat: (i % 50) * 5,
      lon: Math.floor(i / 50) * 5,
      n: i + 1,
      frp: 1,
      age: 10,
      hi: 0,
    }));
    const merged = mergeClusters(many, project, 28);
    expect(merged.length).toBeLessThanOrEqual(MAX_ICONS);
    // What survives the cap is the largest, not an arbitrary slice.
    expect(merged[0].n).toBe(2000);
  });

  it('drops clusters the projection cannot place', () => {
    const merged = mergeClusters(
      [{ lat: 0, lon: 0, n: 5, frp: 1, age: 10, hi: 1 }],
      () => ({ x: NaN, y: 0 }),
      28,
    );
    expect(merged).toHaveLength(0);
  });
});

describe('fireSummary', () => {
  const fires = normalizeFires(raw([[57.6, -122.8, 400, 5000, 130, 100]]));

  it('says heat detection, never fire, and never claims a size or a name', () => {
    const s = fireSummary(
      { ...fires.clusters[0], parts: 1 },
      fires,
      fires.generatedMs + 3_600_000,
    );
    expect(s.title).toBe('400 heat detections');
    expect(s.age).toBe('3h 10m ago');
    const text = s.lines.join(' ');
    expect(text).toContain('25% high confidence');
    expect(text).toContain('not a confirmed fire');
    expect(text).toContain('no name, perimeter, size or containment');
    expect(text).toContain('about 10 km');
    expect(text).not.toMatch(/\bacres?\b/i);
    expect(text).not.toMatch(/\bcontained\b/i);
  });

  it('does not pluralise a single detection', () => {
    const one = normalizeFires(raw([[1, 1, 1, 2, 0, 0]]));
    expect(fireSummary({ ...one.clusters[0], parts: 1 }, one).title).toBe(
      '1 heat detection',
    );
  });
});
