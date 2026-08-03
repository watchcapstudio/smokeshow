// Provider-agnostic delivery: pick a sender by platform, retry what is worth
// retrying, and prune a token the moment its provider says it is dead.
//
// The retry budget is small on purpose. This is an hourly run and the alert
// carries a one-hour TTL — a message that cannot be delivered in a few seconds
// is a message whose news has aged, and burning the run's wall-clock on it
// delays every other subscriber's alert.

const PLATFORM_SENDER = {
  ios: 'apns',
  ipados: 'apns',
  macos: 'apns',
  android: 'fcm',
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

const sleepReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createDispatcher({
  senders = {},
  store,
  attempts = DEFAULT_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  sleep = sleepReal,
  random = Math.random,
  logger = null,
} = {}) {
  // Full jitter. Synchronised retries from one worker are a self-inflicted
  // 429 from the provider.
  function backoffMs(attempt) {
    const ceiling = Math.min(MAX_DELAY_MS, baseDelayMs * 2 ** attempt);
    return Math.floor(random() * ceiling);
  }

  return {
    async deliver({ device, message }) {
      const senderName = PLATFORM_SENDER[device.platform];
      const sender = senderName ? senders[senderName] : null;
      if (!sender) {
        return { delivered: false, reason: `no-sender-for-platform:${device.platform}`, retryable: false };
      }
      if (!device.pushToken) {
        return { delivered: false, reason: 'no-token', retryable: false };
      }

      let last = null;
      for (let attempt = 0; attempt < attempts; attempt++) {
        last = await sender.send({ token: device.pushToken, platform: device.platform, message });

        if (last.ok) return { delivered: true, attempts: attempt + 1, provider: sender.name };

        if (last.invalidToken) {
          // The subscription may still be alive — the install is not. Clearing
          // the token drops the device out of `listOccupiedCells()` on the next
          // run, so it stops costing anything until the app re-registers.
          await store.clearPushToken(device.id, device.pushToken);
          logger?.warn?.('push token invalidated', {
            deviceId: device.id,
            provider: sender.name,
            reason: last.reason,
          });
          return {
            delivered: false,
            reason: `token-invalid:${last.reason}`,
            retryable: false,
            tokenCleared: true,
            attempts: attempt + 1,
          };
        }

        if (!last.retryable) break;
        if (attempt < attempts - 1) await sleep(backoffMs(attempt));
      }

      return {
        delivered: false,
        reason: last?.reason ?? 'unknown',
        // Reported up so the caller can release its dedupe claim and let the
        // next run try this same transition again.
        retryable: Boolean(last?.retryable),
        attempts,
        provider: sender.name,
      };
    },

    close() {
      for (const sender of Object.values(senders)) sender?.close?.();
    },
  };
}
