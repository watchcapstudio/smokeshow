import { describe, it, expect } from 'vitest';
import { trendSlope, trendAt } from './trend.js';
import { computeVerdict } from './verdict.js';

// pm25 series where index 0 is "now" and index 6 is the 6-hour lookahead;
// everything past 6 is padding so the array index math never goes negative.
function seriesAt(now, ahead) {
  return [now, 0, 0, 0, 0, 0, ahead, ahead, ahead];
}

describe('trendSlope — 6-hour lookahead, deadband edges', () => {
  it('suppressed when both readings are below the 12 µg/m³ quiet floor', () => {
    expect(trendSlope(seriesAt(5, 11.9), 0)).toBe('steady');
    expect(trendSlope(seriesAt(11.9, 5), 0)).toBe('steady');
  });

  it('not suppressed once either reading reaches 12', () => {
    // now=12, ahead=16 -> delta=4 -> rising (also proves the floor check
    // uses max(now, ahead), not just `now`).
    expect(trendSlope(seriesAt(12, 16), 0)).toBe('rising');
  });

  it('deadband: a swing of less than 4 stays "steady"', () => {
    expect(trendSlope(seriesAt(20, 23.9), 0)).toBe('steady');
    expect(trendSlope(seriesAt(20, 16.1), 0)).toBe('steady');
  });

  it('deadband edge: +4 is "rising", -4 is "falling"', () => {
    expect(trendSlope(seriesAt(20, 24), 0)).toBe('rising');
    expect(trendSlope(seriesAt(20, 16), 0)).toBe('falling');
  });

  it('just inside the deadband (3.99) is still "steady"', () => {
    expect(trendSlope(seriesAt(20, 23.99), 0)).toBe('steady');
    expect(trendSlope(seriesAt(20, 16.01), 0)).toBe('steady');
  });

  it('clamps the lookahead to the end of the array instead of reading undefined', () => {
    const short = [20, 20, 20]; // no index 6 — lookahead clamps to the last index
    expect(() => trendSlope(short, 0)).not.toThrow();
    expect(trendSlope(short, 0)).toBe('steady');
  });
});

describe('trendAt — guarded against contradicting computeVerdict()', () => {
  it('without a verdict, behaves exactly like trendSlope', () => {
    const pm25 = seriesAt(20, 16);
    expect(trendAt(pm25, 0)).toBe(trendSlope(pm25, 0));
    expect(trendAt(pm25, 0, null)).toBe(trendSlope(pm25, 0));
  });

  it('mutes "falling" to "steady" when the verdict says no clear air is coming ("stuck")', () => {
    // Above threshold the whole window -> computeVerdict finds no clear.
    const stuckPm25 = new Array(60).fill(80);
    const verdict = computeVerdict({ pm25: stuckPm25, nowIndex: 12 });
    expect(verdict.trend).toBe('stuck');

    // But locally, PM2.5 dips over the next 6 hours -> raw slope is falling.
    const dippingPm25 = seriesAt(80, 60);
    expect(trendSlope(dippingPm25, 0)).toBe('falling');

    // The chip must never say "Improving" under a "no clear air" headline.
    expect(trendAt(dippingPm25, 0, verdict)).toBe('steady');
  });

  it('mutes "rising" to "steady" when the verdict already has a clear locked in ("clearing")', () => {
    const clearingPm25 = new Array(60).fill(80);
    for (let i = 20; i < 40; i++) clearingPm25[i] = 5; // sustained clear later
    const verdict = computeVerdict({ pm25: clearingPm25, nowIndex: 12 });
    expect(verdict.trend).toBe('clearing');

    const risingLocally = seriesAt(80, 100);
    expect(trendSlope(risingLocally, 0)).toBe('rising');

    expect(trendAt(risingLocally, 0, verdict)).toBe('steady');
  });

  it('passes through a rising/falling read that agrees with the verdict', () => {
    const worseningPm25 = seriesAt(10, 40); // arrival, slope rising
    const verdict = computeVerdict({ pm25: worseningPm25, nowIndex: 0 });
    expect(verdict.trend).toBe('worsening');
    expect(trendAt(worseningPm25, 0, verdict)).toBe('rising');
  });
});
