# services/notify

The notification backend for the paid iOS, macOS, and Android apps. Design
rationale and the load estimate live in
[`docs/smokeshow-notify-backend.md`](../../docs/smokeshow-notify-backend.md);
this file is how to run it.

**Threshold alerts only. No digests, no streaks, no engagement pings.**

> Server state here is intentional and scoped: `CLAUDE.md`'s static-first rule
> governs the web product, which has no notifications. Nothing in this
> directory is imported by `src/` or `api/` — the dependency runs one way, into
> `src/lib/{grid,rating,verdict,forecast}.js`, so the lattice and the rating
> scale cannot drift from the web's.

## Two processes

```sh
node services/notify/bin/serve.js      # the device registry API
node services/notify/bin/evaluate.js   # the hourly worker — run on a cron
```

```cron
10 * * * *  node /srv/smokeshow/services/notify/bin/evaluate.js
```

`:10` past the hour: CAMS publishes on the hour, and the worker should read a
run that has landed. The worker is idempotent — running it twice in an hour
diffs against the state it already stored, finds nothing, and sends nothing.
That is what makes a failed run safe to retry.

## Setup

For the hosted Supabase database, link the repository once and apply the
committed migrations:

```sh
supabase link --project-ref <project-ref>
supabase db push
```

For any other Postgres host, the canonical schema can still be applied
directly:

```sh
psql "$NOTIFY_DATABASE_URL" -f services/notify/schema.sql
```

With `NOTIFY_DATABASE_URL` unset the service runs on the in-memory store and
loses everything on restart. That is fine for local work and for the tests; it
is not a deployment.

`pg` is a production dependency because the Vercel registry and evaluator use
the same durable store.

## Vercel deployment

The production adapters live at:

| Route | Purpose |
| --- | --- |
| `/v1/devices` and `/v1/devices/:id` | Same-origin native device registry |
| `/v1/webhooks/revenuecat` | RevenueCat entitlement webhook |
| `/api/notify-evaluate` | Secret-protected hourly evaluator |

`vercel.json` invokes the evaluator at `:10` past every hour. Set
`CRON_SECRET` so Vercel signs those requests, and use Supabase's **transaction
pooler** connection string (port `6543`) for `NOTIFY_DATABASE_URL`. The schema
is fully qualified in every query, which keeps it safe under transaction
pooling.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `NOTIFY_PORT` | `8787` | Registry API port |
| `NOTIFY_FORECAST_BASE` | `https://smokeshow.earth` | Where `/api/forecast` lives |
| `NOTIFY_DATABASE_URL` | — | Postgres. Unset ⇒ in-memory. Use Supabase's transaction pooler URL in Vercel |
| `NOTIFY_DATABASE_SCHEMA` | `smokeshow_notify` | Private Postgres schema used by the service |
| `NOTIFY_DATABASE_POOL_MAX` | `5` | Per-instance Postgres client pool limit |
| `NOTIFY_CELL_CONCURRENCY` | `8` | Parallel cell fetches. Raise with the cell count — see the load estimate |
| `NOTIFY_MIN_GAP_MS` | `10800000` | Minimum gap between non-urgent alerts for one place (3 h) |
| `NOTIFY_REQUIRE_ENTITLEMENT` | `true` | Set `false` to notify every registered device before RevenueCat is connected |
| `NOTIFY_LOG_LEVEL` | `info` | `debug` logs every request |
| `CRON_SECRET` | — | **Required on Vercel.** Authorizes the hourly evaluator |
| `REVENUECAT_WEBHOOK_SECRET` | — | Required only when entitlement gating is enabled. Unset means the webhook rejects everything |
| `REVENUECAT_ENTITLEMENT_ID` | `smokeshow_pro` | Which entitlement gates notifications; must match the app and RevenueCat dashboard |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8` | — | Apple provider token (ES256 `.p8`) |
| `APNS_TOPIC`, `APNS_TOPIC_IOS`, `APNS_TOPIC_MACOS` | — | Bundle IDs; the per-platform ones win |
| `APNS_HOST` | `api.push.apple.com` | `api.sandbox.push.apple.com` in development |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | — | Firebase service account |

Literal `\n` in a key is unescaped for you — secret managers almost always
deliver PEMs that way.

## API

All responses are JSON and `no-store`.

| | |
| --- | --- |
| `POST /v1/devices` | Register. Returns `deviceId` and `deviceSecret` **once** |
| `GET /v1/devices/:id` | Current settings. Bearer `deviceSecret` |
| `PATCH /v1/devices/:id` | Update token, locations, threshold, quiet hours, sensitive flag, enabled |
| `DELETE /v1/devices/:id` | Complete erasure |
| `POST /v1/webhooks/revenuecat` | Entitlement events. `Authorization: <shared secret>` |
| `GET /healthz` | Liveness |

```jsonc
// POST /v1/devices
{
  "platform": "ios",                       // ios | ipados | macos | android
  "pushToken": "…",
  "timezone": "America/Denver",            // IANA; used for quiet hours
  "threshold": 2,                          // rating index 0-4 — 2 is "Hazy"
  "quietHours": { "enabled": true, "startHour": 22, "endHour": 7 },
  "notificationTypes": { "inbound": true, "peak": true, "clear": true },
  "sensitiveHousehold": false,             // urgent one level earlier
  "locations": [                           // max 10; each may override `threshold`
    { "label": "Home", "lat": 39.7392, "lon": -104.9903 }
  ]
}
```

A bad secret returns **404**, not 401 — a distinguishable 401 would confirm
which device IDs exist.

## Push payloads

APNs carries the alert in `aps` and the deep-link data under `smokeshow`;
FCM carries `notification` plus a string-valued `data` map. Both hold the same
fields: `type`, `cellKey`, `lat`, `lon`, `label`, `levelIndex`, `headline`,
`observedAtUTC`, `clearAtUTC`, `arrivalAtUTC`, `peakAtUTC`.

Urgent alerts use APNs `interruption-level: time-sensitive` with priority 10
and FCM `high`; everything else is priority 5 / `normal`. Both set a collapse
ID equal to the dedupe key, so even a hypothetical race collapses to one banner
on the device.

## Tests

```sh
npm test                                   # the repo suite includes this service
npx vitest run services/notify
```

The load benchmark is reproducible:

```sh
node services/notify/bin/loadcheck.js 10000 5500
```

## Layout

```
bin/evaluate.js      hourly worker
bin/serve.js         registry API
bin/loadcheck.js     the benchmark behind the load estimate
schema.sql           Postgres DDL — the memory store mirrors it exactly
src/cells.js         the lattice: snapCoord() -> cell key. The cost model
src/events.js        cell state, the diff, and per-subscriber event selection
src/evaluate.js      the run: cells -> fetch -> diff -> fan out
src/fanout.js        threshold, quiet hours, rate limit, dedupe claim
src/quietHours.js    10 PM-7 AM local, urgent only, applied at fan-out
src/entitlements.js  RevenueCat webhook -> the server-side gate
src/store.js         storage interface + in-memory implementation
src/store.pg.js      the same interface over Postgres
src/forecastClient.js  the one upstream: /api/forecast, contract v1
src/push/            APNs, FCM, JWT signing, retry/invalidation dispatcher
src/http/            router (pure) + node:http adapter
```
