import { ARRIVAL_THRESHOLD, levelForPM25 } from './rating.js';

// "Clears Thursday ~6 PM" must survive one-hour head-fake dips (share spec):
// a clearing only counts if PM2.5 stays below the Smells-like-fire threshold
// for 6+ consecutive hours. Arrivals use a shorter 3-hour hold — a brief
// spike still matters more than a brief dip.
const CLEAR_HOLD_HOURS = 6;
const ARRIVE_HOLD_HOURS = 3;

function firstSustainedCrossing(pm25, fromIndex, holdHours, isPast) {
  for (let i = fromIndex; i < pm25.length; i++) {
    if (!isPast(pm25[i])) continue;
    let holds = true;
    const holdEnd = Math.min(i + holdHours, pm25.length);
    for (let k = i; k < holdEnd; k++) {
      if (!isPast(pm25[k])) {
        holds = false;
        break;
      }
    }
    if (holds) return i;
  }
  return null;
}

// Pure index math — no dates, no formatting. Callers (app UI, share card,
// OG edge function) each format indices with their own timezone handling.
export function computeVerdict({ pm25, nowIndex }) {
  const above = (pm25[nowIndex] ?? 0) >= ARRIVAL_THRESHOLD;
  const clearIdx = above
    ? firstSustainedCrossing(pm25, nowIndex + 1, CLEAR_HOLD_HOURS, (v) => v < ARRIVAL_THRESHOLD)
    : null;
  const arrivalIdx = !above
    ? firstSustainedCrossing(pm25, nowIndex + 1, ARRIVE_HOLD_HOURS, (v) => v >= ARRIVAL_THRESHOLD)
    : null;

  let peakIdx = nowIndex;
  for (let i = nowIndex; i < pm25.length; i++) {
    if ((pm25[i] ?? -Infinity) > (pm25[peakIdx] ?? -Infinity)) peakIdx = i;
  }

  let trend = 'steady';
  if (above) trend = clearIdx != null ? 'clearing' : 'stuck';
  else if (arrivalIdx != null) trend = 'worsening';

  const nowLevelIndex = levelForPM25(pm25[nowIndex])?.index ?? 0;
  return { above, clearIdx, arrivalIdx, peakIdx, trend, nowLevelIndex };
}

// A headline names a number only when the model FOUND one. The three
// no-crossing headlines below used to count the window instead ("for the next
// 5 days", "in 5 days"), and readers cannot tell that number apart from the
// one in "Clears Thursday ~6 PM" — so they read the 5 as a finding about day 5
// and infer that day 6 goes bad. It never was a finding: it is
// FORECAST_DAYS in forecast.js, the edge of what we can see. Every
// no-crossing case therefore names the horizon rather than counting it, and
// they share one tail so the set reads as a single voice.
const HORIZON = 'as far as the forecast goes';

// formatIdx(i) -> "Thursday ~6 PM" (the ~ is the caller's responsibility to include)
export function verdictHeadline(verdict, formatIdx) {
  if (verdict.above) {
    return verdict.clearIdx != null
      ? `Clears ${formatIdx(verdict.clearIdx)}`
      : `No clear air ${HORIZON}`;
  }
  if (verdict.arrivalIdx != null) return `Smoke arrives ${formatIdx(verdict.arrivalIdx)}`;
  // "No smoke" would contradict a Something's-in-the-air rating — phrase the
  // promise as what it actually is: never crossing the fire threshold.
  return verdict.nowLevelIndex === 0
    ? `Clear ${HORIZON}`
    : `Below Smells-like-fire ${HORIZON}`;
}
