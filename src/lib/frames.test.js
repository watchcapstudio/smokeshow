import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SUPPORTED_MANIFEST_VERSION,
  domainCoversView,
  pickForView,
  domainContains,
  domainFrameURL,
  fetchFrames,
  fetchSeries,
  pickDomain,
} from './frames.js';

const HRRR = {
  id: 'hrrr',
  label: 'NOAA HRRR-Smoke',
  model: 'HRRR-Smoke near-surface',
  resolutionKm: 3,
  priority: 100,
  bounds: { latS: 24, latN: 50, lonW: -125, lonE: -66.5 },
  width: 1200,
  height: 680,
  wraps: false,
  series: 'series.json',
  frames: [
    { time: '2026-08-02T12:00', file: 'frame-20260802T12.png' },
    { time: '2026-08-02T13:00', file: 'frame-20260802T13.png' },
  ],
};

const CAMS = {
  id: 'cams',
  label: 'Copernicus CAMS global',
  model: 'CAMS global forecast',
  resolutionKm: 40,
  priority: 10,
  bounds: { latS: -60, latN: 75, lonW: -180, lonE: 180 },
  width: 1200,
  height: 639,
  wraps: true,
  frames: [
    { time: '2026-08-02T12:00', file: 'frame-20260802T12.png' },
    { time: '2026-08-02T13:00', file: 'frame-20260802T13.png' },
    { time: '2026-08-02T14:00', file: 'frame-20260802T14.png' },
  ],
};

function manifest(overrides = {}) {
  return { version: SUPPORTED_MANIFEST_VERSION, domains: [CAMS, HRRR], ...overrides };
}

