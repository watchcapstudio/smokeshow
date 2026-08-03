import { describe, it, expect } from 'vitest';
import {
  MANIFEST_VERSION,
  adoptManifest,
  containsPoint,
  coverageAt,
  fetchSmokeFrames,
  frameAt,
  hrrrSeriesAt,
} from './smokeFrames.js';

const CONUS = { latS: 24, latN: 50, lonW: -125, lonE: -66.5 };
const WORLD = { latS: -60, latN: 75, lonW: -180, lonE: 180 };

const HOUR = '2026-08-02T18:00';

const hrrrManifest = (over = {}) => ({
  generated: '2026-08-02T22:45:02Z',
  model: 'HRRR-Smoke near-surface (MASSDEN, 8m AGL)',
  run: '2026-08-02T18:00',
  bounds: CONUS,
  width: 1200,
  height: 680,
  frames: [{ time: HOUR, file: 'frame-20260802T18.png' }],
  ...over,
});

const camsManifest = (over = {}) => ({
  v: 2,
  key: 'cams-global',
  model: 'CAMS global atmospheric composition forecast (PM2.5)',
  label: '40 km global model',
  resolutionKm: 44,
  priority: 1,
  generated: '2026-08-02T22:45:02Z',
  run: '2026-08-02T12:00',
  bounds: WORLD,
  width: 1800,
  height: 958,
  frames: [{ time: HOUR, file: 'frame-20260802T18.png' }],
  ...over,
});

// Denver is inside CONUS; Edmonton is the city the CONUS box cuts off, and the
// reason B11 exists.
const DENVER = [39.74, -104.99];
const EDMONTON = [53.55, -113.49];
const MADRID = [40.42, -3.7];

function mockFetch({ hrrr = hrrrManifest(), cams = camsManifest(), series = null } = {}) {
  return async (url) => {
    const body =
      url.includes('/hrrr/manifest') ? hrrr : url.includes('/cams/manifest') ? cams : series;
    if (body === null || body === undefined) return { ok: false, status: 404 };
    return { ok: true, json: async () => body };
  };
}

describe('containsPoint', () => {
  it('knows Denver is in CONUS and Edmonton is not', () => {
    expect(containsPoint(CONUS, ...DENVER)).toBe(true);
    expect(containsPoint(CONUS, ...EDMONTON)).toBe(false);
    expect(containsPoint(WORLD, ...EDMONTON)).toBe(true);
  });

  it('rejects nonsense rather than guessing', () => {
    expect(containsPoint(null, ...DENVER)).toBe(false);
    expect(containsPoint(CONUS, NaN, -105)).toBe(false);
    expect(containsPoint({ latS: 50, latN: 24, lonW: -125, lonE: -66.5 }, ...DENVER)).toBe(false);
  });
});

describe('adoptManifest — the contract boundary', () => {
  it('adopts a v2 manifest with its declared metadata', () => {
    const d = adoptManifest('cams', camsManifest());
    expect(d).toMatchObject({ key: 'cams-global', label: '40 km global model', priority: 1 });
    expect(d.frameByTime.get(HOUR)).toContain('/cams/frame-20260802T18.png');
  });

  it('adopts the legacy unversioned HRRR manifest so the sharp field is not stranded', () => {
    const d = adoptManifest('hrrr', hrrrManifest());
    expect(d).toMatchObject({ key: 'hrrr-conus', label: '3 km smoke model', resolutionKm: 3 });
    expect(d.priority).toBeGreaterThan(adoptManifest('cams', camsManifest()).priority);
  });

  it('refuses a manifest version it does not understand', () => {
    expect(adoptManifest('cams', camsManifest({ v: 3 }))).toBeNull();
    expect(adoptManifest('cams', camsManifest({ v: 99 }))).toBeNull();
    // An unversioned manifest is only ever the known legacy HRRR one.
    expect(adoptManifest('cams', camsManifest({ v: undefined }))).toBeNull();
  });

  it('refuses a v2 manifest missing the metadata the UI depends on', () => {
    expect(adoptManifest('cams', camsManifest({ label: undefined }))).toBeNull();
    expect(adoptManifest('cams', camsManifest({ key: undefined }))).toBeNull();
    expect(adoptManifest('cams', camsManifest({ priority: undefined }))).toBeNull();
  });

  it('refuses a manifest with unusable bounds or no frames', () => {
    expect(adoptManifest('cams', camsManifest({ bounds: undefined }))).toBeNull();
    expect(adoptManifest('cams', camsManifest({ bounds: { latS: 1 } }))).toBeNull();
    expect(adoptManifest('cams', camsManifest({ frames: [] }))).toBeNull();
    expect(adoptManifest('cams', camsManifest({ frames: [{ time: HOUR }] }))).toBeNull();
    expect(adoptManifest('cams', null)).toBeNull();
  });
});

