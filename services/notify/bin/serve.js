#!/usr/bin/env node
import { bootstrap } from '../src/bootstrap.js';
import { createRouter } from '../src/http/routes.js';
import { createServer } from '../src/http/server.js';

// The registry API. Small, stateless, and separate from the worker: the app
// talks to this, and the cron talks to the database. Neither blocks the other.

const { config, logger, store } = await bootstrap();

const handle = createRouter({ store, config, logger });
const server = createServer({ handle, logger });

server.listen(config.port, () => {
  logger.info('notify api listening', {
    port: config.port,
    forecastBase: config.forecastBase,
    store: config.databaseUrl ? 'postgres' : 'memory',
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
  });
}
