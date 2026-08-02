// Ports trendAt() from the demo (public/ifhghs/demo/index.html ~line 766):
// a 6-hour lookahead slope with a ±4 µg/m³ deadband, suppressed entirely
// below 12 µg/m³ (both readings so faint that any "trend" reads as noise).
//
// This answers a different question than computeVerdict()'s `trend` field:
// trendAt is short-horizon slope ("is it getting better or worse right
// now"), computeVerdict.trend is threshold-crossing ("will it ever cross
// the fire line in the 5-day window"). They can legitimately disagree —
// PM2.5 can dip locally while still never sustaining a real clear — and a UI
// that surfaces trendAt's raw slope next to computeVerdict's headline can
// end up contradicting itself ("Improving" next to "No clear air in the
// 5-day window"). trendAt() takes the verdict and mutes exactly that case.

const LOOKAHEAD_HOURS = 6;
const DEADBAND = 4;
const QUIET_FLOOR = 12;

// Pure slope: the 6-hour-ahead reading minus the reading at `index`, bucketed
// through the deadband. No knowledge of verdict/headline semantics.
export function trendSlope(pm25, index) {
  const now = pm25[index] ?? 0;
  const aheadIdx = Math.min(pm25.length - 1, index + LOOKAHEAD_HOURS);
  const ahead = pm25[aheadIdx] ?? 0;

  if (Math.max(ahead, now) < QUIET_FLOOR) return 'steady';
  const delta = ahead - now;
  if (delta >= DEADBAND) return 'rising';
  if (delta <= -DEADBAND) return 'falling';
  return 'steady';
}

// Guarded trend: same slope calculation, but muted to 'steady' whenever it
// would contradict computeVerdict()'s trend (see module comment). `verdict`
// is the object returned by computeVerdict() — pass null/undefined to skip
// the guard and get the raw slope.
export function trendAt(pm25, index, verdict) {
  const raw = trendSlope(pm25, index);
  if (!verdict) return raw;
  // "stuck" means computeVerdict found no sustained clear anywhere in the
  // 5-day window — a local downward wiggle isn't "improving".
  if (verdict.trend === 'stuck' && raw === 'falling') return 'steady';
  // "clearing" means a sustained clear is already locked in — a local
  // upward wiggle before it isn't "getting worse".
  if (verdict.trend === 'clearing' && raw === 'rising') return 'steady';
  return raw;
}
