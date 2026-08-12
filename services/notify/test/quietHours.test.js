import { describe, it, expect } from 'vitest';
import { isQuiet, isWithinQuietWindow, localHourIn, passesQuietHours } from '../src/quietHours.js';
import { runEvaluation } from '../src/evaluate.js';
import { createMemoryStore } from '../src/store.js';
import { fakeDispatcher, flat, mockForecast, seedDevice, step } from './helpers.js';

const QUIET = { enabled: true, startHour: 22, endHour: 7 };

// 3 AM in Denver on 2026-08-03 is 09:00Z (MDT, UTC-6).
const THREE_AM_DENVER = Date.UTC(2026, 7, 3, 9, 0, 0);
const NOON_DENVER = Date.UTC(2026, 7, 2, 18, 0, 0);

describe('the quiet window', () => {
  it('wraps midnight', () => {
    expect(isWithinQuietWindow(23, 22, 7)).toBe(true);
    expect(isWithinQuietWindow(3, 22, 7)).toBe(true);
    expect(isWithinQuietWindow(7, 22, 7)).toBe(false);
    expect(isWithinQuietWindow(12, 22, 7)).toBe(false);
    expect(isWithinQuietWindow(21, 22, 7)).toBe(false);
  });

  it('handles a same-day window', () => {
    expect(isWithinQuietWindow(10, 9, 17)).toBe(true);
    expect(isWithinQuietWindow(18, 9, 17)).toBe(false);
  });

  it('treats an empty window as never quiet', () => {
    expect(isWithinQuietWindow(3, 8, 8)).toBe(false);
  });

  it('reads the hour in the subscriber zone, not the server zone', () => {
    expect(localHourIn('America/Denver', THREE_AM_DENVER)).toBe(3);
    expect(localHourIn('UTC', THREE_AM_DENVER)).toBe(9);
    expect(localHourIn('Australia/Sydney', THREE_AM_DENVER)).toBe(19);
  });

  it('falls back to UTC for an unknown zone rather than throwing', () => {
    expect(localHourIn('Mars/Olympus', THREE_AM_DENVER)).toBe(9);
  });

  it('is not quiet when the subscriber turned it off', () => {
    expect(isQuiet({ quietHours: { ...QUIET, enabled: false }, timezone: 'America/Denver', atMs: THREE_AM_DENVER })).toBe(
      false,
    );
  });
});

describe('the gate', () => {
  const device = { quietHours: QUIET, timezone: 'America/Denver' };

  it('drops a non-urgent alert at 3 AM', () => {
    expect(passesQuietHours({ event: { urgent: false }, device, atMs: THREE_AM_DENVER })).toBe(false);
  });

  it('lets an urgent alert through at 3 AM', () => {
    expect(passesQuietHours({ event: { urgent: true }, device, atMs: THREE_AM_DENVER })).toBe(true);
  });

  it('lets everything through at noon', () => {
    expect(passesQuietHours({ event: { urgent: false }, device, atMs: NOON_DENVER })).toBe(true);
  });

  it("uses the cell's zone when the device has not reported one", () => {
    const noZone = { quietHours: QUIET, timezone: null };
    expect(passesQuietHours({ event: { urgent: false }, device: noZone, timezone: 'America/Denver', atMs: THREE_AM_DENVER })).toBe(
      false,
    );
  });
});

describe('applied at fan-out, in a real run', () => {
  async function run({ nowMs, series }) {
    const store = createMemoryStore({ now: () => nowMs });
    const dispatcher = fakeDispatcher();
    await seedDevice(store, { id: 'sleeper', quietHours: QUIET, nowMs });

    let current = flat(4);
    const fetchForecast = async (cellKey) => mockForecast({ cellKey, series: current, nowMs });
    await runEvaluation({ store, dispatcher, fetchForecast, nowMs });
    current = series;
    const summary = await runEvaluation({ store, dispatcher, fetchForecast, nowMs });
    return { summary, dispatcher };
  }

  it('suppresses a middling 3 AM crossing entirely — no queue, no digest', async () => {
    // 4 -> 45 µg/m³: "Hazy". Worth a banner at noon, not at 3 AM.
    const { summary, dispatcher } = await run({ nowMs: THREE_AM_DENVER, series: step(4, 45) });

    expect(summary.matched).toBe(1);
    expect(summary.quietSuppressed).toBe(1);
    expect(summary.sent).toBe(0);
    expect(dispatcher.sent).toHaveLength(0);
  });

  it('wakes the subscriber for a Heavy-haze crossing at 3 AM', async () => {
    const { summary, dispatcher } = await run({ nowMs: THREE_AM_DENVER, series: step(4, 60) });

    expect(summary.sent).toBe(1);
    expect(dispatcher.sent[0].message.urgent).toBe(true);
  });

  it('sends the same middling crossing at noon', async () => {
    const { summary } = await run({ nowMs: NOON_DENVER, series: step(4, 45) });
    expect(summary.sent).toBe(1);
  });
});
