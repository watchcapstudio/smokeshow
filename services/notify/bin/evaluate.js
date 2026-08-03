#!/usr/bin/env node
import { bootstrap } from '../src/bootstrap.js';
import { runEvaluation } from '../src/evaluate.js';

// The hourly worker. Run it on a cron a few minutes after the model run lands
// (CAMS publishes on the hour; :10 is a safe offset):
//
//   10 * * * *  node services/notify/bin/evaluate.js
//
// It is idempotent. Running it twice in the same hour re-diffs against the
// state it already stored, finds nothing, and sends nothing — and even if a
// transition were somehow re-detected, the dedupe claims would swallow it.
// That property is what makes it safe to retry a failed run.

const { config, logger, store, dispatcher, fetchForecast } = await bootstrap();

try {
  const summary = await runEvaluation({
    store,
    dispatcher,
    fetchForecast,
    concurrency: config.cellConcurrency,
    minGapMs: config.minGapMs,
    logger,
  });
  dispatcher.close();
  // A run that fetched nothing successfully is an outage, not a quiet day —
  // exit non-zero so the scheduler's alerting notices.
  process.exit(summary.cells > 0 && summary.failed === summary.cells ? 1 : 0);
} catch (err) {
  logger.error('evaluation run failed', { error: err.message, stack: err.stack });
  process.exit(1);
}
