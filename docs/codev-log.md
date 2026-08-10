# Co-dev log

Two people and their agents work on this repo. This file is how we stay out of
each other's way. It is a log of decisions, not a spec — if it grows past a
page or two, the oldest entries get deleted, not archived.

**Joe is lead.** His product, his name, his call on anything that reaches a
user. Kelly's changes come in as PRs for Joe to accept or reject.

## The rules we work by

1. **One branch per change, named for the change.** Not `fixes`, not `wip`.
   A branch is the unit Joe can reject, so it has to be one idea.
2. **PR everything. Never push to `main`.** Even a one-line fix.
3. **Say what you verified.** "Builds" is not verification. "Declined the
   location prompt, searched Bend, verdict rendered" is.
4. **Log the decision here, not just in the commit.** A commit explains a
   diff; this file explains why the diff exists six weeks later.
5. **Git authors lie.** Every commit either of us makes through Claude Code is
   authored "Claude". To find out who did something, read the GitHub push
   history, not `git log --author`.

## Decisions

### 2026-08-09 — the moon moved to the payload

The moon was the last thing the client computed for itself. `SkyScene` ran a
Schlyter lunar solution on the phone off `date`/`lat`/`lon`; the sun had already
moved to the edge (`src/lib/sky.js` → `Sky.sun`), and the moon was flagged to
follow (contract §4). It now does: `lunarPosition()` and `moonPhaseFraction()`
are ported into `src/lib/sky.js`, `skyFor()` emits a `moon` block next to `sun`
(altitude, azimuth, visible, xFrac, yFrac, phaseFraction), and `skyPayload()`
carries it per hour. `Forecast.Sky.Moon` decodes it; `HorizonBand` lost its
`date`/`latitude`/`longitude` inputs and reads `sky.moon`, so the on-device
ephemeris is deleted. One source of truth, so a phone and a browser paint the
identical moon — which is the point, with web parity next.

Ported math is pinned in `sky.test.js` against known full/new moons (phase
~0.5 / ~0), a half-synodic advance over 14.77 days, and the yFrac-from-altitude
invariant the sun already uses. The `MoonShape` sliver stays in Swift — it draws
the phase, it does not compute it.

- Rollback: revert; nothing else reads `Sky.moon` yet.

### 2026-08-08 — the iOS app had never been run

Joe built the SwiftUI app on 8/2–8/3. CI was green the whole time and the app
had still never launched on a device or a simulator, because CI builds
`generic/platform=iOS Simulator`, which skips the packaging Validate phase.
The framework had no Info.plist and the app could not be installed at all.

**Green CI on this repo does not mean installable.** Someone runs it before a
build is called done.

- Fixed in #20 along with two first-run bugs: the location prompt was never
  waited on, and there was no way to pick a place other than "where I am".
- Rollback: revert #20. The place picker is a new file, so it drops cleanly.

### 2026-08-08 — the demo's scrubber came back

The demo rig's core mechanic is dragging the timeline. It did not survive into
the app — there was no gesture code anywhere in the iOS target. Kelly's read:
what shipped is a read-only page, not an iOS app.

- #21 adds drag-to-scrub on the curve. Costs the ability to start a vertical
  scroll on the curve itself, which is the trade a slider makes.
- Still missing from the demo, in the order we plan to take them: tappable day
  strip with hourly detail, the map with its own scrubber, the share card.
- Rollback: revert #21. `CurveView`'s selection binding is optional, so every
  other caller is untouched.

### 2026-08-08 — the disclaimer became onboarding

The full disclaimer sat under the verdict on every launch. A wall of legal
text a reader scrolls past daily is furniture, not consent.

Now three screens on first run: what it does, what it isn't, then the location
ask. The disclaimer text itself is unchanged — `Copy.disclaimer` is verbatim
from the brief and `ParityTests` fails the build if it drifts. Only the
frequency changed. The verdict screen keeps one quiet line into the explainer,
where the full text also lives.

Order matters and is the point: a location prompt that arrives before the
reader knows what the app does is a prompt they decline.

- Rollback: revert the onboarding PR. The acknowledgement flag lives under its
  own defaults key, so nothing else reads it.

### 2026-08-08 — the widget ask waits its turn

The widget sheet opened the moment onboarding finished, so a new user met
three screens and then a fourth thing to dismiss, before ever seeing a
forecast. Nobody wants a widget of an answer they have not seen yet.

