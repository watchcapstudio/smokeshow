import { cellStateFrom, diffCellState, hasAnyChange } from './events.js';
import { fanOutCell } from './fanout.js';

// The evaluation loop. One pass per hourly model run, never on a schedule
// per user.
//
// Cost is O(unique occupied cells) — one forecast fetch and one verdict diff
// each — plus O(subscribers in changed cells) for fan-out, which on a quiet
// day is zero. Ten thousand subscribers in Denver is one fetch, one diff, and
// on most runs, one comparison that finds nothing.
//
// Ordering inside a cell is deliberate:
//
//   fetch -> diff -> fan out -> THEN store the new state
//
// Storing last means a crash mid-fan-out replays the transition on the next
// run, where the dedupe claims already made suppress the sends that got
// through and the rest go out an hour late. Storing first would lose them
// entirely. Late beats never; duplicate beats neither, which is why the claim
// is what guarantees the difference.

const DEFAULT_CONCURRENCY = 8;
const SENT_RETENTION_MS = 7 * 24 * 3600_000;

async function pool(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function evaluateCell({ store, dispatcher, cellKey, fetchForecast, nowMs, minGapMs, logger }) {
  let payload;
  try {
    payload = await fetchForecast(cellKey);
  } catch (err) {
    logger?.warn?.('forecast fetch threw', { cellKey, error: err.message });
    payload = null;
  }
  // A failed fetch is not a state change. Leaving the stored state untouched
  // means the next successful run diffs against the last thing we actually
  // knew, so an upstream outage delays alerts rather than inventing them.
  if (!payload) return { cellKey, status: 'fetch-failed' };

  const next = cellStateFrom(payload);
  if (!next) return { cellKey, status: 'unusable-payload' };

  const prev = await store.getCellState(cellKey);
  if (!prev) {
    // First sighting of this cell: seed and stay silent. Subscribing is not a
    // state change, and a push on registration would be an engagement ping.
    await store.putCellState(cellKey, next);
    return { cellKey, status: 'seeded' };
  }

  const transition = diffCellState(prev, next);
  if (!hasAnyChange(transition)) {
    await store.putCellState(cellKey, next);
    return { cellKey, status: 'no-change' };
  }

  const counts = await fanOutCell({
    store,
    dispatcher,
    cellKey,
    transition,
    next,
    nowMs,
    minGapMs,
    logger,
  });
  await store.putCellState(cellKey, next);

  return { cellKey, status: 'changed', transition, counts };
}

export async function runEvaluation({
  store,
  dispatcher,
  fetchForecast,
  nowMs = Date.now(),
  concurrency = DEFAULT_CONCURRENCY,
  minGapMs,
  logger = null,
  retentionMs = SENT_RETENTION_MS,
} = {}) {
  const startedMs = Date.now();
  const cells = await store.listOccupiedCells(nowMs);

  const results = await pool(cells, concurrency, (cellKey) =>
    evaluateCell({ store, dispatcher, cellKey, fetchForecast, nowMs, minGapMs, logger }),
  );

  const summary = {
    cells: cells.length,
    seeded: 0,
    changed: 0,
    unchanged: 0,
    failed: 0,
    matched: 0,
    sent: 0,
    quietSuppressed: 0,
    rateLimited: 0,
    deduped: 0,
    deliveryFailed: 0,
    durationMs: 0,
  };

  for (const result of results) {
    if (result.status === 'seeded') summary.seeded++;
    else if (result.status === 'no-change') summary.unchanged++;
    else if (result.status === 'changed') {
      summary.changed++;
      summary.matched += result.counts.matched;
      summary.sent += result.counts.sent;
      summary.quietSuppressed += result.counts.quietSuppressed;
      summary.rateLimited += result.counts.rateLimited;
      summary.deduped += result.counts.deduped;
      summary.deliveryFailed += result.counts.failed;
    } else summary.failed++;
  }

  if (retentionMs > 0) await store.pruneSent?.(nowMs - retentionMs);

  summary.durationMs = Date.now() - startedMs;
  logger?.info?.('evaluation run complete', summary);
  return summary;
}
