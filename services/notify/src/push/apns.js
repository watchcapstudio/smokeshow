import http2 from 'node:http2';
import { appleProviderToken } from './jwt.js';

// APNs over HTTP/2, one long-lived session, JWT provider auth.
//
// Every sender in this service returns the same verdict shape so the
// dispatcher can be provider-agnostic:
//
//   { ok: true }
//   { ok: false, retryable: true,  status, reason }   -> back off and try again
//   { ok: false, invalidToken: true, status, reason } -> forget the token
//   { ok: false, status, reason }                     -> permanent, drop it
//
// Getting the invalid-token branch right is not hygiene, it is cost control:
// dead tokens accumulate at the rate people delete the app, and a service that
// never prunes them spends a growing share of every run pushing into the void.

const PROVIDER_TOKEN_TTL_MS = 40 * 60_000; // Apple refuses refreshes faster than 20 min; 40 is safe
const ALERT_TTL_SEC = 3600; // a smoke alert an hour stale is noise, not news

// Apple's own words for "this token is gone". 410 always means it; these
// reasons mean it at 400.
const DEAD_TOKEN_REASONS = new Set([
  'BadDeviceToken',
  'Unregistered',
  'DeviceTokenNotForTopic',
  'ExpiredToken',
]);

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function createApnsSender({
  keyId,
  teamId,
  privateKey,
  topic,
  topics = {},
  host = 'api.push.apple.com',
  now = () => Date.now(),
  connect = (origin) => http2.connect(origin),
} = {}) {
  let session = null;
  let cachedToken = null;
  let cachedAtMs = 0;

  function providerToken() {
    if (cachedToken && now() - cachedAtMs < PROVIDER_TOKEN_TTL_MS) return cachedToken;
    cachedToken = appleProviderToken({ keyId, teamId, privateKey, nowSec: Math.floor(now() / 1000) });
    cachedAtMs = now();
    return cachedToken;
  }

  function getSession() {
    if (session && !session.closed && !session.destroyed) return session;
    session = connect(`https://${host}`);
    session.on('error', () => {
      session = null;
    });
    session.on('close', () => {
      session = null;
    });
    return session;
  }

  function request(headers, body) {
    return new Promise((resolve, reject) => {
      let stream;
      try {
        stream = getSession().request(headers);
      } catch (err) {
        reject(err);
        return;
      }
      let raw = '';
      let status = 0;
      stream.setEncoding('utf8');
      stream.on('response', (h) => {
        status = Number(h[':status']);
      });
      stream.on('data', (chunk) => {
        raw += chunk;
      });
      stream.on('error', reject);
      stream.on('end', () => resolve({ status, raw }));
      stream.end(body);
    });
  }

  return {
    name: 'apns',

    async send({ token, platform, message }) {
      if (!keyId || !teamId || !privateKey) {
        return { ok: false, retryable: false, reason: 'apns-not-configured' };
      }

      const payload = JSON.stringify({
        aps: {
          alert: { title: message.title, body: message.body },
          sound: 'default',
          // Time-sensitive is the one Apple affordance that matters here: it
          // breaks through Focus for an urgent crossing, and deliberately does
          // not for a "cleared" or a peak.
          'interruption-level': message.urgent ? 'time-sensitive' : 'active',
          'relevance-score': message.urgent ? 1 : 0.5,
          'thread-id': message.data?.cellKey ?? 'smokeshow',
        },
        smokeshow: message.data ?? {},
      });

      const headers = {
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${providerToken()}`,
        'apns-topic': topics[platform] || topic,
        'apns-push-type': 'alert',
        'apns-priority': message.urgent ? '10' : '5',
        'apns-expiration': String(Math.floor(now() / 1000) + ALERT_TTL_SEC),
        // Second line of defence behind the dedupe claim: if two runs ever do
        // race to the same transition, the OS collapses them into one banner.
        'apns-collapse-id': String(message.collapseId ?? '').slice(0, 64),
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      };

      let response;
      try {
        response = await request(headers, payload);
      } catch (err) {
        session = null;
        return { ok: false, retryable: true, reason: `apns-transport: ${err.message}` };
      }

      if (response.status === 200) return { ok: true, status: 200 };

      let reason = '';
      try {
        reason = JSON.parse(response.raw)?.reason ?? '';
      } catch {
        reason = response.raw?.slice(0, 120) ?? '';
      }

      if (response.status === 410 || DEAD_TOKEN_REASONS.has(reason)) {
        return { ok: false, invalidToken: true, status: response.status, reason };
      }
      // The provider token aged out mid-run; drop the cache so the retry
      // signs a fresh one.
      if (reason === 'ExpiredProviderToken') {
        cachedToken = null;
        return { ok: false, retryable: true, status: response.status, reason };
      }
      if (RETRYABLE_STATUS.has(response.status)) {
        return { ok: false, retryable: true, status: response.status, reason };
      }
      return { ok: false, retryable: false, status: response.status, reason };
    },

    close() {
      session?.close?.();
      session = null;
    },
  };
}
