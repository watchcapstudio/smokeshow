import { DEFAULT_ENTITLEMENT_ID } from './entitlements.js';
import { DEFAULT_MIN_GAP_MS } from './fanout.js';

// Everything the service needs from the environment, read once, in one place.
// No module reaches for process.env on its own — that is how a test ends up
// depending on a deploy variable.

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

// Private keys arrive from secret managers with literal "\n" sequences more
// often than not.
function pem(value) {
  return value ? String(value).replace(/\\n/g, '\n') : null;
}

export function loadConfig(env = process.env) {
  return {
    port: num(env.NOTIFY_PORT, 8787),
    forecastBase: env.NOTIFY_FORECAST_BASE || 'https://smokeshow.earth',
    databaseUrl: env.NOTIFY_DATABASE_URL || null,
    databaseSchema: env.NOTIFY_DATABASE_SCHEMA || 'smokeshow_notify',
    databasePoolMax: num(env.NOTIFY_DATABASE_POOL_MAX, 5),
    cellConcurrency: num(env.NOTIFY_CELL_CONCURRENCY, 8),
    minGapMs: num(env.NOTIFY_MIN_GAP_MS, DEFAULT_MIN_GAP_MS),
    requireEntitlement: bool(env.NOTIFY_REQUIRE_ENTITLEMENT, true),

    revenuecat: {
      webhookSecret: env.REVENUECAT_WEBHOOK_SECRET || null,
      entitlementId: env.REVENUECAT_ENTITLEMENT_ID || DEFAULT_ENTITLEMENT_ID,
    },

    apns: {
      keyId: env.APNS_KEY_ID || null,
      teamId: env.APNS_TEAM_ID || null,
      privateKey: pem(env.APNS_KEY_P8),
      topic: env.APNS_TOPIC || null,
      topics: {
        ios: env.APNS_TOPIC_IOS || env.APNS_TOPIC || null,
        macos: env.APNS_TOPIC_MACOS || env.APNS_TOPIC || null,
      },
      // Sandbox during development; the token is the same, the host is not.
      host: env.APNS_HOST || 'api.push.apple.com',
    },

    fcm: {
      projectId: env.FCM_PROJECT_ID || null,
      clientEmail: env.FCM_CLIENT_EMAIL || null,
      privateKey: pem(env.FCM_PRIVATE_KEY),
    },
  };
}

export function createLogger({ stream = process.stdout, level = 'info' } = {}) {
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const floor = levels[level] ?? 20;
  const emit = (name) => (message, fields = {}) => {
    if (levels[name] < floor) return;
    stream.write(`${JSON.stringify({ level: name, message, ...fields })}\n`);
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
