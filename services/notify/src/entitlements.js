import { constantTimeEquals } from './ids.js';

// Server-side entitlement, fed by the RevenueCat webhook (platform plan §4).
//
// Client-side gating is not enough and the reason is money: a lapsed
// subscriber whose app still asks to be notified costs a forecast fetch, a
// verdict diff, and an APNs/FCM delivery every hour, forever. The gate belongs
// where the compute is spent, which is here. `listOccupiedCells()` filters on
// it, so a cell occupied only by lapsed devices is not even fetched.
//
// Identity stays anonymous: RevenueCat's `app_user_id` is the device's own
// opaque ID unless the client supplies one, so there is still no email and no
// account anywhere in the system.

export const DEFAULT_ENTITLEMENT_ID = 'smokeshow_pro';

// RevenueCat authenticates its webhook with a shared value in the
// `Authorization` header, configured in their dashboard. There is no HMAC to
// verify, so this comparison is the entire gate — it must not leak length or
// prefix.
export function authorizeWebhook(headerValue, secret) {
  if (!secret) return false; // unconfigured means closed, never open
  return constantTimeEquals(headerValue ?? '', secret);
}

// Events that grant or sustain access. CANCELLATION is deliberately in the
// "still entitled" set: auto-renew off is not access off, and cutting someone
// at cancellation costs you the rest of a month they paid for.
const GRANTING = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
  'TEMPORARY_ENTITLEMENT_GRANT',
]);

// Access continues until the already-known expiry; only the renewal intent
// changed. BILLING_ISSUE is here because RevenueCat extends
// `expiration_at_ms` through the store's grace period, so honouring the
// timestamp is exactly right.
const SOFT_LAPSE = new Set(['CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED']);

// Access ends now.
const REVOKING = new Set(['EXPIRATION', 'SUBSCRIPTION_EXTENDED_REFUND', 'REFUND']);

export function parseWebhookEvent(body) {
  const event = body?.event;
  if (!event || typeof event !== 'object') return null;
  const type = String(event.type ?? '').toUpperCase();
  if (!type) return null;
  return {
    type,
    id: event.id ?? null,
    appUserId: event.app_user_id ?? event.original_app_user_id ?? null,
    originalAppUserId: event.original_app_user_id ?? null,
    aliases: Array.isArray(event.aliases) ? event.aliases : [],
    entitlementIds: Array.isArray(event.entitlement_ids)
      ? event.entitlement_ids
      : event.entitlement_id
        ? [event.entitlement_id]
        : null,
    expirationAtMs: Number.isFinite(event.expiration_at_ms) ? event.expiration_at_ms : null,
    productId: event.product_id ?? null,
    periodType: event.period_type ?? null, // TRIAL | NORMAL | INTRO
    store: event.store ?? null,
    environment: event.environment ?? null,
    cancelReason: event.cancel_reason ?? null,
    transferredFrom: Array.isArray(event.transferred_from) ? event.transferred_from : [],
    transferredTo: Array.isArray(event.transferred_to) ? event.transferred_to : [],
  };
}

function concernsEntitlement(event, entitlementId) {
  // Null means RevenueCat did not scope the event (aliases, transfers, tests).
  // Those are identity plumbing and always apply.
  if (!event.entitlementIds) return true;
  return event.entitlementIds.includes(entitlementId);
}

// Returns `{ action, appUserId }` describing what was written, so the webhook
// route can log a one-line outcome without re-deriving it.
export async function applyWebhookEvent(
  store,
  body,
  { entitlementId = DEFAULT_ENTITLEMENT_ID, nowMs = Date.now() } = {},
) {
  const event = parseWebhookEvent(body);
  if (!event) return { action: 'ignored-unparseable' };

  if (event.type === 'TEST') return { action: 'ignored-test' };

  // Alias and transfer events rewrite identity, not access. They must be
  // applied even when they carry no entitlement scope, or a subscriber who
  // restores on a new device silently loses their notifications.
  if (event.type === 'SUBSCRIBER_ALIAS') {
    const canonical = event.appUserId;
    for (const alias of [event.originalAppUserId, ...event.aliases]) {
      if (alias && alias !== canonical) await store.aliasAppUser(alias, canonical);
    }
    return { action: 'aliased', appUserId: canonical };
  }

  if (event.type === 'TRANSFER') {
    const to = event.transferredTo[0] ?? event.appUserId;
    for (const from of event.transferredFrom) {
      if (from && to && from !== to) await store.aliasAppUser(from, to);
    }
    return { action: 'transferred', appUserId: to };
  }

  if (!event.appUserId) return { action: 'ignored-no-user' };
  if (!concernsEntitlement(event, entitlementId)) return { action: 'ignored-other-entitlement' };

  const shared = {
    lastEventId: event.id,
    lastEventType: event.type,
    productId: event.productId,
    periodType: event.periodType,
    store: event.store,
    environment: event.environment,
  };

  if (GRANTING.has(event.type)) {
    await store.upsertEntitlement(event.appUserId, {
      ...shared,
      active: true,
      revoked: false,
      willRenew: true,
      expiresAtMs: event.expirationAtMs,
    });
    return { action: 'granted', appUserId: event.appUserId };
  }

  if (SOFT_LAPSE.has(event.type)) {
    // Keep whatever expiry is already on file when the event omits one —
    // dropping to null here would mean "no expiry", i.e. free forever.
    const existing = await store.getEntitlement(event.appUserId);
    await store.upsertEntitlement(event.appUserId, {
      ...shared,
      active: true,
      revoked: false,
      willRenew: false,
      billingIssue: event.type === 'BILLING_ISSUE',
      expiresAtMs: event.expirationAtMs ?? existing?.expiresAtMs ?? nowMs,
    });
    return { action: 'soft-lapse', appUserId: event.appUserId };
  }

  if (REVOKING.has(event.type)) {
    await store.upsertEntitlement(event.appUserId, {
      ...shared,
      active: false,
      revoked: true,
      willRenew: false,
      expiresAtMs: event.expirationAtMs ?? nowMs,
    });
    return { action: 'revoked', appUserId: event.appUserId };
  }

  return { action: 'ignored-unhandled', appUserId: event.appUserId };
}
