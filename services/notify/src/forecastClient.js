import { cellCoords, cellKeyFor } from './cells.js';

// The only upstream this service reads: `/api/forecast` (contract v1).
//
// The service does not compute verdicts. It cannot: `docs/forecast-api-contract.md`
// §6 is explicit that a client which recomputes a clear-time from `hours[]` is
// a bug even when it agrees. A notification that says "clears 6 PM" while the
// app says 9 PM is the exact failure the endpoint exists to prevent, and a
// push is the one surface the user cannot refresh.
//
// So: fetch the payload, read `verdict`, diff `verdict`. Nothing else.

export const DEFAULT_TIMEOUT_MS = 10_000;
const CONTRACT_VERSION = 1;

export function forecastUrl(base, { lat, lon }) {
  return `${String(base).replace(/\/$/, '')}/api/forecast?lat=${lat}&lon=${lon}`;
}

export function createForecastClient({
  base,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = null,
} = {}) {
  return async function fetchForecast(cellKey) {
    const coords = cellCoords(cellKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(forecastUrl(base, coords), {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        logger?.warn?.('forecast non-200', { cellKey, status: res.status });
        return null;
      }
      const payload = await res.json();

      // Contract §9: an unrecognised `v` or an error envelope means the
      // forecast is unavailable. Degrade — which for this service means "no
      // state change observed" — rather than parsing a shape we do not know.
      if (payload?.v !== CONTRACT_VERSION || payload?.error) {
        logger?.warn?.('forecast unusable', { cellKey, v: payload?.v, code: payload?.error?.code });
        return null;
      }

      // We send lattice coordinates because the lattice is what makes this
      // service affordable, but the endpoint owns the lattice. If it ever
      // re-snaps our request somewhere else, every stored cell state is keyed
      // against a grid that no longer exists — a migration, not a warning to
      // discover in production.
      const snapped = payload.location?.snapped;
      if (snapped && cellKeyFor(snapped.lat, snapped.lon) !== cellKey) {
        logger?.warn?.('lattice drift: /api/forecast snapped outside our cell', {
          cellKey,
          snapped,
        });
      }
      return payload;
    } catch (err) {
      logger?.warn?.('forecast fetch failed', { cellKey, error: err.message });
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
