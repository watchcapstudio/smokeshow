// The directory's live levels: one reading per city page, for the hub and the
// corridor lists.
//
// WHY THIS EXISTS AT ALL, given that /smoke-forecast/ spent three revisions
// learning not to state conditions: the rule was never "a directory may not show
// today's air". It was that a STATIC file may not, because a constant baked into
// HTML is a claim nobody re-checks. Two attempts failed that way — "All clear:
// 50+ miles" and "clean day: 50+ miles" — and the second failed visibly, with six
// cities reading "In the air" on their own pages while the list showed a number.
//
// The fix for a directory that disagrees with its pages is not silence. It is
// reading the same source the pages read. So:
//
//   - the static HTML ships an EMPTY slot, and therefore claims nothing. A
//     crawler, a JS-off reader and a stale CDN copy all see a plain link list.
//   - the level is fetched at load and stamped with the time it was read, so a
//     reader can see how old it is instead of guessing.
//   - the level comes from levelForPM25, the same function the city page and the
//     native clients use, so the hub and the page cannot reach different
//     conclusions about the same air.
//
// The endpoint is one batched request for all 25 cities (api/levels.js), cached
// at the edge, so this costs one upstream call per cache window no matter how
// much traffic the directory gets.

import { levelForPM25 } from './rating.js';

export const LEVELS_CONTRACT_VERSION = 1;

// Hour index whose value counts as "now". Mirrors findNowIndex in openMeteo.js
// rather than importing it, because that module resolves a relative /api/aq URL
// at import time and this one has to run in an edge function too.
export function nowIndexFor(timesUTC, nowMs) {
  const now = new Date(nowMs);
  const stamp =
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}:00`;
  const exact = timesUTC.indexOf(stamp);
  if (exact !== -1) return exact;
  // Upstream occasionally starts the series an hour off. Fall back to the last
  // hour that is not in the future rather than guessing at index 0, which would
  // report midnight's air as current.
  let best = 0;
  for (let i = 0; i < timesUTC.length; i += 1) {
    if (Date.parse(`${timesUTC[i]}Z`) <= nowMs) best = i;
    else break;
  }
  return best;
}

// Pure: takes the cities we asked about and the upstream's parallel series list,
// returns the payload. Separated from the endpoint so it is testable without a
// network, the same split api/forecast.js uses.
export function buildLevelsPayload({ cities, series, nowMs }) {
  const out = [];
  for (const [i, city] of cities.entries()) {
    const entry = series[i];
    const times = entry?.hourly?.time;
    const pm = entry?.hourly?.pm2_5;
    if (!Array.isArray(times) || !Array.isArray(pm)) continue;
    const idx = nowIndexFor(times, nowMs);
    const value = pm[idx];
    const level = levelForPM25(value);
    // A city whose series came back without a usable value is omitted rather
    // than defaulted. An absent chip reads as "not known"; a defaulted one would
    // read as All clear, which is the failure mode this whole file exists to
    // avoid.
    if (!level || value == null || Number.isNaN(value)) continue;
    out.push({ slug: city.slug, key: level.key, name: level.name });
  }
  return {
    v: LEVELS_CONTRACT_VERSION,
    // The instant the reading is for, not the instant the payload was built, so
    // a cached response cannot present itself as fresher than its data.
    asOf: new Date(nowMs).toISOString(),
    cities: out,
  };
}

// Browser side. Fills the empty slots the generator emitted, one per city row.
// Deliberately additive and failure-tolerant: any error here leaves the page as
// the plain link list it shipped as.
export function applyCityLevels(root, payload, { timeZone } = {}) {
  if (!payload || payload.v !== LEVELS_CONTRACT_VERSION) return 0;
  const stamp = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timeZone || undefined,
    timeZoneName: 'short',
  }).format(new Date(payload.asOf));

  let filled = 0;
  for (const city of payload.cities ?? []) {
    // Attribute selector on the slug rather than an id, so the same payload can
    // fill the hub (25 rows) and a corridor page (a subset) with no branching.
    const slot = root.querySelector(`[data-city-level="${city.slug}"]`);
    if (!slot) continue;
    slot.textContent = `${city.name}, ${stamp}`;
    slot.dataset.level = city.key;
    filled += 1;
  }
  return filled;
}
