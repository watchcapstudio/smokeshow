import { googleAssertion } from './jwt.js';

// FCM HTTP v1. Same verdict shape as the APNs sender (see apns.js) so the
// dispatcher never branches on provider.
//
// v1 rather than the legacy endpoint: legacy is retired, and v1's error model
// is the one that tells you a token is dead precisely enough to prune it.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_SKEW_MS = 60_000;
const ALERT_TTL_SEC = 3600;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// UNREGISTERED is the app being uninstalled. INVALID_ARGUMENT at v1 means a
// malformed token — also unrecoverable, and also worth pruning, because the
// alternative is retrying it hourly for the life of the service.
const DEAD_TOKEN_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'SENDER_ID_MISMATCH']);

export function createFcmSender({
  projectId,
  clientEmail,
  privateKey,
  now = () => Date.now(),
  fetchImpl = fetch,
  channelId = 'smokeshow_alerts',
} = {}) {
  let accessToken = null;
  let expiresAtMs = 0;

  async function bearer() {
    if (accessToken && now() + TOKEN_SKEW_MS < expiresAtMs) return accessToken;
    const assertion = googleAssertion({ clientEmail, privateKey, nowSec: Math.floor(now() / 1000) });
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) throw new Error(`fcm-oauth ${res.status}`);
    const body = await res.json();
    accessToken = body.access_token;
    expiresAtMs = now() + Number(body.expires_in ?? 3600) * 1000;
    return accessToken;
  }

  return {
    name: 'fcm',

    async send({ token, message }) {
      if (!projectId || !clientEmail || !privateKey) {
        return { ok: false, retryable: false, reason: 'fcm-not-configured' };
      }

      let auth;
      try {
        auth = await bearer();
      } catch (err) {
        // A token-endpoint failure is transient far more often than not, and
        // it affects every send in the run — retry rather than discarding a
        // whole model run's alerts.
        accessToken = null;
        return { ok: false, retryable: true, reason: `fcm-oauth: ${err.message}` };
      }

      const body = {
        message: {
          token,
          notification: { title: message.title, body: message.body },
          // FCM data values must be strings; the app parses them back.
          data: Object.fromEntries(
            Object.entries(message.data ?? {}).map(([k, v]) => [k, String(v)]),
          ),
          android: {
            priority: message.urgent ? 'high' : 'normal',
            collapse_key: String(message.collapseId ?? 'smokeshow'),
            ttl: `${ALERT_TTL_SEC}s`,
            notification: { channel_id: channelId, tag: message.data?.cellKey ?? 'smokeshow' },
          },
        },
      };

      let res;
      try {
        res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err) {
        return { ok: false, retryable: true, reason: `fcm-transport: ${err.message}` };
      }

      if (res.ok) return { ok: true, status: res.status };

      let code = '';
      let reason = '';
      try {
        const err = await res.json();
        reason = err?.error?.status ?? err?.error?.message ?? '';
        code =
          err?.error?.details?.find((d) => d['@type']?.includes('FcmError'))?.errorCode ??
          err?.error?.status ??
          '';
      } catch {
        reason = `http ${res.status}`;
      }

      if (res.status === 401 || res.status === 403) {
        accessToken = null; // stale bearer; the retry mints a new one
        return { ok: false, retryable: true, status: res.status, reason };
      }
      if (res.status === 404 || DEAD_TOKEN_CODES.has(code)) {
        return { ok: false, invalidToken: true, status: res.status, reason: reason || code };
      }
      if (RETRYABLE_STATUS.has(res.status)) {
        return { ok: false, retryable: true, status: res.status, reason };
      }
      return { ok: false, retryable: false, status: res.status, reason };
    },

    close() {},
  };
}
