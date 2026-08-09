import { bootstrap } from '../services/notify/src/bootstrap.js';
import { createRouter } from '../services/notify/src/http/routes.js';

// Same-origin Vercel adapter for the notification registry. `vercel.json`
// rewrites /v1/* here so the native apps can use smokeshow.earth as their
// fallback service URL without knowing about Vercel's /api filesystem.

let routerPromise;

function router() {
  routerPromise ??= bootstrap().then(({ store, config, logger }) =>
    createRouter({ store, config, logger }),
  );
  return routerPromise;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function handler(request) {
  const url = new URL(request.url);
  const rewrittenPath = url.searchParams.get('__notify_path');
  const path = rewrittenPath ? `/${rewrittenPath}` : url.pathname;

  let body = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 64 * 1024) {
      return json(413, { error: { code: 'bad-request', message: 'payload too large' } });
    }
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, { error: { code: 'bad-request', message: 'invalid JSON' } });
      }
    }
  }

  const handle = await router();
  const result = await handle({
    method: request.method,
    path,
    query: Object.fromEntries(url.searchParams),
    headers: Object.fromEntries(request.headers),
    body,
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: result.headers,
  });
}
