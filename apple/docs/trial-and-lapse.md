# The trial, day 0 and day 12–14

$2.99/month, subscribe-to-use, no permanent free tier, with a **14-day free
trial configured as a StoreKit introductory offer** so the store enforces
eligibility — one trial per Apple ID per subscription group. The app never
decides who is eligible; it asks the store and shows what it is told.

Configured in `Configuration/Smokeshow.storekit` for local testing and mirrored
in App Store Connect:

| | |
| --- | --- |
| Product | `earth.smokeshow.subscription.monthly` |
| Group | `smokeshow` |
| Price | $2.99 / month, auto-renewing |
| Introductory offer | free, `P2W` (14 days) |
| RevenueCat entitlement | `smokeshow_pro` |

## What App Review must see on the paywall

All three disclosures are in `Copy.Paywall.terms`, rendered under the buy
button: **trial length, the price after the trial, and that it renews
automatically** until cancelled, charged to the Apple Account. When the store
reports that this Apple ID is no longer eligible, `termsWithoutTrial` ships
instead — promising a trial that will not be granted is a rejection.

The paywall also states what the subscription is *not*: no account, no email,
tied to the Apple ID.

## Day 0 — the trial's job is a widget on the home screen

> "A trial that never becomes a glance never converts — the product's value is
> ambient, and it can't be felt from inside the app." (platform plan §4)

So `WidgetOnboardingView` is shown on the **first session**, not from a settings
row. It shows live widget mocks driven by the user's own forecast (the same
trick the web CTA uses), the platform-correct install steps, and then it checks
`WidgetCenter.currentConfigurations()` afterwards — because whether a widget
actually appeared is the only honest measure of whether onboarding worked.

Notification permission is deliberately **not** requested here. The first
session's job is the widget; a permission dialog with no context spends the
user's goodwill on the second-best feature.

## Day 12–14 — the churn cliff

The last two days of the trial (`TrialPolicy.churnWindowDays`) are where the
subscription is won or lost, and the surface it happens on is the widget.

**Inside the churn window the widget's subtitle changes.** Where it normally
prints `verdict.headline`, it prints "Trial ends in 2 days" / "Trial ends
tomorrow — keep this widget". The forecast is still rendered in full: the tile
is a prompt, not a lock. That swap is the single most valuable line of text in
the funnel, and `EntitlementLapseTests` pins it.

`TrialInstrumentation.evaluate` decides what the *app* does:

| state | widget installed | outcome |
| --- | --- | --- |
| trial, day 0–11 | no | ask once, ever (`installWidget`) |
| trial, day 0–11 | yes | nothing |
| trial, day 12–14 | no | one last install ask, then the paywall |
| trial, day 12–14 | yes | the paywall |
| lapsed / never | — | the paywall |
| subscribed | — | nothing |

Instrumentation is **local only** — counters in the App Group, no network, no
analytics SDK, no identifiers. The product's rule is no accounts and no email
capture, and a funnel is not worth breaking that for. If these numbers ever need
to leave the device they go through B7 keyed by the anonymous device ID and
aggregated, which is a decision to take explicitly rather than by adding an SDK.

## What the widget shows when the trial lapses

Decided, not left to fall out of the implementation:

- **The place name stays. The sky stays. The forecast goes.**
- Title: "Trial ended". Body: "Tap to keep your air on screen".
- Tapping deep-links straight to the paywall (`smokeshow://subscribe`), not to
  the app's home screen.
- The timeline collapses to one entry refreshing every 6 hours, and the provider
  does **not** fetch — we are not going to render the forecast anyway, and the
  network call would be pure cost.

Three things it deliberately is not:

1. **Not blank.** A blank tile reads as a broken app, and the user blames the
   product rather than the lapse.
2. **Not the last known number.** That would be a stale reading presented as
   current, which contract §9.3 forbids and which is a lie besides.
3. **Not zero.** Same reason as everywhere else in this codebase.

`.unknown` entitlement — the receipt check has not come back yet — **renders the
forecast**. A subscriber watching their home screen go blank because a store
call was slow is a worse failure than a lapsed user getting one more free
glance.

## Live Activity and lapse

A lapsed subscriber's Live Activity is ended immediately
(`LiveActivityController.end(reason: .entitlement)`). An active smoke event
counting down on a lock screen that the user is no longer paying for is exactly
the leak the entitlement gate exists to close — and B7 gates delivery
server-side for the same reason.
