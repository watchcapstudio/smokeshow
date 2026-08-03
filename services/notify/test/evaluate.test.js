import { describe, it, expect } from 'vitest';
import { runEvaluation } from '../src/evaluate.js';
import { createMemoryStore } from '../src/store.js';
import { DENVER, HOUR_MS, fakeDispatcher, flat, mockForecast, seedDevice, step } from './helpers.js';

// The integration tests that matter. Duplicate smoke alerts at 3 AM lose the
// subscription, so "exactly one notification per device per state change" is
// the property this whole service is arranged around — it is asserted here
// against the real evaluation loop, the real diff, and the real fan-out.

const NOW = Date.UTC(2026, 7, 2, 18, 0, 0); // 2026-08-02 18:00Z — noon in Denver

function harness({ nowMs = NOW } = {}) {
  const store = createMemoryStore({ now: () => nowMs });
  const dispatcher = fakeDispatcher();
  const fetches = [];
  let series = flat(4);

  const fetchForecast = async (cellKey) => {
    fetches.push(cellKey);
    return mockForecast({ cellKey, series, nowMs });
  };

  return {
    store,
    dispatcher,
    fetches,
    setSeries(next) {
      series = next;
    },
    run(overrides = {}) {
      return runEvaluation({ store, dispatcher, fetchForecast, nowMs, ...overrides });
    },
  };
}

describe('one state change, one notification per device', () => {
  it('sends exactly one notification to each subscribed device and no more', async () => {
    const h = harness();
    await seedDevice(h.store, { id: 'dev-a', platform: 'ios' });
    await seedDevice(h.store, { id: 'dev-b', platform: 'android' });
    await seedDevice(h.store, { id: 'dev-c', platform: 'macos' });

    // Run 1 seeds the cell at "All clear". Subscribing is not a state change.
    const seed = await h.run();
    expect(seed.cells).toBe(1);
    expect(seed.seeded).toBe(1);
    expect(h.dispatcher.sent).toHaveLength(0);

    // Run 2: the air crosses from All clear (4 µg/m³) to Tastes like fire (60).
    h.setSeries(step(4, 60));
    const changed = await h.run();

    expect(changed.changed).toBe(1);
    expect(changed.sent).toBe(3);
    expect(h.dispatcher.sent).toHaveLength(3);

    const perDevice = h.dispatcher.sent.map((s) => s.deviceId).sort();
    expect(perDevice).toEqual(['dev-a', 'dev-b', 'dev-c']);
    expect(new Set(perDevice).size).toBe(3); // one each, not three to one

    // Every message carries the server's verdict verbatim — no clear-time is
    // recomputed here (contract §6).
    for (const { message } of h.dispatcher.sent) {
      expect(message.title).toBe('Tastes like fire in Home');
      expect(message.body).toMatch(/^(Clears |No clear air)/);
      expect(message.data.type).toBe('threshold-crossed');
      expect(message.data.levelIndex).toBe(3);
    }
  });

  it('sends nothing on a re-run of the same model state', async () => {
    const h = harness();
    await seedDevice(h.store, { id: 'dev-a' });
    await h.run();
    h.setSeries(step(4, 60));
    await h.run();
    expect(h.dispatcher.sent).toHaveLength(1); // one device, one send

    const again = await h.run();
    expect(again.unchanged).toBe(1);
    expect(again.sent).toBe(0);
    expect(h.dispatcher.sent).toHaveLength(1);
  });

  it('does not duplicate when a run crashes after fan-out but before the state write', async () => {
    const h = harness();
    await seedDevice(h.store, { id: 'dev-a' });
    await h.run();

    const before = await h.store.getCellState(DENVER);
    h.setSeries(step(4, 60));
    await h.run();
    expect(h.dispatcher.sent).toHaveLength(1);

    // Simulate the crash: the sends went out, the new state never landed.
    await h.store.putCellState(DENVER, before);
    const replay = await h.run();

    expect(replay.changed).toBe(1);
    expect(replay.deduped).toBe(1); // the claim from the first pass held
    expect(h.dispatcher.sent).toHaveLength(1);
  });

  it('collapses two subscriptions to the same cell into one notification', async () => {
    const h = harness();
    // "Home" and "the office" three miles apart — same air, same lattice cell.
    const device = await seedDevice(h.store, { id: 'dev-a', label: 'Home' });
    await h.store.updateDevice(device.id, {
      locations: [
        ...device.locations,
        { label: 'Office', lat: 39.7442, lon: -104.9853, cellKey: DENVER, threshold: null },
      ],
    });

    await h.run();
    h.setSeries(step(4, 60));
    await h.run();

    expect(h.dispatcher.sent).toHaveLength(1);
  });
});

