import { hashSecret } from './ids.js';

// The storage contract, plus an in-memory implementation.
//
// Everything above this file is written against the interface, never against a
// database. That is what lets the integration tests run the real evaluation
// loop — the same code that runs in production — with no Postgres in the
// harness. `schema.sql` and `store.pg.js` are the durable implementation of
// the same shape.
//
// Method groups:
//   devices        registerDevice / getDevice / updateDevice / deleteDevice
//   subscribers    listOccupiedCells / listCellSubscribers
//   verdict state  getCellState / putCellState
//   dedupe         claimNotification / releaseNotification / lastNotifiedAt
//   entitlement    upsertEntitlement / getEntitlement / aliasAppUser
//
// `listOccupiedCells()` is the hot path and the reason the service is cheap:
// it returns unique cells, already filtered to devices that are enabled,
// entitled, and hold a push token. A lapsed subscriber alone in a cell costs
// zero fetches, not one.

export const DEFAULT_THRESHOLD = 2; // "Smells like fire" — the forecast-text anchor

export const DEFAULT_QUIET_HOURS = Object.freeze({
  enabled: true,
  startHour: 22, // 10 PM local
  endHour: 7, //  7 AM local
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createMemoryStore({ now = () => Date.now() } = {}) {
  const devices = new Map(); // deviceId -> record
  const entitlements = new Map(); // appUserId -> record
  const aliases = new Map(); // aliasId -> canonical appUserId
  const cellStates = new Map(); // cellKey -> stored verdict signature
  const sent = new Map(); // `${deviceId} ${dedupeKey}` -> { sentAtMs, cellKey }
  const lastByCell = new Map(); // `${deviceId} ${cellKey}` -> ms

  // The cell index — this store's equivalent of `device_locations_cell_idx` in
  // schema.sql. Without it, finding one cell's subscribers is a scan of every
  // device and a run costs O(cells x devices): precisely the O(users) shape the
  // lattice exists to avoid.
  const byCell = new Map(); // cellKey -> Set<deviceId>

  function indexDevice(device) {
    for (const loc of device?.locations ?? []) {
      let set = byCell.get(loc.cellKey);
      if (!set) byCell.set(loc.cellKey, (set = new Set()));
      set.add(device.id);
    }
  }

  function deindexDevice(device) {
    for (const loc of device?.locations ?? []) {
      const set = byCell.get(loc.cellKey);
      if (!set) continue;
      set.delete(device.id);
      if (!set.size) byCell.delete(loc.cellKey);
    }
  }

  function resolveAppUser(appUserId) {
    let id = appUserId;
    // Alias chains are shallow in practice; the bound stops a cycle from a
    // malformed webhook pair turning a lookup into a hang.
    for (let hops = 0; hops < 8 && aliases.has(id); hops++) id = aliases.get(id);
    return id;
  }

  function entitlementFor(appUserId) {
    return entitlements.get(resolveAppUser(appUserId)) ?? null;
  }

  function isEntitled(device, nowMs) {
    const ent = entitlementFor(device.appUserId);
    if (!ent) return false;
    if (ent.revoked) return false;
    if (ent.expiresAtMs == null) return Boolean(ent.active);
    return ent.expiresAtMs > nowMs;
  }

  // Enabled, entitled, and reachable. Every consumer of subscriber lists goes
  // through this predicate so the entitlement gate cannot be forgotten in one
  // call site and enforced in another.
  function deliverable(device, nowMs) {
    return Boolean(device.enabled && device.pushToken && isEntitled(device, nowMs));
  }

  return {
    _devices: devices, // tests and admin tooling only

    async registerDevice(record) {
      const stored = clone(record);
      devices.set(record.id, stored);
      indexDevice(stored);
      return clone(record);
    },

    async getDevice(deviceId) {
      return clone(devices.get(deviceId) ?? null);
    },

    async updateDevice(deviceId, patch) {
      const existing = devices.get(deviceId);
      if (!existing) return null;
      const next = { ...existing, ...clone(patch), id: existing.id, updatedAtMs: now() };
      deindexDevice(existing);
      devices.set(deviceId, next);
      indexDevice(next);
      return clone(next);
    },

    async deleteDevice(deviceId) {
      deindexDevice(devices.get(deviceId));
      return devices.delete(deviceId);
    },

    // A token can be reassigned by the OS to a different install. When a push
    // provider tells us a token is dead we clear it wherever it appears, but
    // only if it still matches — a device that re-registered in between keeps
    // its new token.
    async clearPushToken(deviceId, token) {
      const device = devices.get(deviceId);
      if (!device || (token && device.pushToken !== token)) return false;
      devices.set(deviceId, { ...device, pushToken: null, updatedAtMs: now() });
      return true;
    },

    // Walks cells, not devices, and stops at the first deliverable subscriber
    // in each — a cell holding ten thousand people is one hit, and a cell
    // holding only lapsed ones drops out without costing a fetch.
    async listOccupiedCells(nowMs = now()) {
      const cells = [];
      for (const [cellKey, deviceIds] of byCell) {
        for (const deviceId of deviceIds) {
          const device = devices.get(deviceId);
          if (device && deliverable(device, nowMs)) {
            cells.push(cellKey);
            break;
          }
        }
      }
      return cells.sort();
    },

    async listCellSubscribers(cellKey, nowMs = now()) {
      const rows = [];
      for (const deviceId of byCell.get(cellKey) ?? []) {
        const device = devices.get(deviceId);
        if (!device || !deliverable(device, nowMs)) continue;
        for (const loc of device.locations ?? []) {
          if (loc.cellKey === cellKey) rows.push({ device: clone(device), location: clone(loc) });
        }
      }
      return rows;
    },

    async getCellState(cellKey) {
      return clone(cellStates.get(cellKey) ?? null);
    },

    async putCellState(cellKey, state) {
      cellStates.set(cellKey, clone(state));
    },

    // Exactly-once, claimed *before* the send. If the process dies between the
    // claim and the send the notification is lost; if it dies after the send
    // the claim survives and nobody is woken twice. Losing one alert beats
    // sending a duplicate at 3 AM, so the claim goes first.
    async claimNotification({ deviceId, dedupeKey, cellKey, sentAtMs = now() }) {
      const key = `${deviceId} ${dedupeKey}`;
      if (sent.has(key)) return false;
      sent.set(key, { sentAtMs, cellKey });
      lastByCell.set(`${deviceId} ${cellKey}`, sentAtMs);
      return true;
    },

    // Only for a send that failed with a retryable error and exhausted its
    // attempts — the next run should be allowed to try that same transition
    // again. Never call this after a successful send.
    async releaseNotification({ deviceId, dedupeKey, cellKey, previousMs = null }) {
      sent.delete(`${deviceId} ${dedupeKey}`);
      const lastKey = `${deviceId} ${cellKey}`;
      if (previousMs == null) lastByCell.delete(lastKey);
      else lastByCell.set(lastKey, previousMs);
      return true;
    },

    async lastNotifiedAt(deviceId, cellKey) {
      return lastByCell.get(`${deviceId} ${cellKey}`) ?? null;
    },

    async pruneSent(beforeMs) {
      let removed = 0;
      for (const [key, row] of sent) {
        if (row.sentAtMs < beforeMs) {
          sent.delete(key);
          removed++;
        }
      }
      return removed;
    },

    async upsertEntitlement(appUserId, record) {
      const id = resolveAppUser(appUserId);
      const existing = entitlements.get(id) ?? {};
      const next = { ...existing, ...clone(record), appUserId: id, updatedAtMs: now() };
      entitlements.set(id, next);
      return clone(next);
    },

    async getEntitlement(appUserId) {
      return clone(entitlementFor(appUserId));
    },

    async aliasAppUser(aliasId, canonicalId) {
      if (!aliasId || !canonicalId || aliasId === canonicalId) return;
      aliases.set(aliasId, canonicalId);
      const orphan = entitlements.get(aliasId);
      if (orphan && !entitlements.has(canonicalId)) {
        entitlements.set(canonicalId, { ...orphan, appUserId: canonicalId });
      }
      entitlements.delete(aliasId);
    },

    async isDeviceEntitled(deviceId, nowMs = now()) {
      const device = devices.get(deviceId);
      return device ? isEntitled(device, nowMs) : false;
    },

    async stats(nowMs = now()) {
      let deliverableCount = 0;
      for (const device of devices.values()) if (deliverable(device, nowMs)) deliverableCount++;
      return {
        devices: devices.size,
        deliverable: deliverableCount,
        cells: (await this.listOccupiedCells(nowMs)).length,
        entitlements: entitlements.size,
      };
    },
  };
}

// Shared shape-builder so the HTTP layer and the tests construct identical
// device rows.
export function buildDeviceRecord({
  id,
  secret,
  platform,
  pushToken,
  appUserId,
  timezone = null,
  locations = [],
  threshold = DEFAULT_THRESHOLD,
  quietHours = DEFAULT_QUIET_HOURS,
  sensitiveHousehold = false,
  enabled = true,
  nowMs = Date.now(),
}) {
  return {
    id,
    secretHash: secret ? hashSecret(secret) : null,
    platform,
    pushToken,
    appUserId: appUserId || id,
    timezone,
    locations,
    threshold,
    quietHours: { ...DEFAULT_QUIET_HOURS, ...(quietHours ?? {}) },
    sensitiveHousehold: Boolean(sensitiveHousehold),
    enabled: Boolean(enabled),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}
