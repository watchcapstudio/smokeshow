import { describe, expect, it } from 'vitest';
import { fanOutCell } from '../src/fanout.js';
import { createMemoryStore } from '../src/store.js';
import { DENVER, fakeDispatcher, seedDevice } from './helpers.js';

describe('notification type preferences', () => {
  it('suppresses a disabled incoming alert without disabling threshold crossings', async () => {
    const nowMs = Date.UTC(2026, 7, 2, 18);
    const store = createMemoryStore({ now: () => nowMs });
    const dispatcher = fakeDispatcher();
    await seedDevice(store, {
      id: 'selective',
      nowMs,
      notificationTypes: { inbound: false, peak: true, clear: true },
    });

    const summary = await fanOutCell({
      store,
      dispatcher,
      cellKey: DENVER,
      transition: {
        fromLevel: 0,
        toLevel: 0,
        direction: 'none',
        cleared: false,
        peakReached: false,
        incoming: true,
      },
      next: {
        levelIndex: 0,
        peakLevelIndex: 3,
        levelName: 'All clear',
        headline: 'Smoke arrives tonight',
        observedAtUTC: '2026-08-02T18:00:00Z',
        arrivalAtUTC: '2026-08-03T00:00:00Z',
        peakAtUTC: '2026-08-03T04:00:00Z',
        clearAtUTC: null,
        timezone: 'America/Denver',
      },
      nowMs,
    });

    expect(summary.matched).toBe(0);
    expect(summary.sent).toBe(0);
    expect(dispatcher.sent).toHaveLength(0);
  });
});
