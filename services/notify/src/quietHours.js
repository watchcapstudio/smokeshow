// Quiet hours, applied at fan-out and not at send (platform plan §5).
//
// The distinction is the whole point. Applying it at send means the work of
// evaluating, matching, and queueing has already been paid for, and something
// downstream has to remember to drop the message. Applying it at fan-out means
// a suppressed alert costs one integer comparison and never becomes a queued
// job that a retry can resurrect at 3 AM.
//
// A suppressed non-urgent alert is *dropped*, not deferred. There is no
// morning digest, by product decision — so a 2 AM level bump that has already
// reversed by 7 AM correctly produces silence rather than stale news. If the
// air is still worse at breakfast, the next upward crossing fires normally.

const HOUR_CACHE = new Map(); // timezone -> Intl.DateTimeFormat

function formatterFor(timezone) {
  const key = timezone || 'UTC';
  let fmt = HOUR_CACHE.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone: key, hour: 'numeric', hourCycle: 'h23' });
    } catch {
      // An unknown zone must not take the run down; UTC is the honest fallback
      // and the only cost is a quiet window offset from the subscriber's.
      fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', hourCycle: 'h23' });
    }
    HOUR_CACHE.set(key, fmt);
  }
  return fmt;
}

export function localHourIn(timezone, atMs) {
  const part = formatterFor(timezone)
    .formatToParts(new Date(atMs))
    .find((p) => p.type === 'hour');
  const hour = Number(part?.value);
  return Number.isFinite(hour) ? hour % 24 : new Date(atMs).getUTCHours();
}

export function isWithinQuietWindow(hour, startHour, endHour) {
  if (startHour === endHour) return false; // degenerate config: never quiet
  // The window wraps midnight in the default 22 -> 7 case.
  return startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
}

// `timezone` resolves device-first, cell-second. The harm being prevented is
// waking a person, so their own zone wins when the device reports one. The
// cell's zone — `location.timezone` from the forecast payload — is the
// fallback, and for a home location the two are the same anyway. They diverge
// for a watched location elsewhere (a cabin, a parent's house), and there the
// device's night is the correct one.
export function isQuiet({ quietHours, timezone, atMs }) {
  if (!quietHours?.enabled) return false;
  const hour = localHourIn(timezone, atMs);
  return isWithinQuietWindow(hour, quietHours.startHour, quietHours.endHour);
}

// The gate itself: urgent alerts pass through the quiet window, everything
// else is dropped.
export function passesQuietHours({ event, device, timezone, atMs }) {
  if (event?.urgent) return true;
  return !isQuiet({ quietHours: device?.quietHours, timezone: device?.timezone || timezone, atMs });
}
