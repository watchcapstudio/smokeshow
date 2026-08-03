import { newDeviceId, newDeviceSecret, secretMatches } from '../ids.js';
import { buildDeviceRecord, DEFAULT_QUIET_HOURS, DEFAULT_THRESHOLD } from '../store.js';
import { normalizeLocation } from '../cells.js';
import { applyWebhookEvent, authorizeWebhook } from '../entitlements.js';

// The device registry API.
//
// Registration takes a push token and a list of places. It does not take an
// email, a password, or a name, and there is no login: the server mints an
// opaque ID and a secret, returns both once, and stores only a hash of the
// secret. That is the entire identity model (platform plan §4), and it means a
// DELETE is a complete erasure — there is no second record of the person
// anywhere in the system.

const MAX_LOCATIONS = 10;
const PLATFORMS = new Set(['ios', 'ipados', 'macos', 'android']);
const MAX_LEVEL_INDEX = 4;

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.code = 'bad-request';
  }
}

function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseQuietHours(input) {
  if (input == null) return { ...DEFAULT_QUIET_HOURS };
  const startHour = Number(input.startHour ?? DEFAULT_QUIET_HOURS.startHour);
  const endHour = Number(input.endHour ?? DEFAULT_QUIET_HOURS.endHour);
  const inRange = (h) => Number.isInteger(h) && h >= 0 && h <= 23;
  if (!inRange(startHour) || !inRange(endHour)) throw new BadRequest('quietHours must be integer hours 0-23');
  return { enabled: input.enabled !== false, startHour, endHour };
}

function parseThreshold(input, fallback = DEFAULT_THRESHOLD) {
  if (input == null) return fallback;
  const value = Number(input);
  if (!Number.isInteger(value) || value < 0 || value > MAX_LEVEL_INDEX) {
    throw new BadRequest(`threshold must be an integer 0-${MAX_LEVEL_INDEX}`);
  }
  return value;
}

function parseLocations(input) {
  if (input == null) return null;
  if (!Array.isArray(input)) throw new BadRequest('locations must be an array');
  if (input.length > MAX_LOCATIONS) throw new BadRequest(`at most ${MAX_LOCATIONS} locations`);
  return input.map((raw) => {
    const loc = normalizeLocation(raw);
    if (!loc) throw new BadRequest('each location needs finite lat/lon in range');
    // A per-location threshold overrides the device default: someone can want
    // any smoke at home and only the bad stuff at a cabin.
    const threshold = raw.threshold == null ? null : parseThreshold(raw.threshold);
    return { ...loc, threshold };
  });
}

function publicDevice(device, { entitled = null } = {}) {
  return {
    deviceId: device.id,
    platform: device.platform,
    timezone: device.timezone,
    threshold: device.threshold,
    quietHours: device.quietHours,
    sensitiveHousehold: device.sensitiveHousehold,
    enabled: device.enabled,
    hasPushToken: Boolean(device.pushToken),
    appUserId: device.appUserId,
    locations: (device.locations ?? []).map((l) => ({
      label: l.label,
      lat: l.lat,
      lon: l.lon,
      cellKey: l.cellKey,
      threshold: l.threshold,
    })),
    entitled,
    // The posture, served from the API so all three clients render one
    // sentence and none of them invents a fifth notification type.
    policy: 'Threshold alerts only. No digests, no streaks, no engagement pings.',
  };
}

const json = (status, body, headers = {}) => ({
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  body,
});

const fail = (status, code, message) => json(status, { error: { code, message } });

