# Free, with a tip jar

As of October 2026 the apps are **free**: the forecast, every widget family,
lock-screen accessories, alerts, Live Activities, the watch. There is no trial,
no paywall, and no state in which a widget withholds the forecast.

This replaces the paid model (subscribe-to-use at $2.99/month with a 14-day
trial). The reason, in one line: smoke is seasonal. People care for a few weeks
a year, so a 14-day trial covers the whole event and churns before it charges.
Free costs almost nothing to serve, because alerts are evaluated per grid cell,
not per user (platform plan §5).

## What a supporter gets

Supporter state gates **nothing but the app icon**. If a code path reads
`SupporterStatus.isSupporter` to decide whether a forecast renders, that is a
bug.

| | |
| --- | --- |
| Tips | Consumables `earth.smokeshow.tip.small` / `.medium` / `.large` ($2.99 / $5.99 / $11.99) |
| Monthly | `earth.smokeshow.subscription.monthly`, $2.99/month, **no introductory offer**. The paid builds' product, renamed "Smokeshow Supporter" in App Store Connect |
| Reward | Four alternate app icons (`SupporterIcon`), drawn by `scripts/gen_alt_icons.py` from the shipped icon's own generator and the app's sky palette |
| Billing | RevenueCat, kept because it already knows the paid builds' subscribers by their anonymous device ID |

Tips are consumables, which StoreKit cannot restore. RevenueCat keeps the
record against `DeviceIdentity`, which lives in the Keychain and survives a
reinstall, so a tip still unlocks the icons after one.

The Support screen is reached only on purpose: Settings, or
`smokeshow://support`. Old `smokeshow://subscribe` links, which lapsed-trial
widgets from the paid builds carry until their timeline reloads, land there too.

## People who were paying

We cannot cancel their subscriptions for them. So:

- Their subscription keeps renewing, and now counts as support (icons
  unlocked).
- On first launch of the free build they see `FreeNoticeView` once: Smokeshow
  is free now, your subscription is still active, keep it or cancel it, with a
  "Manage subscription" link straight to the App Store's subscription page.
- Anyone who subscribes from the Support screen after this build is not shown
  the notice; they already know.

## Day 0 still asks for a widget

The product's value is ambient, so the first session still asks once for a
widget (`WidgetNudge`), 20 seconds in, never twice, never if one is already
installed. The counters keep their old `trial.` key prefix so nobody already
asked in a paid build is asked again. Local only: no network, no analytics SDK.

## Server

`services/notify` delivers to every registered device: `NOTIFY_REQUIRE_ENTITLEMENT`
now defaults to `false`. The gate and the RevenueCat webhook are kept, switched
off, as the cost control if the model ever changes.

## App Store Connect, by hand

None of this is in the repo; it has to be done in App Store Connect before the
free build is submitted:

1. Create the three consumable tip products with the IDs above.
2. Rename the subscription's display name to "Smokeshow Supporter" and update
   its description to say it unlocks icons and nothing else.
3. Remove the 14-day introductory offer.
4. In RevenueCat, add the tips to the products list (no entitlement needed).
5. Update the listing: no trial or price lines in the description or
   screenshots, and add the tips to the in-app purchases shown.

## Shipping it

`.github/workflows/testflight.yml` archives and uploads the iOS app from a
GitHub macOS runner, signed with Xcode's cloud-managed signing. One-time setup:

1. App Store Connect → Users and Access → Integrations → App Store Connect API:
   generate a key with the **Admin** role (cloud-managed distribution
   certificates are only issued to Admin keys). Download the `.p8` once.
2. Add four repository secrets: `APPLE_TEAM_ID`, `ASC_KEY_ID`,
   `ASC_ISSUER_ID`, and `ASC_KEY_P8` (the full text of the `.p8`).

Then run the workflow (Actions → testflight → Run workflow) with version `1.1`.
The build shows up in TestFlight once Apple finishes processing it. Submitting
it for review stays in App Store Connect: attach the build to version 1.1, add
the tip products and the renamed subscription to the submission, update the
listing copy, and submit.

Merge this branch's web change (the CTA says "Free") only once 1.1 is live.
