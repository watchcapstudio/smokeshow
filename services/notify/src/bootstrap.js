import { loadConfig, createLogger } from './config.js';
import { createMemoryStore } from './store.js';
import { createPgStore } from './store.pg.js';
import { createApnsSender } from './push/apns.js';
import { createFcmSender } from './push/fcm.js';
import { createDispatcher } from './push/dispatcher.js';
import { createForecastClient } from './forecastClient.js';

// Wiring, in one place, shared by the HTTP process and the hourly worker.
// Both need the same store and the same entitlement view; only the worker
// needs push senders.

export async function openStore(config, logger) {
  if (!config.databaseUrl) {
    logger?.warn?.('NOTIFY_DATABASE_URL unset — using the in-memory store (state is lost on restart)');
    return createMemoryStore();
  }
  // `pg` is an optional peer: the tests and local runs never need it, so it is
  // not a hard dependency of the repo.
  const { default: pg } = await import('pg').catch(() => {
    throw new Error('NOTIFY_DATABASE_URL is set but the `pg` package is not installed');
  });
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  return createPgStore(pool);
}

export function createSenders(config) {
  return {
    apns: createApnsSender(config.apns),
    fcm: createFcmSender(config.fcm),
  };
}

export async function bootstrap(env = process.env) {
  const config = loadConfig(env);
  const logger = createLogger({ level: env.NOTIFY_LOG_LEVEL || 'info' });
  const store = await openStore(config, logger);
  return {
    config,
    logger,
    store,
    dispatcher: createDispatcher({ senders: createSenders(config), store, logger }),
    fetchForecast: createForecastClient({ base: config.forecastBase, logger }),
  };
}
