import { describe, it, expect } from 'vitest';
import { computeVerdict, verdictHeadline } from './verdict.js';

// Builds a 60-hour PM2.5 series: `base` everywhere, with `spikes` (an array of
// [startHour, endHour, value] relative to nowIndex=12) overlaid on top.
function series(base, spikes = [], length = 60) {
  const pm25 = new Array(length).fill(base);
  for (const [start, end, value] of spikes) {
    for (let i = start; i < end; i++) pm25[12 + i] = value;
  }
  return pm25;
}

describe('computeVerdict — 6-hour clear hold', () => {
  it('ignores a dip below threshold shorter than 6 hours (head-fake)', () => {
    // Above threshold now, dips to 10 for only 5 hours (h1..h6), then back up.
    const pm25 = series(40, [[1, 6, 10]]);
    const v = computeVerdict({ pm25, nowIndex: 12 });
    expect(v.above).toBe(true);
    expect(v.clearIdx).toBeNull();
  });

  it('registers a clear once the dip holds for exactly 6 consecutive hours', () => {
    const pm25 = series(40, [[1, 7, 10]]); // hours 1..6 (6 hours) below 35
    const v = computeVerdict({ pm25, nowIndex: 12 });
    expect(v.above).toBe(true);
    expect(v.clearIdx).toBe(13); // nowIndex(12) + 1
  });

  it('skips a brief dip and finds the later sustained clear', () => {
    const pm25 = series(
      40,
      [
        [1, 2, 10], // 1-hour head-fake dip
        [10, 20, 5], // real, sustained clear starting hour 10
      ],
    );
    const v = computeVerdict({ pm25, nowIndex: 12 });
    expect(v.above).toBe(true);
    expect(v.clearIdx).toBe(22); // nowIndex(12) + 10
  });

  it('a 5-hour-then-rise-then-5-hour dip never sustains 6 hours and stays "stuck"', () => {
    const pm25 = series(40, [
      [1, 6, 10],
      [7, 12, 10],
    ]);
    const v = computeVerdict({ pm25, nowIndex: 12 });
    expect(v.clearIdx).toBeNull();
    expect(v.trend).toBe('stuck');
  });
});

describe('computeVerdict — 3-hour arrival hold', () => {
  it('ignores a spike above threshold shorter than 3 hours (head-fake)', () => {
    const pm25 = series(10, [[1, 3, 40]]); // only 2 hours above 35
    const v = computeVerdict({ pm25, nowIndex: 12 });
    expect(v.above).toBe(false);
    expect(v.arrivalIdx).toBeNull();
  });

  it('registers an arrival once the spike holds for exactly 3 consecutive hours', () => {
    const pm25 = series(10, [[1, 4, 40]]); // hours 1..3 (3 hours) above 35
    const v = computeVerdict({ pm25, nowIndex: 12 });
    expect(v.above).toBe(false);
    expect(v.arrivalIdx).toBe(13);
    expect(v.trend).toBe('worsening');
  });

  it('skips a brief spike and finds the later sustained arrival', () => {
    const pm25 = series(10, [
      [1, 2, 40], // 1-hour head-fake spike
      [8, 20, 45], // real, sustained arrival starting hour 8
    ]);
    const v = computeVerdict({ pm25, nowIndex: 12 });
    expect(v.arrivalIdx).toBe(20); // nowIndex(12) + 8
  });
});

describe('computeVerdict — trend + headline', () => {
  it('reports "clearing" when above and a clear is found, "stuck" otherwise', () => {
    const clearing = computeVerdict({ pm25: series(40, [[1, 10, 5]]), nowIndex: 12 });
    expect(clearing.trend).toBe('clearing');

    const stuck = computeVerdict({ pm25: series(40), nowIndex: 12 });
    expect(stuck.trend).toBe('stuck');
  });

  it('reports "steady" when below threshold and no arrival is found', () => {
    const v = computeVerdict({ pm25: series(5), nowIndex: 12 });
    expect(v.trend).toBe('steady');
    expect(v.arrivalIdx).toBeNull();
  });

  it('headline: "No clear air" only when above with no clearIdx', () => {
    const v = computeVerdict({ pm25: series(200), nowIndex: 12 });
    expect(verdictHeadline(v, () => '???')).toBe('No clear air as far as the forecast goes');
  });

  it('headline: clear/arrival format the crossing index via formatIdx', () => {
    const clearing = computeVerdict({ pm25: series(40, [[1, 10, 5]]), nowIndex: 12 });
    expect(verdictHeadline(clearing, (i) => `IDX${i}`)).toBe(`Clears IDX${clearing.clearIdx}`);

    const arriving = computeVerdict({ pm25: series(10, [[1, 5, 40]]), nowIndex: 12 });
    expect(verdictHeadline(arriving, (i) => `IDX${i}`)).toBe(`Smoke arrives IDX${arriving.arrivalIdx}`);
  });

  it('headline: distinguishes "clear" (already all-clear) from "below the fire line" (elevated but sub-threshold)', () => {
    const allClear = computeVerdict({ pm25: series(5), nowIndex: 12 });
    expect(verdictHeadline(allClear, () => '???')).toBe('Clear as far as the forecast goes');

    const elevatedButBelow = computeVerdict({ pm25: series(20), nowIndex: 12 });
    expect(verdictHeadline(elevatedButBelow, () => '???')).toBe(
      'Below Hazy as far as the forecast goes'
    );
  });

  // The bug these strings were rewritten to fix: a reader cannot tell a number
  // the model found ("Clears Thursday ~6 PM") from a number that is just the
  // width of the window, so the second one gets read as an event.
  it('headline: no-crossing verdicts never count the window', () => {
    const noCrossing = [
      computeVerdict({ pm25: series(200), nowIndex: 12 }),
      computeVerdict({ pm25: series(5), nowIndex: 12 }),
      computeVerdict({ pm25: series(20), nowIndex: 12 }),
    ];
    for (const v of noCrossing) {
      const headline = verdictHeadline(v, () => '???');
      expect(headline).toContain('as far as the forecast goes');
      expect(headline).not.toMatch(/\d/);
    }
  });
});