export function createRouter({ store, config, logger = null, now = () => Date.now() }) {
  async function authenticate(deviceId, headers) {
    const device = await store.getDevice(deviceId);
    if (!device) return { error: fail(404, 'not-found', 'no such device') };
    const auth = String(headers?.authorization ?? '');
    const secret = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    // 404 rather than 401 on a bad secret: a distinguishable 401 turns this
    // endpoint into an oracle for which opaque IDs exist.
    if (!secretMatches(secret, device.secretHash)) {
      return { error: fail(404, 'not-found', 'no such device') };
    }
    return { device };
  }

  async function registerDevice(body) {
    const platform = String(body?.platform ?? '').toLowerCase();
    if (!PLATFORMS.has(platform)) throw new BadRequest(`platform must be one of ${[...PLATFORMS].join(', ')}`);
    const pushToken = body?.pushToken == null ? null : String(body.pushToken);
    if (!pushToken) throw new BadRequest('pushToken is required');
    if (body?.timezone != null && !isValidTimezone(body.timezone)) {
      throw new BadRequest('timezone must be a valid IANA zone');
    }

    const id = newDeviceId();
    const secret = newDeviceSecret();
    const record = buildDeviceRecord({
      id,
      secret,
      platform,
      pushToken,
      // Defaults to the device's own opaque ID, so RevenueCat never learns
      // anything about the person either.
      appUserId: body?.appUserId ? String(body.appUserId) : id,
      timezone: body?.timezone ?? null,
      locations: parseLocations(body?.locations) ?? [],
      threshold: parseThreshold(body?.threshold),
      quietHours: parseQuietHours(body?.quietHours),
      sensitiveHousehold: Boolean(body?.sensitiveHousehold),
      nowMs: now(),
    });
    await store.registerDevice(record);
    logger?.info?.('device registered', { deviceId: id, platform, cells: record.locations.length });

    // `entitled` is looked up rather than assumed false: a client that
    // purchased first and registered second (a restore on a new phone, with
    // its RevenueCat ID supplied) is already entitled at this point.
    //
    // The secret is shown exactly once. There is no recovery flow, because a
    // recovery flow needs an account and there are no accounts: a device that
    // loses its secret re-registers.
    const entitled = await store.isDeviceEntitled(id, now());
    return json(201, { ...publicDevice(record, { entitled }), deviceSecret: secret });
  }

  async function patchDevice(device, body) {
    const patch = {};
    if (body?.pushToken !== undefined) patch.pushToken = body.pushToken ? String(body.pushToken) : null;
    if (body?.platform !== undefined) {
      const platform = String(body.platform).toLowerCase();
      if (!PLATFORMS.has(platform)) throw new BadRequest('unknown platform');
      patch.platform = platform;
    }
    if (body?.timezone !== undefined) {
      if (body.timezone !== null && !isValidTimezone(body.timezone)) {
        throw new BadRequest('timezone must be a valid IANA zone');
      }
      patch.timezone = body.timezone;
    }
    if (body?.locations !== undefined) patch.locations = parseLocations(body.locations) ?? [];
    if (body?.threshold !== undefined) patch.threshold = parseThreshold(body.threshold);
    if (body?.quietHours !== undefined) patch.quietHours = parseQuietHours(body.quietHours);
    if (body?.sensitiveHousehold !== undefined) patch.sensitiveHousehold = Boolean(body.sensitiveHousehold);
    if (body?.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body?.appUserId !== undefined) patch.appUserId = String(body.appUserId);

    const updated = await store.updateDevice(device.id, patch);
    return json(200, publicDevice(updated, { entitled: await store.isDeviceEntitled(device.id, now()) }));
  }

  async function revenuecatWebhook(headers, body) {
    if (!authorizeWebhook(headers?.authorization, config?.revenuecat?.webhookSecret)) {
      logger?.warn?.('revenuecat webhook rejected');
      return fail(401, 'unauthorized', 'bad webhook credential');
    }
    const result = await applyWebhookEvent(store, body, {
      entitlementId: config?.revenuecat?.entitlementId,
      nowMs: now(),
    });
    logger?.info?.('revenuecat webhook', result);
    // Always 200 on an authorised event, including the ignored ones —
    // RevenueCat retries non-2xx, and retrying an event we deliberately ignore
    // buys nothing.
    return json(200, { ok: true, ...result });
  }

  return async function handle({ method, path, headers = {}, body = null }) {
    try {
      if (method === 'GET' && path === '/healthz') return json(200, { ok: true });

      if (method === 'POST' && path === '/v1/devices') return await registerDevice(body);

      if (method === 'POST' && path === '/v1/webhooks/revenuecat') {
        return await revenuecatWebhook(headers, body);
      }

      const deviceMatch = /^\/v1\/devices\/([A-Za-z0-9_-]+)$/.exec(path);
      if (deviceMatch) {
        const { device, error } = await authenticate(deviceMatch[1], headers);
        if (error) return error;

        if (method === 'GET') {
          return json(200, publicDevice(device, { entitled: await store.isDeviceEntitled(device.id, now()) }));
        }
        if (method === 'PATCH') return await patchDevice(device, body);
        if (method === 'DELETE') {
          await store.deleteDevice(device.id);
          return json(200, { ok: true, deleted: device.id });
        }
        return fail(405, 'method-not-allowed', `${method} not allowed here`);
      }

      return fail(404, 'not-found', 'no such route');
    } catch (err) {
      if (err instanceof BadRequest) return fail(400, 'bad-request', err.message);
      logger?.error?.('unhandled route error', { path, error: err.message });
      return fail(500, 'internal', 'unexpected error');
    }
  };
}
