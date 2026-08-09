import { timingSafeEqual } from 'node:crypto';
import { bootstrap } from '../services/notify/src/bootstrap.js';
import { runEvaluation } from '../services/notify/src/evaluate.js';

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const response = (status, body) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

// Vercel invokes this at :10 past each hour. It is deliberately callable only
// with Vercel's CRON_SECRET bearer credential; previews and casual requests
// cannot run the paid forecast/push loop.
export default async function handler(request) {
  if (request.method !== 'GET') return response(405, { error: 'method-not-allowed' });
  if (!authorized(request)) return response(401, { error: 'unauthorized' });

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
    const allFailed = summary.cells > 0 && summary.failed === summary.cells;
    return response(allFailed ? 502 : 200, summary);
  } catch (error) {
    logger.error('evaluation run failed', { error: error.message, stack: error.stack });
    return response(500, { error: 'evaluation-failed' });
  } finally {
    dispatcher.close();
    await store.close?.();
  }
}