Now it waits 20 seconds into the first session, and Settings carries "Add a
widget" at the top for anyone who said no. The nudge policy in
`TrialInstrumentation` did not change — only when the app acts on it.

- Rollback: revert the PR. The delay is one `Task.sleep` in `RootView`.

### 2026-08-08 — the main screen back toward the demo (PROPOSAL, Joe's call)

Kelly's read of the shipped screen: "it feels like a web wrapper." Not
literally — it is native SwiftUI throughout, no WebView in any of the 49 files
— but it read as a scrolling document. Body copy stacked down the page, a data
table of instrument readings, nothing to touch.

The demo rig is a window: sky and land, verdict low on the horizon, clear-time
in the accent, and below it only the curve and the five days. Fixed height,
`overflow:hidden`, nothing scrolls.

This branch moves the app toward that: the scroll is gone, the ridge is drawn,
the verdict sits between sky and land, the clear-time headline takes the
accent, "What this means" becomes a text link rather than a pill, and the
instrument rows move into the explainer — which is where the demo had them all
along, and where they already existed in `ExplainSheet`.

**This is a proposal, not a decision.** Joe owns the design. Reject the PR and
nothing else changes; every edit is in `VerdictScreen.swift`.

Known and unresolved: `RidgeView` paints dark haze, which is invisible against
a night sky. It reads on a light one. The demo's land is warm and lighter than
its sky, so these are not the same object, and which one is right is Joe's.

### 2026-08-08 — the map, ported to MapKit

The web map is ~2,200 lines and none of it was in the app; the Apple build
never scoped one. Two things the publisher already does made the port small:
the frames are PNG-8 whose palette **is** the smoke ramp, and their rows are
spaced in Web-Mercator y — which is what `MKMapRect` draws in. So the whole
render is "put this PNG on that rect", not a canvas rasteriser.

Brought over: the manifest v2 client and its degrade rule (unknown version →
paint nothing), sharpest-domain-containing-the-centre selection, the −12/+48
scrubber, and naming the model on screen. Not brought over: NIFC fire cards
and FIRMS hotspots, the screen-space ash stipple, saved-place chips.

**The basemap is forced light and that is not a style choice.** The published
ramp darkens as smoke thickens because CLAUDE.md's rule is that the ramp runs
opposite the tiles. The app's root sets `.preferredColorScheme(.dark)`, which
would hand MapKit a dark basemap and make the heaviest air the least visible
thing on screen — the exact flip the web made twice.

A dark map is therefore not a UI toggle. It needs a second set of frames
published with the ramp inverted, which is a change in `scripts/render/ramp.py`
and the Actions job, not in the app.

### 2026-08-08 — merged to main

Everything above is on `main` (7c24e24 and the follow-ups). CI is green across
web tests, kit tests, generated artifacts, browser checks, and the iOS/macOS/
watchOS builds.

Two things CI caught that a simulator never would: the map is UIKit, so macOS
and watchOS stopped compiling until it was gated to iOS; and
`forecastEndpoint.test.js` pinned its series to a calendar date whose sustained
clear expired on 2026-08-08, so two assertions started failing on their own.
Both fixed.

### 2026-08-08 — the map went dark, on MapLibre

