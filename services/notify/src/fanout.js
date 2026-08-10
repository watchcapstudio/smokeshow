import { selectEvent } from './events.js';
import { passesQuietHours } from './quietHours.js';
import { cellCoords } from './cells.js';
import { DEFAULT_THRESHOLD } from './store.js';

// Fan-out: the only per-subscriber work in a run.
//
// Four gates stand between a cell transition and a person's lock screen, in
// this order, and the order is the design:
//
//   1. threshold   — is this change one they asked about?          (events.js)
//   2. quiet hours — is it their night, and is this urgent enough? (quietHours.js)
//   3. rate limit  — have we already spoken about this place recently?
//   4. dedupe      — has this exact transition already been sent?  (store claim)
//
// Gate 4 is the one that makes the guarantee: one state change produces
// exactly one notification per device. The claim is keyed by device and by the
// *transition*, not by the run, so a retried run, a crashed run resumed, or a
// device that has subscribed to the same cell under two different labels all
// collapse to a single send.

// A place we have already spoken about within this window gets silence unless
// the news is urgent. This is a spam guard, not a schedule: it can only ever
// remove notifications.
export const DEFAULT_MIN_GAP_MS = 3 * 3600_000;

export function buildMessage({ event, next, location }) {
  const { lat, lon } = cellCoords(event.cellKey);
  return {
    title: event.title,
    body: event.body,
    urgent: event.urgent,
    collapseId: event.dedupeKey,
    data: {
      type: event.type,
      cellKey: event.cellKey,
      lat,
      lon,
      label: location?.label ?? null,
      levelIndex: next.levelIndex,
      headline: next.headline,
      observedAtUTC: next.observedAtUTC,
      clearAtUTC: next.clearAtUTC,
      arrivalAtUTC: next.arrivalAtUTC,
      peakAtUTC: next.peakAtUTC,
    },
  };
}

function notificationTypeEnabled(device, eventType) {
  const choices = device.notificationTypes;
  if (!choices) return true; // Records created before this preference existed.
  if (eventType === 'incoming') return choices.inbound !== false;
  if (eventType === 'peak-reached') return choices.peak !== false;
  if (eventType === 'cleared') return choices.clear !== false;
  return true; // The core threshold-crossed alert is what enables alerts.
}

export async function fanOutCell({
  store,
  dispatcher,
  cellKey,
  transition,
  next,
  nowMs,
  minGapMs = DEFAULT_MIN_GAP_MS,
  logger = null,
}) {
  const counts = { matched: 0, quietSuppressed: 0, rateLimited: 0, deduped: 0, sent: 0, failed: 0 };
  const subscribers = await store.listCellSubscribers(cellKey, nowMs);

  for (const { device, location } of subscribers) {
    const threshold = location.threshold ?? device.threshold ?? DEFAULT_THRESHOLD;
    const event = selectEvent({
      transition,
      next,
      cellKey,
      threshold,
      sensitiveHousehold: device.sensitiveHousehold,
      label: location.label,
    });
    if (!event) continue;
    if (!notificationTypeEnabled(device, event.type)) continue;
    counts.matched++;

    if (!passesQuietHours({ event, device, timezone: next.timezone, atMs: nowMs })) {
      counts.quietSuppressed++;
      continue;
    }

    const previousMs = await store.lastNotifiedAt(device.id, cellKey);
    if (!event.urgent && previousMs != null && nowMs - previousMs < minGapMs) {
      counts.rateLimited++;
      continue;
    }

    const claimed = await store.claimNotification({
      deviceId: device.id,
      dedupeKey: event.dedupeKey,
      cellKey,
      sentAtMs: nowMs,
    });
    if (!claimed) {
      counts.deduped++;
      continue;
    }

    const result = await dispatcher.deliver({
      device,
      message: buildMessage({ event, next, location }),
    });

    if (result.delivered) {
      counts.sent++;
      continue;
    }

    counts.failed++;
    // Only a retryable failure gets its claim back. A dead token or a
    // permanent rejection must stay claimed, or every subsequent run would
    // re-attempt the same undeliverable message forever.
    if (result.retryable) {
      await store.releaseNotification({
        deviceId: device.id,
        dedupeKey: event.dedupeKey,
        cellKey,
        previousMs,
      });
    }
    logger?.warn?.('delivery failed', {
      deviceId: device.id,
      cellKey,
      type: event.type,
      reason: result.reason,
      retryable: result.retryable,
    });
  }

  return counts;
}
