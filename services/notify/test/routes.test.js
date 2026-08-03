import { describe, it, expect } from 'vitest';
import { createRouter } from '../src/http/routes.js';
import { createMemoryStore } from '../src/store.js';
import { cellKeyFor } from '../src/cells.js';

const NOW = Date.UTC(2026, 7, 2, 18, 0, 0);
const WEBHOOK_SECRET = 'shared-secret';

function api() {
  const store = createMemoryStore({ now: () => NOW });
  const handle = createRouter({
    store,
    config: { revenuecat: { webhookSecret: WEBHOOK_SECRET, entitlementId: 'pro' } },
    now: () => NOW,
  });
  return { store, handle };
}

const registration = {
  platform: 'ios',
  pushToken: 'apns-token-1',
  timezone: 'America/Denver',
  locations: [{ label: 'Home', lat: 39.7392, lon: -104.9903 }],
  threshold: 2,
  quietHours: { enabled: true, startHour: 22, endHour: 7 },
  sensitiveHousehold: true,
};

describe('device registration', () => {
  it('registers a device and returns its secret exactly once', async () => {
    const { handle, store } = api();
    const res = await handle({ method: 'POST', path: '/v1/devices', body: registration });

    expect(res.status).toBe(201);
    expect(res.body.deviceId).toMatch(/^dev_/);
    expect(res.body.deviceSecret).toBeTruthy();
    expect(res.body.locations[0].cellKey).toBe(cellKeyFor(39.7392, -104.9903));
    expect(res.body.policy).toBe('Threshold alerts only. No digests, no streaks, no engagement pings.');

    // Nothing identifying is stored, and the secret is only ever a hash.
    const stored = await store.getDevice(res.body.deviceId);
    expect(stored.secretHash).not.toBe(res.body.deviceSecret);
    expect(Object.keys(stored)).not.toContain('email');

    const fetched = await handle({
      method: 'GET',
      path: `/v1/devices/${res.body.deviceId}`,
      headers: { authorization: `Bearer ${res.body.deviceSecret}` },
    });
    expect(fetched.body.deviceSecret).toBeUndefined();
    expect(fetched.body.hasPushToken).toBe(true);
  });

  it('defaults the RevenueCat identity to the opaque device ID', async () => {
    const { handle } = api();
    const res = await handle({ method: 'POST', path: '/v1/devices', body: registration });
    expect(res.body.appUserId).toBe(res.body.deviceId);
  });

  it('rejects bad input rather than storing it', async () => {
    const { handle } = api();
    const cases = [
      { ...registration, platform: 'blackberry' },
      { ...registration, pushToken: null },
      { ...registration, threshold: 9 },
      { ...registration, quietHours: { startHour: 25, endHour: 7 } },
      { ...registration, timezone: 'Mars/Olympus' },
      { ...registration, locations: [{ label: 'Nowhere', lat: 999, lon: 0 }] },
      { ...registration, locations: new Array(11).fill({ lat: 39.7, lon: -104.9 }) },
    ];
    for (const body of cases) {
      const res = await handle({ method: 'POST', path: '/v1/devices', body });
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });
});

describe('device authentication', () => {
  async function registered() {
    const { handle, store } = api();
    const res = await handle({ method: 'POST', path: '/v1/devices', body: registration });
    return { handle, store, id: res.body.deviceId, secret: res.body.deviceSecret };
  }

  it('updates settings with the right secret', async () => {
    const { handle, id, secret } = await registered();
    const res = await handle({
      method: 'PATCH',
      path: `/v1/devices/${id}`,
      headers: { authorization: `Bearer ${secret}` },
      body: { threshold: 1, quietHours: { enabled: false, startHour: 22, endHour: 7 }, locations: [] },
    });

    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(1);
    expect(res.body.quietHours.enabled).toBe(false);
    expect(res.body.locations).toEqual([]);
  });

  it('will not let one device reconfigure another', async () => {
    const { handle, id } = await registered();
    const res = await handle({
      method: 'PATCH',
      path: `/v1/devices/${id}`,
      headers: { authorization: 'Bearer not-the-secret' },
      body: { threshold: 0 },
    });
    // 404, not 401: a distinguishable 401 would confirm which IDs exist.
    expect(res.status).toBe(404);
  });

  it('does not leak whether an unknown device ID exists', async () => {
    const { handle } = api();
    const res = await handle({ method: 'GET', path: '/v1/devices/dev_nope', headers: {} });
    expect(res.status).toBe(404);
  });

  it('deletes everything it knows on request', async () => {
    const { handle, store, id, secret } = await registered();
    const res = await handle({
      method: 'DELETE',
      path: `/v1/devices/${id}`,
      headers: { authorization: `Bearer ${secret}` },
    });

    expect(res.status).toBe(200);
    expect(await store.getDevice(id)).toBeNull();
    expect(await store.listOccupiedCells(NOW)).toEqual([]);
  });
});

describe('the RevenueCat webhook', () => {
  it('rejects an unauthorized call', async () => {
    const { handle, store } = api();
    const res = await handle({
      method: 'POST',
      path: '/v1/webhooks/revenuecat',
      headers: { authorization: 'wrong' },
      body: { event: { type: 'INITIAL_PURCHASE', app_user_id: 'dev_x', entitlement_ids: ['pro'] } },
    });

    expect(res.status).toBe(401);
    expect(await store.getEntitlement('dev_x')).toBeNull();
  });

  it('grants entitlement on an authorized purchase', async () => {
    const { handle, store } = api();
    const device = await handle({ method: 'POST', path: '/v1/devices', body: registration });

    const res = await handle({
      method: 'POST',
      path: '/v1/webhooks/revenuecat',
      headers: { authorization: WEBHOOK_SECRET },
      body: {
        event: {
          type: 'INITIAL_PURCHASE',
          app_user_id: device.body.appUserId,
          entitlement_ids: ['pro'],
          expiration_at_ms: NOW + 14 * 24 * 3600_000,
          period_type: 'TRIAL',
        },
      },
    });

    expect(res.status).toBe(200);
    expect(await store.isDeviceEntitled(device.body.deviceId, NOW)).toBe(true);
    expect(await store.listOccupiedCells(NOW)).toHaveLength(1);
  });

  it('answers 200 to an event it deliberately ignores, so RevenueCat stops retrying', async () => {
    const { handle } = api();
    const res = await handle({
      method: 'POST',
      path: '/v1/webhooks/revenuecat',
      headers: { authorization: WEBHOOK_SECRET },
      body: { event: { type: 'TEST', app_user_id: 'dev_x' } },
    });
    expect(res.status).toBe(200);
  });
});

describe('routing', () => {
  it('answers health checks and refuses everything else', async () => {
    const { handle } = api();
    expect((await handle({ method: 'GET', path: '/healthz' })).status).toBe(200);
    expect((await handle({ method: 'GET', path: '/v1/nope' })).status).toBe(404);
    expect((await handle({ method: 'GET', path: '/v1/devices' })).status).toBe(404);
  });
});