// Order in the fixture is deliberately NOT priority order — fetchFrames sorts.
function stubFetch(map) {
  global.fetch = vi.fn(async (url) => {
    const key = Object.keys(map).find((k) => String(url).includes(k));
    if (key === undefined) return { ok: false, status: 404 };
    const v = map[key];
    return v === null ? { ok: false, status: 404 } : { ok: true, json: async () => v };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

describe('fetchFrames', () => {
  it('sorts domains sharpest-first and builds absolute frame URLs', async () => {
    stubFetch({ 'manifest.json': manifest() });
    const frames = await fetchFrames();
    expect(frames.domains.map((d) => d.id)).toEqual(['hrrr', 'cams']);
    expect(frames.domains[0].frameByTime.get('2026-08-02T12:00')).toMatch(
      /\/data\/hrrr\/frame-20260802T12\.png$/,
    );
  });

  it('does not fetch the series up front', async () => {
    stubFetch({ 'manifest.json': manifest() });
    const frames = await fetchFrames();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(frames.seriesDomain.id).toBe('hrrr');
  });

  // The contract change is the risk this file exists for: a client that
  // half-understands a manifest paints a plume in the wrong place.
  it('degrades to null on a manifest version it does not understand', async () => {
    stubFetch({ 'manifest.json': manifest({ version: 99 }) });
    expect(await fetchFrames()).toBeNull();
  });

  it('degrades to null on the pre-B11 single-bounds manifest', async () => {
    stubFetch({
      'manifest.json': { bounds: { latS: 24, latN: 50, lonW: -125, lonE: -66.5 }, frames: [] },
    });
    expect(await fetchFrames()).toBeNull();
  });

  it('degrades to null when no domain survives validation', async () => {
    stubFetch({ 'manifest.json': manifest({ domains: [{ id: 'broken', frames: [] }] }) });
    expect(await fetchFrames()).toBeNull();
  });

  it('throws when the manifest is unreachable, so the caller can ignore it', async () => {
    stubFetch({ 'manifest.json': null });
    await expect(fetchFrames()).rejects.toThrow(/404/);
  });
});

describe('domainContains', () => {
  it('accepts a point inside a bounded domain', () => {
    expect(domainContains(HRRR, 46.87, -113.99)).toBe(true); // Missoula
  });

  it('rejects points past the CONUS box that B11 exists for', () => {
    expect(domainContains(HRRR, 53.55, -113.49)).toBe(false); // Edmonton
    expect(domainContains(HRRR, 51.05, -114.07)).toBe(false); // Calgary
    expect(domainContains(HRRR, 40.42, -3.7)).toBe(false); // Madrid
  });

  it('keeps cities that were just inside, just inside', () => {
    expect(domainContains(HRRR, 43.65, -79.38)).toBe(true); // Toronto
    expect(domainContains(HRRR, 49.28, -123.12)).toBe(true); // Vancouver
  });

  it('treats a wrapping domain as covering every longitude', () => {
    expect(domainContains(CAMS, 0, 179.9)).toBe(true);
    expect(domainContains(CAMS, 0, -179.9)).toBe(true);
    expect(domainContains(CAMS, 0, 540)).toBe(true); // panned past the antimeridian
  });

  it('still clips a wrapping domain in latitude', () => {
    expect(domainContains(CAMS, 78, 15)).toBe(false); // Longyearbyen
    expect(domainContains(CAMS, 71.3, -156.8)).toBe(true); // Utqiagvik
  });
});

describe('pickDomain', () => {
  const frames = {
    domains: [HRRR, CAMS].map((d) => ({
      ...d,
      frameByTime: new Map(d.frames.map((f) => [f.time, `base/${d.id}/${f.file}`])),
    })),
  };

  it('lets HRRR keep winning inside CONUS', () => {
    expect(pickDomain(frames, '2026-08-02T12:00', 46.87, -113.99).domain.id).toBe('hrrr');
  });

  it('falls through to the global domain outside it', () => {
    expect(pickDomain(frames, '2026-08-02T12:00', 53.55, -113.49).domain.id).toBe('cams');
    expect(pickDomain(frames, '2026-08-02T12:00', 40.42, -3.7).domain.id).toBe('cams');
  });

  // A domain that covers the place but not the hour must not block a coarser
  // one that covers both — otherwise scrubbing past HRRR's run blanks CONUS.
  it('falls through when the sharp domain has no frame for that hour', () => {
    expect(pickDomain(frames, '2026-08-02T14:00', 46.87, -113.99).domain.id).toBe('cams');
  });

  it('returns null where nothing covers, so the caller can say so', () => {
    expect(pickDomain(frames, '2026-08-02T12:00', 85, 0)).toBeNull();
    expect(pickDomain(frames, '2026-08-02T20:00', 46.87, -113.99)).toBeNull();
    expect(pickDomain(null, '2026-08-02T12:00', 46.87, -113.99)).toBeNull();
  });

  it('keeps the crossfade inside one domain', () => {
    const pick = pickDomain(frames, '2026-08-02T12:00', 46.87, -113.99);
    expect(domainFrameURL(pick.domain, '2026-08-02T13:00')).toMatch(/hrrr/);
    expect(domainFrameURL(pick.domain, '2026-08-02T14:00')).toBeNull();
  });
});

describe('fetchSeries', () => {
  it('fetches for a reader inside the publishing domain', async () => {
    stubFetch({ 'series.json': { times: [] } });
    expect(await fetchSeries({ seriesDomain: HRRR }, 46.87, -113.99)).toEqual({ times: [] });
  });

  it('does not spend 2 MB telling a reader in Madrid they are not covered', async () => {
    stubFetch({ 'series.json': { times: [] } });
    expect(await fetchSeries({ seriesDomain: HRRR }, 40.42, -3.7)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null when no domain publishes a series', async () => {
    stubFetch({});
    expect(await fetchSeries({ seriesDomain: null }, 46.87, -113.99)).toBeNull();
  });
});

describe('pickForView', () => {
  const frames = {
    domains: [HRRR, CAMS].map((d) => ({
      ...d,
      frameByTime: new Map(d.frames.map((f) => [f.time, `base/${d.id}/${f.file}`])),
    })),
  };
  const T = '2026-08-02T12:00';
  const box = (south, north, west, east) => ({ south, north, west, east });

  it('uses the sharp domain when it fills the viewport', () => {
    // zoomed in on Missoula, nowhere near the 50 N edge
    expect(pickForView(frames, T, box(46.5, 47.2, -114.4, -113.6)).domain.id).toBe('hrrr');
  });

  // The whole point: a viewport that can see past HRRR's edge gets ONE
  // consistent field instead of a rectangle drawn across Montana.
  it('switches to the global field as soon as the edge would be visible', () => {
    expect(pickForView(frames, T, box(43, 52, -120, -105)).domain.id).toBe('cams');
  });

  it('switches on the west edge too, not just the north', () => {
    expect(pickForView(frames, T, box(40, 46, -130, -120)).domain.id).toBe('cams');
  });

  it('falls back to the widest domain when nothing contains the viewport', () => {
    // past CAMS's own 75 N limit — still paint the global field, not nothing
    expect(pickForView(frames, T, box(60, 80, -20, 20)).domain.id).toBe('cams');
  });

  it('returns null when no domain has the hour', () => {
    expect(pickForView(frames, '2026-08-02T20:00', box(46.5, 47.2, -114.4, -113.6))).toBeNull();
  });
});

describe('domainCoversView', () => {
  const box = (south, north, west, east) => ({ south, north, west, east });

  it('is false when the viewport spills past a bounded domain', () => {
    expect(domainCoversView(HRRR, box(46, 52, -114, -113))).toBe(false);
  });

  it('is true when the viewport sits inside it', () => {
    expect(domainCoversView(HRRR, box(46, 47, -114, -113))).toBe(true);
  });

  it('does not claim a wrapping domain covers a view past its latitude limit', () => {
    expect(domainCoversView(CAMS, box(70, 80, -10, 10))).toBe(false);
    expect(domainCoversView(CAMS, box(-50, 70, -180, 180))).toBe(true);
  });

  it('refuses a viewport panned across the antimeridian for a bounded domain', () => {
    expect(domainCoversView(HRRR, box(40, 45, 170, -170))).toBe(false);
  });
});