describe('dedupe by lattice — the cost model', () => {
  it('evaluates ten thousand Denver subscribers with a single forecast fetch', async () => {
    const h = harness();
    for (let i = 0; i < 10_000; i++) {
      await seedDevice(h.store, { id: `dev-${i}`, platform: i % 2 ? 'ios' : 'android' });
    }

    const seed = await h.run();
    expect(seed.cells).toBe(1);
    expect(h.fetches).toHaveLength(1);

    h.setSeries(step(4, 60));
    const changed = await h.run();

    expect(h.fetches).toHaveLength(2); // one per run, not one per subscriber
    expect(changed.changed).toBe(1); // one verdict diff for all ten thousand
    expect(changed.sent).toBe(10_000);
    expect(new Set(h.dispatcher.sent.map((s) => s.deviceId)).size).toBe(10_000);
  });

  it('counts nearby coordinates as one cell', async () => {
    const h = harness();
    // Scattered across ~8 km of Denver: all snap to the same 0.1° cell.
    await seedDevice(h.store, { id: 'a', lat: 39.7392, lon: -104.9903, cellKey: DENVER });
    await seedDevice(h.store, { id: 'b', lat: 39.7201, lon: -104.9711, cellKey: DENVER });
    await seedDevice(h.store, { id: 'c', lat: 39.7488, lon: -105.0102, cellKey: DENVER });

    expect(await h.store.listOccupiedCells()).toEqual([DENVER]);
    await h.run();
    expect(h.fetches).toHaveLength(1);
  });
});

describe('the entitlement gate', () => {
  it('drops a lapsed subscriber before any compute is spent', async () => {
    const h = harness();
    await seedDevice(h.store, { id: 'lapsed', expiresAtMs: NOW - HOUR_MS });

    const summary = await h.run();

    expect(summary.cells).toBe(0);
    expect(h.fetches).toHaveLength(0); // not one fetch, not one diff
    expect(h.dispatcher.sent).toHaveLength(0);
  });

  it('stops delivering the moment an entitlement is revoked mid-episode', async () => {
    const h = harness();
    const device = await seedDevice(h.store, { id: 'dev-a' });
    await h.run();

    await h.store.upsertEntitlement(device.appUserId, { active: false, revoked: true, expiresAtMs: NOW });
    h.setSeries(step(4, 60));
    const summary = await h.run();

    expect(summary.cells).toBe(0);
    expect(h.dispatcher.sent).toHaveLength(0);
  });

  it('never notifies a device whose push token was invalidated', async () => {
    const h = harness();
    const device = await seedDevice(h.store, { id: 'dev-a' });
    await h.run();
    await h.store.clearPushToken(device.id, device.pushToken);

    h.setSeries(step(4, 60));
    const summary = await h.run();

    expect(summary.cells).toBe(0);
    expect(h.dispatcher.sent).toHaveLength(0);
  });
});

describe('failures do not become notifications', () => {
  it('leaves stored state untouched when the forecast fetch fails', async () => {
    const store = createMemoryStore();
    const dispatcher = fakeDispatcher();
    await seedDevice(store, { id: 'dev-a' });

    let mode = 'clear';
    const fetchForecast = async (cellKey) => {
      if (mode === 'down') return null;
      const series = mode === 'clear' ? flat(4) : step(4, 60);
      return mockForecast({ cellKey, series, nowMs: NOW });
    };
    const run = () => runEvaluation({ store, dispatcher, fetchForecast, nowMs: NOW });

    await run(); // seed at All clear
    mode = 'down';
    const outage = await run();
    expect(outage.failed).toBe(1);
    expect(dispatcher.sent).toHaveLength(0);
    expect((await store.getCellState(DENVER)).levelIndex).toBe(0); // still the last thing we knew

    // The outage delayed the alert; it did not lose it.
    mode = 'smoke';
    const recovered = await run();
    expect(recovered.sent).toBe(1);
  });

  it('releases the dedupe claim when delivery fails retryably, so the next run retries', async () => {
    const store = createMemoryStore();
    const dispatcher = fakeDispatcher({
      results: [{ delivered: false, retryable: true, reason: 'apns 503' }],
    });
    await seedDevice(store, { id: 'dev-a' });

    let series = flat(4);
    const fetchForecast = async (cellKey) => mockForecast({ cellKey, series, nowMs: NOW });
    const run = (nowMs = NOW) => runEvaluation({ store, dispatcher, fetchForecast, nowMs });

    await run();
    series = step(4, 60);
    const first = await run();
    expect(first.deliveryFailed).toBe(1);
    expect(first.sent).toBe(0);

    // Same transition, next hour: the claim was released, so it goes out once.
    await store.putCellState(DENVER, { ...(await store.getCellState(DENVER)), levelIndex: 0, above: false });
    const second = await run();
    expect(second.sent).toBe(1);
    expect(dispatcher.sent).toHaveLength(2); // one failed attempt, one success
  });

  it('keeps the claim when delivery fails permanently, so it is never retried', async () => {
    const store = createMemoryStore();
    const dispatcher = fakeDispatcher({
      results: [{ delivered: false, retryable: false, reason: 'token-invalid:BadDeviceToken' }],
    });
    await seedDevice(store, { id: 'dev-a' });

    let series = flat(4);
    const fetchForecast = async (cellKey) => mockForecast({ cellKey, series, nowMs: NOW });
    const run = () => runEvaluation({ store, dispatcher, fetchForecast, nowMs: NOW });

    await run();
    series = step(4, 60);
    await run();
    const prev = await store.getCellState(DENVER);
    await store.putCellState(DENVER, { ...prev, levelIndex: 0, above: false });
    await run();

    expect(dispatcher.sent).toHaveLength(1);
  });
});