The map moved off MapKit and onto MapLibre, on `feat/maplibre-dark-map`. This
is what unblocks the dark basemap: MapKit would not hand its own tiles a dark
style that agreed with the frames, so the darkening ramp had no legible
backdrop. MapLibre draws a basemap we control — CARTO's dark-matter **vector**
style — and draws it on iOS and Android both, so this is also the engine
Android will share. (It started as CARTO raster with a separate labels layer;
raster labels stayed soft on a 3x screen, so it moved to the vector style,
whose glyph labels are crisp at any density. The smoke is inserted below the
style's first symbol layer, so the city names still ride above heavy smoke.)

The frames did not change. They are PNG-8 in Web Mercator, which is MapLibre's
projection too, so an `MLNImageSource` with the domain's corners as its quad
lands with no resampling — the same free ride MapKit's `MKMapRect` gave. The
theme is now fixed at dark and reads the published `hrrr-dark` domain (grey
where the air is barely off, warming to amber as it thickens — smoke lit from
within, on black). `SmokeMapView`'s old `darkBasemapAvailable` gate is gone;
`MapCanvas`/`SmokeOverlay`'s MapKit renderer is replaced by `MapLibreCanvas`.

Wiring notes for whoever touches this next: MapLibre is added in `project.yml`
as a package on the app target with `destinationFilters: [iOS]`. That filter
matters — `platforms: [iOS]` on a package product is silently dropped by
XcodeGen for a multiplatform target, which leaves the module unresolved;
`destinationFilters` emits a real `platformFilters = (ios,)` so the macOS app
still links without MapLibre (which ships no macOS slice). Built and run in the
iPhone 17 Pro simulator and on device (Sunrise): dark map, amber plume over
Missoula, crisp labels on top, scrubber steps the frames. The pre-rendered
domain is a rectangle, so its edges feather to transparent over a thin margin —
otherwise HRRR's northern edge draws a hard line across Canada. macOS and the
kit tests still build.

Coverage is the honest gap. Only `hrrr-dark` is published, so the dark map has
smoke over CONUS and paints none outside it — where a light basemap would have
shown CAMS. That is correct for a dark basemap (a light ramp on dark tiles is
the one thing that must never ship), not a workaround. The real fix is a
`cams-dark` domain from the same `ramp.py` inversion that produced `hrrr-dark`;
until then, non-US is dark basemap with no smoke. Matters for Android/global.

### 2026-08-09 — web front end, first pass at iOS parity (PROPOSAL, review only)

Joe asked what the web should take from Kelly's iOS build. The candidate is at
`/asdfasdf/` — `noindex`, absent from the sitemap, not linked from anywhere,
and listed by hand in `vite.config.js` so removing it is two deletions.

What it proposes, all of it above the fold: the verdict is a window rather than
a scrolling document; the curve becomes a drag control sitting directly under
the words it moves; the level *word* leads and the AQI integer becomes a
supporting line; the card chrome comes off; the source tabs, the "why two
numbers" expander and the nose caveat move into the sheet; a day tap drives the
scrubber instead of opening an accordion; the ridge gets the foot of the screen;
and there is a way back to *now*.

Unchanged, deliberately: the map, and everything below it. The FAQ, explainer
and disclaimer stay on the web and stay in the initial payload — that is Joe's
call and it is not in question. A city footer is new, rendered from
`src/data/locations.js` so it cannot drift from the pages that exist.

It runs on production modules — sky, ink, rating, verdict, days, trend, aqi,
time — with the iOS test fixtures as the PM2.5 series, time-shifted to now. The
verdict, the days and the headline are recomputed rather than read off the
fixture, so what is on screen is what the real code would say about that air.

One real defect came out of rendering it: `text-transform: uppercase` on a line
carrying µg/m³ paints "MG/M³", which is a different unit by a factor of a
thousand. Nothing carrying a unit is uppercased on that page now. **Worth
checking the live site and the share card for the same pattern.**

Also found, and pointing the other way: the web's ridge tints with `--ink` and
so survives the sky going dark, which is exactly the thing left open against
`RidgeView` on iOS. That answer should travel from web to Swift.

- Rollback: delete `asdfasdf/` and `src/proto/`, drop `reviewPages` from
  `vite.config.js`. Nothing else imports either directory.

## Open, and whose call

- **Bundle prefix.** The app is `earth.smokeshow.*`; everything else of
  Kelly's is `com.watchcapstudio.*`. Permanent once it hits the App Store.
  Joe's call.
- **Widget previews truncate.** "In t…", "D…" in the onboarding preview. The
  large families were designed without ever being rendered.
- **A raw Swift error is on screen in Settings.** "Alerts aren't registered:
  The operation couldn't be completed. (SmokeshowKit.DeviceRegistryClient
  .RegistryError error 0.)" That is a developer string in a user's face; it
  wants a written sentence. The B7 registry being provisional is the cause.
- **The dark basemap.** DONE on `feat/maplibre-dark-map` — CARTO dark via
  MapLibre. See the 2026-08-08 MapLibre entry above.
- **Global dark coverage.** The dark map is CONUS-only: only `hrrr-dark` is
  published, so outside the US the map is a dark basemap with no smoke. Needs a
  `cams-dark` domain from `ramp.py`'s dark inversion. Matters most for Android.
- **Watch entitlement.** An unpaired-launch watch reads an empty snapshot.
  Known, documented in `apple/docs/watch-and-live-activity.md`.
