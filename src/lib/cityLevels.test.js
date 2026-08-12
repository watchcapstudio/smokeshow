import { describe, expect, it } from 'vitest';
import { buildLevelsPayload, nowIndexFor, applyCityLevels, LEVELS_CONTRACT_VERSION } from './cityLevels.js';
import { levelForPM25 } from './rating.js';

const HOURS = Array.from({ length: 24 }, (_, i) => `2026-08-11T${String(i).padStart(2, '0')}:00`);
const at = (h) => Date.parse(`2026-08-11T${String(h).padStart(2, '0')}:00Z`);
const series = (values) => ({ hourly: { time: HOURS, pm2_5: values } });

describe('nowIndexFor', () => {
  it('finds the exact UTC hour', () => {
    expect(nowIndexFor(HOURS, at(14))).toBe(14);
  });

  // Upstream has been seen starting the series an hour off. Index 0 would report
  // midnight's air as current, which on a clearing night is badly wrong.
  it('falls back to the last hour that is not in the future', () => {
    const shifted = HOURS.slice(5);
    expect(nowIndexFor(shifted, at(14))).toBe(9); // 05:00 + 9 = 14:00
  });
});

describe('buildLevelsPayload', () => {
  const cities = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];

  it('reports the level the city page would report for the same value', () => {
    const values = Array(24).fill(0);
    values[14] = 20; // In the air
    const p = buildLevelsPayload({ cities: [cities[0]], series: [series(values)], nowMs: at(14) });
    expect(p.v).toBe(LEVELS_CONTRACT_VERSION);
    expect(p.cities[0]).toEqual({ slug: 'a', key: levelForPM25(20).key, name: levelForPM25(20).name });
  });

  // The whole point of the endpoint: the directory and the city page must not be
  // able to disagree, so this asserts against levelForPM25 across the thresholds
  // rather than against hardcoded names.
  it('agrees with levelForPM25 at every threshold', () => {
    for (const pm of [0, 11.9, 12, 34.9, 35, 54.9, 55, 149.9, 150, 400]) {
      const values = Array(24).fill(0);
      values[14] = pm;
      const p = buildLevelsPayload({ cities: [cities[0]], series: [series(values)], nowMs: at(14) });
      expect(p.cities[0].name, `pm=${pm}`).toBe(levelForPM25(pm).name);
    }
  });

  // An absent chip reads as "not known". A defaulted one would read as All clear,
  // which is the exact failure this file exists to prevent.
  it('omits a city rather than defaulting it when the value is missing', () => {
    const good = Array(24).fill(0);
    good[14] = 40;
    const p = buildLevelsPayload({
      cities,
      series: [series(good), { hourly: { time: HOURS, pm2_5: Array(24).fill(null) } }, {}],
      nowMs: at(14),
    });
    expect(p.cities.map((c) => c.slug)).toEqual(['a']);
  });

  it('stamps asOf with the instant the reading is for', () => {
    const values = Array(24).fill(5);
    const p = buildLevelsPayload({ cities: [cities[0]], series: [series(values)], nowMs: at(14) });
    expect(p.asOf).toBe(new Date(at(14)).toISOString());
  });
});

describe('applyCityLevels', () => {
  // Minimal stand-in for the bits of the DOM this touches, so the test does not
  // need a browser environment.
  function fakeDoc(slugs) {
    const slots = new Map(
      slugs.map((s) => [s, { textContent: '', dataset: {} }]),
    );
    return {
      slots,
      querySelector: (sel) => slots.get(sel.match(/"([^"]+)"/)?.[1]) ?? null,
    };
  }

  it('fills only the rows the page has', () => {
    const doc = fakeDoc(['a', 'b']);
    const filled = applyCityLevels(doc, {
      v: LEVELS_CONTRACT_VERSION,
      asOf: '2026-08-11T14:00:00.000Z',
      cities: [
        { slug: 'a', key: 'something', name: 'In the air' },
        { slug: 'zz', key: 'smells', name: 'Hazy' },
      ],
    }, { timeZone: 'UTC' });
    expect(filled).toBe(1);
    expect(doc.slots.get('a').textContent).toContain('In the air');
    expect(doc.slots.get('a').textContent).toMatch(/\d{1,2}:\d{2}/); // carries a time
    expect(doc.slots.get('b').textContent).toBe('');
  });

  // A future contract bump must not half-render an old page.
  it('refuses a payload from a version it does not understand', () => {
    const doc = fakeDoc(['a']);
    expect(applyCityLevels(doc, { v: 99, cities: [{ slug: 'a', name: 'x', key: 'y' }] })).toBe(0);
    expect(applyCityLevels(doc, null)).toBe(0);
  });
});
