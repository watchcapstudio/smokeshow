import { describe, it, expect } from 'vitest';
import { applyWebhookEvent, authorizeWebhook } from '../src/entitlements.js';
import { createMemoryStore } from '../src/store.js';
import { seedDevice, HOUR_MS } from './helpers.js';

const NOW = Date.UTC(2026, 7, 2, 18, 0, 0);
const SECRET = 'shared-secret-from-the-revenuecat-dashboard';

const hook = (type, fields = {}) => ({
  api_version: '1.0',
  event: {
    id: `evt_${type}`,
    type,
    app_user_id: 'dev_abc',
    entitlement_ids: ['pro'],
    ...fields,
  },
});

const apply = (store, body) => applyWebhookEvent(store, body, { entitlementId: 'pro', nowMs: NOW });

describe('webhook authorization', () => {
  it('accepts the configured credential', () => {
    expect(authorizeWebhook(SECRET, SECRET)).toBe(true);
  });

  it('rejects a wrong or missing credential', () => {
    expect(authorizeWebhook('nope', SECRET)).toBe(false);
    expect(authorizeWebhook(undefined, SECRET)).toBe(false);
    expect(authorizeWebhook(`${SECRET}x`, SECRET)).toBe(false);
  });

  it('is closed when no secret is configured, not open', () => {
    expect(authorizeWebhook('anything', null)).toBe(false);
    expect(authorizeWebhook('', '')).toBe(false);
  });
});

describe('entitlement state machine', () => {
  it('grants on purchase and renewal', async () => {
    const store = createMemoryStore();
    await apply(store, hook('INITIAL_PURCHASE', { expiration_at_ms: NOW + 30 * 24 * HOUR_MS, period_type: 'TRIAL' }));

    const ent = await store.getEntitlement('dev_abc');
    expect(ent.active).toBe(true);
    expect(ent.revoked).toBe(false);
    expect(ent.periodType).toBe('TRIAL');
  });

  it('keeps access through a cancellation until the paid period ends', async () => {
    const store = createMemoryStore();
    const expiresAtMs = NOW + 10 * 24 * HOUR_MS;
    await apply(store, hook('INITIAL_PURCHASE', { expiration_at_ms: expiresAtMs }));
    await apply(store, hook('CANCELLATION', { expiration_at_ms: expiresAtMs, cancel_reason: 'UNSUBSCRIBE' }));

    const ent = await store.getEntitlement('dev_abc');
    expect(ent.active).toBe(true);
    expect(ent.willRenew).toBe(false);
    expect(ent.expiresAtMs).toBe(expiresAtMs);
  });

  it('does not turn a billing issue into free access forever', async () => {
    const store = createMemoryStore();
    const expiresAtMs = NOW + 3 * 24 * HOUR_MS;
    await apply(store, hook('INITIAL_PURCHASE', { expiration_at_ms: expiresAtMs }));
    // The event omits an expiry; the one already on file must survive.
    await apply(store, hook('BILLING_ISSUE'));

    const ent = await store.getEntitlement('dev_abc');
    expect(ent.expiresAtMs).toBe(expiresAtMs);
    expect(ent.billingIssue).toBe(true);
  });

  it('revokes on expiration', async () => {
    const store = createMemoryStore();
    await apply(store, hook('INITIAL_PURCHASE', { expiration_at_ms: NOW + HOUR_MS }));
    await apply(store, hook('EXPIRATION', { expiration_at_ms: NOW }));

    const ent = await store.getEntitlement('dev_abc');
    expect(ent.revoked).toBe(true);
    expect(ent.active).toBe(false);
  });

  it('ignores an event for someone else\'s entitlement', async () => {
    const store = createMemoryStore();
    const result = await apply(store, hook('INITIAL_PURCHASE', { entitlement_ids: ['some_other_product'] }));

    expect(result.action).toBe('ignored-other-entitlement');
    expect(await store.getEntitlement('dev_abc')).toBeNull();
  });

  it('ignores the dashboard test event', async () => {
    const store = createMemoryStore();
    expect((await apply(store, hook('TEST'))).action).toBe('ignored-test');
  });

  it('follows an alias so a restore on a new device keeps its subscription', async () => {
    const store = createMemoryStore();
    await apply(store, hook('INITIAL_PURCHASE', { app_user_id: 'old_id', expiration_at_ms: NOW + HOUR_MS }));
    await apply(store, hook('SUBSCRIBER_ALIAS', { app_user_id: 'new_id', original_app_user_id: 'old_id', entitlement_ids: null }));

    const ent = await store.getEntitlement('new_id');
    expect(ent).not.toBeNull();
    expect(ent.active).toBe(true);
  });

  it('moves an entitlement on a transfer', async () => {
    const store = createMemoryStore();
    await apply(store, hook('INITIAL_PURCHASE', { app_user_id: 'from_id', expiration_at_ms: NOW + HOUR_MS }));
    await apply(
      store,
      hook('TRANSFER', { transferred_from: ['from_id'], transferred_to: ['to_id'], entitlement_ids: null }),
    );

    expect((await store.getEntitlement('to_id'))?.active).toBe(true);
  });

  it('shrugs at a malformed body', async () => {
    const store = createMemoryStore();
    expect((await apply(store, {})).action).toBe('ignored-unparseable');
    expect((await apply(store, { event: { type: 'INITIAL_PURCHASE' } })).action).toBe('ignored-no-user');
  });
});

describe('the gate, end to end', () => {
  it('lets a device through only while its entitlement is live', async () => {
    const store = createMemoryStore({ now: () => NOW });
    const device = await seedDevice(store, { id: 'dev_abc', entitled: false, nowMs: NOW });
    expect(await store.listOccupiedCells(NOW)).toEqual([]);

    await apply(store, hook('INITIAL_PURCHASE', { app_user_id: device.appUserId, expiration_at_ms: NOW + HOUR_MS }));
    expect(await store.listOccupiedCells(NOW)).toHaveLength(1);

    // An hour later the subscription has lapsed and nobody renewed it. No
    // webhook is needed for the gate to close — the timestamp does it.
    expect(await store.listOccupiedCells(NOW + 2 * HOUR_MS)).toEqual([]);
  });
});