describe('frameAt — sharpest field that covers this place and hour', () => {
  it('prefers HRRR inside CONUS', async () => {
    const frames = await fetchSmokeFrames({ fetchImpl: mockFetch() });
    expect(frameAt(frames, HOUR, ...DENVER).domain.key).toBe('hrrr-conus');
  });

  it('uses the global field where HRRR does not reach', async () => {
    const frames = await fetchSmokeFrames({ fetchImpl: mockFetch() });
    expect(frameAt(frames, HOUR, ...EDMONTON).domain.key).toBe('cams-global');
    expect(frameAt(frames, HOUR, ...MADRID).domain.key).toBe('cams-global');
  });

  it('does not pin a CONUS image over a reader it does not cover', async () => {
    // The bug this replaces: the old check was time-only, so an Edmonton
    // reader got the CONUS overlay and no smoke drawn over them at all.
    const frames = await fetchSmokeFrames({ fetchImpl: mockFetch({ cams: null }) });
    expect(frameAt(frames, HOUR, ...DENVER)).not.toBeNull();
    expect(frameAt(frames, HOUR, ...EDMONTON)).toBeNull();
  });

  it('falls through to the coarse field for an hour the sharp one lacks', async () => {
    const frames = await fetchSmokeFrames({
      fetchImpl: mockFetch({
        cams: camsManifest({
          frames: [
            { time: HOUR, file: 'a.png' },
            { time: '2026-08-04T06:00', file: 'b.png' },
          ],
        }),
      }),
    });
    // Past the end of the HRRR run, still inside CONUS.
    expect(frameAt(frames, '2026-08-04T06:00', ...DENVER).domain.key).toBe('cams-global');
  });

  it('returns null for an hour nobody has', async () => {
    const frames = await fetchSmokeFrames({ fetchImpl: mockFetch() });
    expect(frameAt(frames, '2030-01-01T00:00', ...DENVER)).toBeNull();
  });
});

describe('degradation', () => {
  it('survives one domain being unreachable', async () => {
    const frames = await fetchSmokeFrames({ fetchImpl: mockFetch({ hrrr: null }) });
    expect(frames.domains.map((d) => d.key)).toEqual(['cams-global']);
  });

  it('returns null when no domain is usable, so the caller draws the point grid', async () => {
    const frames = await fetchSmokeFrames({ fetchImpl: mockFetch({ hrrr: null, cams: null }) });
    expect(frames).toBeNull();
  });

  it('returns null when every manifest is a version it does not understand', async () => {
    const frames = await fetchSmokeFrames({
      fetchImpl: mockFetch({ hrrr: hrrrManifest({ v: 7 }), cams: camsManifest({ v: 7 }) }),
    });
    expect(frames).toBeNull();
  });

  it('survives a fetch that throws', async () => {
    const frames = await fetchSmokeFrames({
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    expect(frames).toBeNull();
  });

  it('still serves frames when the agreement series is missing', async () => {
    const frames = await fetchSmokeFrames({ fetchImpl: mockFetch({ series: null }) });
    expect(frames.series).toBeNull();
    expect(frameAt(frames, HOUR, ...DENVER)).not.toBeNull();
  });
});

describe('coverageAt — telling the reader what they are looking at', () => {
  it('names the sharp field and the coarse one', async () => {
    const frames = await fetchSmokeFrames({ fetchImpl: mockFetch() });
    expect(coverageAt(frames, HOUR, ...DENVER)).toEqual({
      key: 'hrrr-conus',
      label: '3 km smoke model',
      resolutionKm: 3,
    });
    expect(coverageAt(frames, HOUR, ...EDMONTON).label).toBe('40 km global model');
  });

  it('is null when the point grid is painting, so the UI can say so', async () => {
    const frames = await fetchSmokeFrames({ fetchImpl: mockFetch({ cams: null }) });
    expect(coverageAt(frames, HOUR, ...EDMONTON)).toBeNull();
  });

  it('assumes MANIFEST_VERSION is the shape the renderers write', () => {
    expect(MANIFEST_VERSION).toBe(2);
  });
});

describe('hrrrSeriesAt is unchanged', () => {
  const series = {
    lat0: 25,
    lon0: -124,
    dlat: 1,
    dlon: 1,
    nlat: 25,
    nlon: 58,
    times: ['2026-08-02T18:00', '2026-08-02T19:00'],
    values: [
      Array.from({ length: 25 }, () => Array.from({ length: 58 }, () => 12)),
      Array.from({ length: 25 }, () => Array.from({ length: 58 }, () => -1)),
    ],
  };

  it('reads the nearest cell inside CONUS', () => {
    expect(hrrrSeriesAt(series, ...DENVER).get('2026-08-02T18:00')).toBe(12);
  });

  it('drops the sentinel for hours outside the domain', () => {
    expect(hrrrSeriesAt(series, ...DENVER).has('2026-08-02T19:00')).toBe(false);
  });

  it('is null outside the grid entirely', () => {
    expect(hrrrSeriesAt(series, ...EDMONTON)).toBeNull();
    expect(hrrrSeriesAt(null, ...DENVER)).toBeNull();
  });
});
