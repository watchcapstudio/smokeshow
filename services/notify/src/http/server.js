import { createServer as createHttpServer } from 'node:http';

// node:http adapter over the pure router. The router takes a plain object and
// returns a plain object, which is what makes every route testable without a
// socket — see test/routes.test.js.

const MAX_BODY_BYTES = 64 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

export function createServer({ handle, logger = null }) {
  return createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = null;
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw);
    } catch (err) {
      const status = err.status ?? 400;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'bad-request', message: err.message } }));
      return;
    }

    const result = await handle({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body,
    });

    logger?.debug?.('request', { method: req.method, path: url.pathname, status: result.status });
    res.writeHead(result.status, result.headers);
    res.end(JSON.stringify(result.body));
  });
}
