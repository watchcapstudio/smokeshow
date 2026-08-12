import { levelForPM25 } from '../../../src/lib/rating.js';

// State-change detection. Nothing in this service is scheduled: a run that
// finds no change sends nothing, forever, and that is the intended steady
// state. "Threshold alerts only. No digests, no streaks, no engagement pings."
//
// Two layers:
//   1. cellStateFrom() / diffCellState() — per *cell*, subscriber-independent.
//      Runs once per occupied cell per model run.
//   2. selectEvent() — per *subscriber*, applying their own threshold to the
//      cell transition. Cheap, and the only per-user work in the run.

// A subscriber is notified when the air crosses *their* threshold, but the
// urgency that overrides quiet hours is fixed by the scale, not by preference:
// "Heavy haze" is where smoke reaches indoors, one level earlier for a
// sensitive household.
export const URGENT_LEVEL = 3;
export const URGENT_LEVEL_SENSITIVE = 2;

// An arrival further out than this is a forecast, not an alert. Waking someone
// on Sunday about Wednesday's smoke is the engagement ping this service
// refuses to send.
export const INCOMING_HORIZON_HOURS = 36;

const HOUR_MS = 3600_000;

function ms(stamp) {
  if (!stamp) return null;
  const t = Date.parse(stamp);
  return Number.isNaN(t) ? null : t;
}

// The stored signature of a cell: everything a diff needs, and nothing else.
// Deliberately small — this row is written once per cell per hour forever, so
// it holds derived scalars rather than the 192-hour payload it came from.
export function cellStateFrom(payload) {
  const verdict = payload?.verdict;
  const now = payload?.now;
  if (!verdict || !now) return null;

  const peakLevelIndex =
    verdict.peakPm25 == null ? verdict.levelIndex : (levelForPM25(verdict.peakPm25)?.index ?? verdict.levelIndex);

  return {
    observedAtUTC: now.timeUTC,
    generatedAt: payload.generatedAt ?? null,
    timezone: payload.location?.timezone ?? 'UTC',
    levelIndex: verdict.levelIndex,
    // Shipped copy travels with the state so the push text is the same string
    // the app shows. CLAUDE.md requires this copy to ship verbatim; a level
    // name retyped in this service is a level name that drifts.
    levelName: payload.scale?.[verdict.levelIndex]?.name ?? null,
    above: verdict.above,
    trend: verdict.trend,
    headline: verdict.headline,
    clearAtUTC: verdict.clearAtUTC ?? null,
    arrivalAtUTC: verdict.arrivalAtUTC ?? null,
    peakAtUTC: verdict.peakAtUTC ?? null,
    peakPm25: verdict.peakPm25 ?? null,
    peakLevelIndex,
  };
}

// prev === null means this cell has no history — a brand-new subscriber, or a
// cell that emptied and refilled. Seed the state and send nothing. Otherwise
// the act of subscribing would itself produce a push, which is an engagement
// ping wearing a threshold alert's clothes.
export function diffCellState(prev, next) {
  if (!prev || !next) return null;

  const fromLevel = prev.levelIndex ?? 0;
  const toLevel = next.levelIndex ?? 0;
  const direction = toLevel > fromLevel ? 'up' : toLevel < fromLevel ? 'down' : 'none';

  const prevPeakAhead = ms(prev.peakAtUTC) != null && ms(prev.peakAtUTC) > ms(prev.observedAtUTC);
  const peakNowOrPast = ms(next.peakAtUTC) != null && ms(next.peakAtUTC) <= ms(next.observedAtUTC);

  const arrivalMs = ms(next.arrivalAtUTC);
  const observedMs = ms(next.observedAtUTC);
  const arrivalWithinHorizon =
    arrivalMs != null && observedMs != null && arrivalMs - observedMs <= INCOMING_HORIZON_HOURS * HOUR_MS;

  return {
    fromLevel,
    toLevel,
    direction,
    // Below the fire threshold after being above it — the "it's over" moment.
    cleared: Boolean(prev.above && !next.above),
    // The forecast peak has arrived: it was ahead of us last run and it is now
    // at or behind us. "This is as bad as it gets" is worth one push.
    peakReached: Boolean(next.above && prevPeakAhead && peakNowOrPast),
    // Smoke is newly forecast to arrive, and soon. Fires once per episode:
    // arrivalAtUTC stays non-null while the episode lasts, so model wobble in
    // the exact hour does not re-fire it.
    incoming: Boolean(!next.above && !prev.arrivalAtUTC && next.arrivalAtUTC && arrivalWithinHorizon),
  };
}

export function hasAnyChange(transition) {
  if (!transition) return false;
  return (
    transition.direction !== 'none' ||
    transition.cleared ||
    transition.peakReached ||
    transition.incoming
  );
}

function urgentFloor(sensitiveHousehold) {
  return sensitiveHousehold ? URGENT_LEVEL_SENSITIVE : URGENT_LEVEL;
}

function day(stamp) {
  return String(stamp ?? '').slice(0, 10);
}

function withLabel(text, label) {
  return label ? `${text} in ${label}` : text;
}

// One event per subscriber per cell per run, at most. The ordering below is
// the priority order, and it is exhaustive by design: a run that produced
// several changes for one person still produces one notification, because two
// pushes about the same air in the same minute is the duplicate this service
// exists to avoid.
export function selectEvent({ transition, next, cellKey, threshold, sensitiveHousehold = false, label = null }) {
  if (!hasAnyChange(transition)) return null;

  const { fromLevel, toLevel, direction } = transition;
  const levelName = next.levelName ?? null;
  const base = { cellKey, levelIndex: toLevel, headline: next.headline };

  // 1. Their threshold was crossed upward. The core alert.
  if (direction === 'up' && fromLevel < threshold && toLevel >= threshold) {
    return {
      ...base,
      type: 'threshold-crossed',
      urgent: toLevel >= urgentFloor(sensitiveHousehold),
      dedupeKey: `cross:${cellKey}:${fromLevel}>${toLevel}:${day(next.observedAtUTC)}`,
      title: withLabel(levelName ?? 'Smoke', label),
      body: next.headline,
    };
  }

  // 2. It's over. Never urgent — good news can wait until morning.
  if ((transition.cleared || direction === 'down') && fromLevel >= threshold && toLevel < threshold) {
    return {
      ...base,
      type: 'cleared',
      urgent: false,
      dedupeKey: `clear:${cellKey}:${toLevel}:${day(next.observedAtUTC)}`,
      title: withLabel(levelName ?? 'Clear', label),
      body: next.headline,
    };
  }

  // 3. The peak has arrived and it improves from here. Only meaningful to
  //    someone whose threshold the air is already above.
  if (transition.peakReached && toLevel >= threshold) {
    return {
      ...base,
      type: 'peak-reached',
      urgent: false,
      dedupeKey: `peak:${cellKey}:${next.peakAtUTC}`,
      title: withLabel(levelName ?? 'Smoke', label),
      body: next.headline,
    };
  }

  // 4. Smoke is coming, within the horizon, and it will cross their threshold.
  if (transition.incoming && toLevel < threshold && (next.peakLevelIndex ?? 0) >= threshold) {
    return {
      ...base,
      type: 'incoming',
      urgent: false,
      dedupeKey: `incoming:${cellKey}:${day(next.arrivalAtUTC)}`,
      title: withLabel('Smoke on the way', label),
      body: next.headline,
    };
  }

  return null;
}
