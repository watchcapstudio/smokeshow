# iOS notifications — production handoff

Prepared August 8, 2026 for Joe. No secret values are committed here.

## What is finished

- The native app registers APNs tokens against `/v1/devices`, stores its
  server-issued bearer credential in Keychain, syncs place/preferences, shows
  foreground notifications, refreshes widgets, and opens the matching place
  when a notification is tapped.
- The Vercel registry, RevenueCat webhook, and secret-protected hourly worker
  are implemented in `api/notify.js` and `api/notify-evaluate.js`.
- Supabase project `bwzsijftdluclooqnqxi` is in East US (North Virginia).
- Migration `20260809001500_notification_backend.sql` is already applied. Its
  six empty tables live in the private `smokeshow_notify` schema.
- The hourly job is configured for `:10` past every hour in `vercel.json`.
- Backend tests, Swift tests, the simulator app/widgets build, and the web
  production build pass on Kelly's machine.

## Branch

```sh
git fetch origin
git switch feat/unified-sky-sunset
git pull --ff-only
```

This branch contains the full current Apple feature stack plus one final
notification commit. The Vercel GitHub integration already creates previews
for this repository. Merge the branch to `main` (or deploy it explicitly) only
after adding the production environment variables below.

## 1. Add Vercel production environment variables

Target: the SmokeShow project in Vercel scope `joseph-6007s-projects`.

| Variable | Value/source |
| --- | --- |
| `NOTIFY_DATABASE_URL` | Supabase **Transaction pooler** connection string, port `6543`; insert the database password Kelly saved at project creation |
| `CRON_SECRET` | A new random hex secret, e.g. `openssl rand -hex 32` |
| `NOTIFY_REQUIRE_ENTITLEMENT` | `false` for the initial ungated launch; change to `true` after RevenueCat is connected and its entitlement table is populated |
| `REVENUECAT_WEBHOOK_SECRET` | Add later with RevenueCat; use the identical value in its Authorization header |
| `REVENUECAT_ENTITLEMENT_ID` | `smokeshow_pro` |
| `APNS_KEY_ID` | Apple APNs authentication key ID |
| `APNS_TEAM_ID` | Apple Developer Team ID |
| `APNS_KEY_P8` | Full contents of the APNs `.p8` private key |
| `APNS_TOPIC_IOS` | `earth.smokeshow.app` |

The following have safe production defaults and do not need to be set:
`NOTIFY_DATABASE_SCHEMA=smokeshow_notify`,
`NOTIFY_FORECAST_BASE=https://smokeshow.earth`, and
`APNS_HOST=api.push.apple.com`.

Apply environment variables to **Production**, then redeploy. Vercel does not
retroactively add new variables to an existing deployment. The hourly cron
requires a Vercel plan that permits more than one run per day.

## 2. Configure RevenueCat later

Create a webhook with:

- URL: `https://smokeshow.earth/v1/webhooks/revenuecat`
- Authorization header: the raw `REVENUECAT_WEBHOOK_SECRET` value (do not add
  `Bearer` unless that word is part of the Vercel value too)
- Environment: production and sandbox events while testing
- Entitlement: the app and server both expect `smokeshow_pro`

RevenueCat can send all event types; the service ignores irrelevant ones and
handles purchase, renewal, cancellation, billing issue, expiration, refund,
alias, and transfer events.

Keep `NOTIFY_REQUIRE_ENTITLEMENT=false` until webhook tests have populated and
verified subscriber entitlements. Turning it on earlier would correctly—but
silently—exclude every device that does not yet have an entitlement row.

## 3. Confirm Apple capabilities

In Apple Developer/App Store Connect, confirm bundle ID
`earth.smokeshow.app` has Push Notifications and Time Sensitive Notifications
enabled. Use an APNs token-auth key (`.p8`) belonging to the same Developer
Team as the app.

Use a TestFlight/App Store build for the production APNs test. A Debug build
installed directly by Xcode receives sandbox tokens and would require
`APNS_HOST=api.sandbox.push.apple.com` instead.

## 4. Deploy and verify

After deployment:

```sh
curl -sS https://smokeshow.earth/healthz
```

Expected:

```json
{"ok":true,"store":"postgres"}
```

Then:

1. Send a test webhook from RevenueCat and confirm HTTP 200 in both RevenueCat
   and Vercel logs.
2. Install the production/TestFlight app on a physical iPhone, buy or restore
   the test subscription, save a place, and enable notifications.
3. In Supabase SQL Editor, confirm registration without exposing its token:

   ```sql
   select platform, enabled, created_at
   from smokeshow_notify.devices
   order by created_at desc;
   ```

4. Trigger `/api/notify-evaluate` from Vercel's Cron page. The first successful
   run seeds the forecast state and intentionally sends nothing; subscribing
   is not treated as a smoke event. Subsequent real threshold transitions send
   the push.
5. Confirm the notification appears while the app is foregrounded and that
   tapping it opens the matching saved place.

## Operational notes

- Device tokens, preferences, entitlement state, prior cell state, and the
  dedupe ledger are durable in Supabase. No email or user account is stored.
- A missing `NOTIFY_DATABASE_URL` falls back to memory for local tests. The
  production health response must say `postgres`; do not ship `memory`.
- The evaluator is idempotent. Duplicate hourly runs are safe.
- Quiet hours drop non-urgent notifications rather than deferring them.
- No digest, streak, or engagement notifications are implemented by design.
