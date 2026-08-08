# Branch prompts

Copy-paste prompts for each work branch in `docs/smokeshow-platform-plan.md` §8.
Each is written to be self-contained for a fresh session.

## Before you start: branch from `main`, and check it's current

Every prompt below opens by asking the agent to read planning docs in `docs/`.
**Those docs must already be on `main`, or the agent will branch from a commit
where they don't exist and report them missing.** That happened to B0 and B5 —
they branched from `main` before the planning docs were merged. The work
survived because the prompt bodies carry the substance, but don't repeat it.

Before starting any wave, confirm `main` contains the previous wave's output:

| Starting | `main` must already contain |
| --- | --- |
| Wave 1 (B0, B5) | the planning docs in `docs/` |
| Wave 2 (B2, B3, B4) | **B0** — `src/lib/sky.js`, `src/lib/trend.js`, `design/tokens.json`, the split CSS, and the `App.jsx` slots |
| Wave 3 (B6) | **B2** |
| Wave 4 (B1) | the shipped re-skin |
| Wave 5 (B7, B8, B9) | **B1's contract commit** — `docs/forecast-api-contract.md` |
| Wave 5 (B11) | **B10** — `src/lib/basemap.js`, `scripts/smoke-ramp-audit.mjs`, the `--map-surface` token |

Quick check before dispatching a branch:

```sh
git fetch origin && git ls-tree --name-only origin/main docs/ src/lib/
```

**Order — the web re-skin ships first, then the platform work.**

| Wave | Branches | Concurrent? | Gate |
| --- | --- | --- | --- |
| **1** | B0, B5 | yes | — |
| **2** | B2, B3, B4 | yes | B0 merged |
| **3** | B6 | — | B2 merged |
| — | *web re-skin ships* | | |
| **4** | B1 | — | re-skin live |
| **5** | B7, B8, B9 | yes | B1's contract commit |
| **5** | B10 | yes (render layer — no overlap with B1/B7/B8/B9) | ~~B1 merged~~ — shipped early, see note |
| **5** | B11 | yes | B10 merged; must land before B8/B9 render a map |

**B10 ran ahead of its gate and that was fine.** It shipped before B1 because
its scope is the render layer only and B1's prompt forbids touching components
and CSS, so there was no overlap. The one shared file is `src/lib/rating.js`
(ramp constants) — merge B10 before dispatching B1 and even that disappears.

**B11 exists because the free tier now includes the map** (`platform-plan.md`
§1, reversed 2026-08-08). CARTO's hosted tiles are restricted to enterprise
customers and non-profit grants, and free installs make tile volume unbounded
regardless of licensing. B11 replaces them with a self-hosted artifact that all
three clients share.

Every prompt assumes the agent reads `CLAUDE.md`,
`docs/smokeshow-build-brief.md`, and `docs/smokeshow-share-spec.md` first.

---

<a id="b0"></a>
## B0 — Scaffolding + shared math · Sonnet 5 · `claude/b0-scaffold`

> Read `CLAUDE.md`, `docs/smokeshow-platform-plan.md`, and
> `docs/smokeshow-demo-implementation-plan.md`.
>
> This branch makes it safe for three other branches to work on the UI at the
> same time, and lands the shared maths they all need. **No visual change may
> ship from this branch.** The app must look and behave pixel-identically
> before and after.
>
> 1. Split `src/index.css` (1,040 lines) into co-located per-component files —
>    `src/components/RatingChip.css` etc. — plus `src/styles/tokens.css`
>    (custom properties only), `src/styles/shell.css` (`.app`, header, loading,
>    error), and `src/styles/seo.css` (FAQ, explainer, disclaimer). Import each
>    from the component that owns it. Nothing moves between files that isn't
>    already there.
> 2. In `src/App.jsx`, introduce clearly-commented named slots so later
>    branches insert into a slot instead of editing the same JSX region:
>    `{/* SLOT: sky */}`, `{/* SLOT: trend-chip */}`, `{/* SLOT: ridgeline */}`,
>    `{/* SLOT: explain-sheet */}`, `{/* SLOT: cta */}`.
> 3. Add Vitest + `npm test`. Write real tests for `src/lib/verdict.js`
>    (the 6-hour clear hold and 3-hour arrival hold are the product's core
>    promise and are currently untested) and `src/lib/rating.js` level
>    boundaries.
> 4. Extract the design tokens the demo uses into `design/tokens.json` —
>    colours, type scale, radii, motion durations — and generate
>    `src/styles/tokens.css` from it via a script in `scripts/`. The native apps
>    will consume this same JSON, so it is the parity source, not a convenience.
> 5. Land the shared maths the re-skin branches all depend on:
>    - **`src/lib/sky.js`** — port `skyB()`, `mix()`, `lerp()`, `clamp01()`,
>      `lum()` from `public/ifhghs/demo/index.html` (~line 571). Export
>      `skyFor(pm25, date, lat, lon)` returning zenith/mid/horizon colours, sun
>      position and dimming, star opacity, and an `isDark` flag.
>      **Replace the demo's fixed 6 AM–9 PM solar day** (`sin(π(t-6)/15)`) with
>      a real NOAA solar-position calculation — the demo's version is visibly
>      wrong at high latitude in summer.
>    - **`src/lib/trend.js`** — port `trendAt()` (demo ~line 766): 6-hour
>      lookahead, ±4 µg/m³ deadband, suppressed below 12. Guard it against
>      contradicting `computeVerdict()`'s trend, which answers a different
>      question (threshold crossings, not slope): the chip must never read
>      "Improving" while the headline reads "No clear air in the 5-day window".
>    - Tests for both: sky output at the five level anchors × four times of day,
>      and trend deadband edges.
>
> Verify with `npm run build` and by diffing screenshots before/after using the
> existing `scripts/verify-*.mjs` Puppeteer pattern. Commit and push to
> `claude/b0-scaffold`. Do not open a PR.

---

<a id="b1"></a>
## B1 — Forecast API and contract · **Opus 5** · `claude/b1-forecast-api`
*Wave 4 — starts after the web re-skin is live.*

> Read `CLAUDE.md`, `docs/smokeshow-platform-plan.md` §2, and the existing
> `src/lib/{rating,verdict,days,aqi,agreement,sensors,openMeteo,grid}.js` and
> `api/{aq,sensors}.js`.
>
> Goal: one server-computed verdict that the web, iOS, macOS, and Android
> clients all render identically. Today this logic runs in the browser; if Swift
> and Kotlin reimplement it, "when does it clear" will drift between a user's
> phone and their laptop, and that is the product's only promise.
>
> **Your first commit must be the contract document alone** —
> `docs/forecast-api-contract.md` plus a JSON Schema in `design/`. Three other
> branches (B7, B8, B9) are blocked until it lands and will build against a mock
> of it, so land it before you write the implementation.
>
> The contract covers `GET /api/forecast?lat&lon`, returning: hourly PM2.5 with
> UTC timestamps and the local UTC offset; `nowIndex`; the full
> `computeVerdict()` result (level, clear index, arrival index, peak, trend);
> day summaries with day-parts; sky parameters per hour; and the measured rows
> (official / local / model, never averaged). Version it (`"v": 1`) and make
> every field's null-behaviour explicit — clients must degrade, not crash.
>
> Then implement:
> - `api/forecast.js` as a Vercel edge function reusing `src/lib/*` directly.
>   Node and browser must run the same code — no forking the logic.
> - Route through the existing `/api/aq` cache proxy and keep the coordinate
>   snapping in `src/lib/grid.js`; a viral smoke event must not blow the
>   Open-Meteo free tier.
> - **Size this for a free tier, not a subscriber base** (changed 2026-08-08).
>   The apps are now free, so this endpoint serves every install plus the web —
>   not a bounded set of paying users. Caching and coordinate snapping are
>   load-bearing here, not prudent: state the cache key, the TTL, and the
>   expected upstream-fetch rate per populated cell, and include a cost estimate
>   at 10k / 100k / 1M daily actives. If the design only works at subscriber
>   volume, it does not work.
> - Serve the sky parameters from `src/lib/sky.js` and the trend from
>   `src/lib/trend.js` (both landed by branch B0) so the native clients get them
>   without reimplementing the maths.
> - Switch the web app to the endpoint **with the current client-side path kept
>   as a fallback**, so a bad deploy degrades instead of breaking. The re-skin
>   is already live at this point — do not regress it.
>
> Tests for contract-shape conformance and for web-vs-endpoint agreement: the
> same coordinates must produce the same verdict through both paths. Do not
> touch any component or CSS file. Commit and push to
> `claude/b1-forecast-api`. Do not open a PR.

---

<a id="b2"></a>
## B2 — Sky and ink system · **Opus 5** · `claude/b2-sky-shell`

> Branch from `claude/b0-scaffold`. Read `CLAUDE.md`,
> `docs/smokeshow-demo-implementation-plan.md`, and the demo at
> `public/ifhghs/demo/index.html`.
>
> This is a **re-skin**. Every feature on the live site keeps working. The demo
> is the visual language; production is the feature set.
>
> Replace the flat dark shell with the demo's live sky: a full-bleed gradient
> driven by `(pm25, hourOfDay)`, with sun position and dimming, stars, film
> grain, and the luminance-triggered ink inversion.
>
> - New `src/components/SkyBackdrop.jsx`, mounted at `{/* SLOT: sky */}`. It
>   must **write CSS custom properties on `:root`** (`--sky-zen`, `--sky-mid`,
>   `--sky-hor`, `--ink`) rather than re-render children — scrubbing has to be a
>   style write, not a React tree update, or the map will stutter.
> - Use `src/lib/sky.js`, landed by branch B0. Do not re-port the sky maths.
> - Port the `.dark-air` inversion: horizon luminance < 0.42 → cream `#F4E9D6`,
>   else ink `#26221B`.
> - **Contrast audit — budget half this branch for it.** The demo's single
>   luminance threshold lands near 4.5:1 right at the crossover. Check every
>   text colour against the actual gradient at the boundary across all five
>   levels and the full 24-hour cycle. Add a scrim behind the type block if
>   that's what it takes. Report the measured ratios; do not assume.
> - **Delete `src/components/LakeScene.jsx` and its CSS** — the lake
>   illustration is dropped in-app by decision. Leave
>   `assets/gen_smokeshow_art.py` and the SVGs in the repo as an archive, and
>   leave the share-card and OG image paths alone; another branch owns those.
> - Re-skin the surfaces the demo has **no design for**, in its language:
>   loading and error states (`App.jsx`), `PullToRefresh`, `InstallNudge`,
>   `SharedBanner`, `LocationSearch` / the location chooser, and the static SEO
>   block in `index.html`. Design these; don't leave them on the old dark shell.
>
> Own `src/styles/*` and `src/App.jsx` structure. Do not edit `Scrubber`,
> `AgreementBand`, `FiveDayStrip`, `RatingChip`, or `SmokeMap` — other branches
> own those. Commit and push to `claude/b2-sky-shell`. Do not open a PR.

---

<a id="b3"></a>
## B3 — Ridgeline, curve scrubber, timeline · Sonnet 5 · `claude/b3-timeline`

> Branch from `claude/b0-scaffold`. Read `CLAUDE.md`,
> `docs/smokeshow-demo-implementation-plan.md`, and the demo at
> `public/ifhghs/demo/index.html`.
>
> Re-skin the timeline surfaces in the demo's visual language. **Every existing
> feature stays** — in particular play/pause, which the demo dropped.
>
> - New `src/components/Ridgeline.jsx`: port `RIDGE_FAR` / `RIDGE_NEAR` and
>   `setRidge()` (demo ~line 822). Far ridge's haze gone by ~32 µg/m³, near one
>   swallowed gradually to 130. It reads as "how far can you see", the anchor
>   `src/lib/rating.js` already writes its copy around. Render once; scrub
>   mutates two `stop-opacity` attributes. **Do not port
>   `placePhoneRidge()`** — it calls `getBoundingClientRect()` every frame;
>   use a CSS anchor instead. Mount at `{/* SLOT: ridgeline */}`.
> - Re-skin `src/components/Scrubber.jsx`: keep the props, keep the range input
>   (accessible and keyboard-driven), **keep play/pause**. Add the 60-hour
>   PM2.5 area chart behind it — port `buildCurve()` (demo ~line 996) with the
>   dashed 35 µg/m³ threshold and the now-rule, both of which do real
>   explanatory work. Build the SVG once per data change and move only the
>   thumb on scrub. **Do not port the demo's `innerHTML` rebuild** (demo ~line
>   907) — mutate `d` attributes.
> - Re-skin `src/components/AgreementBand.jsx`. The demo has **no design** for
>   it; design one that reads against a live sky — likely a low-opacity ribbon
>   in `--ink` rather than the current opaque panel. It must stay legible in
>   both ink and cream states.
> - `src/components/FiveDayStrip.jsx`: add the demo's `glideTo()` easing on day
>   tap (650 ms cubic ease-out, straight jump under `prefers-reduced-motion`).
>   Keep the measured past-day boxes and their "measured" / "model estimate"
>   labels. Day-part bars are already shipped and already match the demo — leave
>   them.
>
> Read `--ink` and the sky tokens from CSS custom properties; branch B2 owns
> them. Do not edit `App.jsx` beyond your slot, `src/styles/*`, `RatingChip`, or
> the explain sheet. Commit and push to `claude/b3-timeline`. Do not open a PR.

---

<a id="b4"></a>
## B4 — Verdict, explain sheet, prefs · Sonnet 5 · `claude/b4-verdict-sheet`

> Branch from `claude/b0-scaffold`. Read `CLAUDE.md`,
> `docs/smokeshow-demo-implementation-plan.md`, and the demo at
> `public/ifhghs/demo/index.html`.
>
> Re-skin the verdict block and build the explain sheet.
>
> - New `src/components/TrendChip.jsx` at `{/* SLOT: trend-chip */}` — reads
>   `src/lib/trend.js`, landed by branch B0. Hidden entirely when the air is
>   clear and steady.
> - New `src/components/ExplainSheet.jsx` at `{/* SLOT: explain-sheet */}`,
>   porting the demo's sheet (~line 1071): eyebrow
>   (`Level N of 5 · X µg/m³ · model estimate`), the five-level ladder with the
>   current level enlarged, the "what this is *not*" line, EPA guidance with the
>   sensitive-household variant, the "the plan: cleanest air is Wednesday" line,
>   and the measured-vs-model rows.
>   - Build the ladder from `LEVELS` in `src/lib/rating.js`. **Do not
>     re-declare the table** — the demo has its own copy and it has already
>     diverged.
>   - Measured rows read from `sensorNow`, already in state at `App.jsx:125`.
>     Do not re-fetch `/api/sensors` the way the demo does.
>   - Add what the demo lacks: focus trap, `Escape` to close, `aria-modal`,
>     restore focus on close.
>   - Triggers: verdict word, clear-line, sense line, number, and the
>     "What this means" button.
> - `src/lib/rating.js`: add `NOT_LINES`, `EPA_LINES`, `EPA_SENS`, and `RANGES`
>   beside `LEVELS`. **Keep production's existing level names and notice copy** —
>   the demo's is punchier but breaks the documented rule at `rating.js:1-7`
>   ("describe what MOST people notice, never what the reader WILL feel").
>   Flag `NOT_LINES` in your summary for human review against the
>   "no invented health dose-response claims" rule — two of them make
>   cigarette-equivalence *reassurances*, which is still a dose claim.
> - New `src/lib/prefs.js` — extend `src/lib/storage.js`, don't add a second
>   helper. Store `units` (`ug` | `aqi`) and `sensitive`. Wire `units` through
>   `RatingChip` and the sheet eyebrow; `src/lib/aqi.js` already converts.
> - Re-skin `src/components/RatingChip.jsx` and keep its official/local source
>   toggle working.
> - Re-skin `src/components/ShareButton.jsx`. The demo has **no design** for
>   button chrome — design one in its language. The share stack ships in v1 per
>   `docs/smokeshow-share-spec.md`; do not weaken it.
> - **No notification settings.** The web has none. If you build the settings
>   sheet, it holds units and sensitive-household only, and the
>   "Watching this air…" row from the demo does not ship — it promises push the
>   site can't deliver.
>
> Do not edit `src/styles/*`, `Scrubber`, `AgreementBand`, or `SkyBackdrop`.
> Commit and push to `claude/b4-verdict-sheet`. Do not open a PR.

---

<a id="b5"></a>
## B5 — Puppet harness v2 · Sonnet 5 · `claude/b5-puppet`

> Read `docs/smokeshow-platform-plan.md` §6 in full, then
> `public/ifhghs/demo/index.html`.
>
> **You touch only `public/ifhghs/demo/index.html`.** No production code. This
> branch is independent of everything else — start immediately.
>
> Upgrade the puppet from a demo toy into the cross-platform design QA tool.
> Four surfaces (web, iOS, macOS, Android) have to look like one product, and
> this is the instrument that proves it.
>
> **The structural fix, first.** The puppet forces a *scalar* PM2.5, so every
> function needing a time axis fakes one separately — and they've drifted:
> - `pmAt()` returns a constant, so `trendAt()` always says "Holding steady"
>   while `curveVals()` draws a rising, peaking curve for levels 2+.
> - Three hardcoded string tables must be hand-synced: `PUPPET_CLEARS`
>   (~line 544), the array in `widgetSub()` (~line 779), and the branch in
>   `nextChangeInfo()` (~line 796). At level 1 the phone reads "Thins out by
>   evening" while the countdown accessory reads "9h TO SMOKE" — opposite
>   futures, same state.
> - The scrubber is disabled in puppet mode (`opacity:.35`, ~line 110) because
>   there's no series to scrub.
>
> **Make the puppet synthesize a full 61-hour series instead of a scalar.** Then
> `pmAt`, `trendAt`, `verdictLine`, `widgetSub`, and `nextChangeInfo` all run
> their real implementations unmodified, all three string tables delete
> themselves, and the scrubber comes back on. Verify each of those consequences
> actually happened — deleting the tables is the test that you did it right.
>
> Control it with the existing PM slider as *amplitude* plus a new **shape**
> selector: `Flat · Rising · Peaking · Clearing · Stuck all week`.
>
> Then add, in priority order:
> 1. **Sensors control** — `none / official / local / both` plus a divergence
>    slider. The measured-vs-model block is currently unreachable for QA, and
>    large divergence is the exact case its explanatory copy exists to justify.
> 2. **Platform frames** — `Web · iOS · Android · macOS`. Today it only shows an
>    iPhone. Note Android's Jetpack Glance has no fixed widget families —
>    widgets are responsive by `dp` and user-resizable — so the Android frame
>    needs a resize handle, not fixed sizes.
> 3. **Place-name field** — long ("Colorado Springs") vs short ("Bend") is a
>    live layout risk at 148px widget width with no way to test it.
> 4. **Pin the ink crossover** — a button that jumps to the hour where
>    luminance hits 0.42 for the current PM, so the contrast audit is
>    repeatable instead of a drag-and-hope.
> 5. **Units and sensitive-household toggles** surfaced in the rig.
> 6. **Share card and OG card previews** — the two surfaces most likely to
>    drift, with no preview today.
> 7. **Reduced-motion toggle.**
>
> Keep the page `noindex,nofollow` and dependency-free. Commit and push to
> `claude/b5-puppet`. Do not open a PR.

---

<a id="b6"></a>
## B6 — Web CTA and widget showcase · Sonnet 5 · `claude/b6-marketing`

> Branch from `claude/b2-sky-shell` once it has merged. Read `CLAUDE.md`,
> `docs/smokeshow-platform-plan.md` §1 and §3, and the demo's widget column at
> `public/ifhghs/demo/index.html` (`renderWidgets()`, ~line 921).
>
> Build the free web app's call to action for the paid apps.
>
> The demo already renders **live widget mocks driven by real data** — small,
> medium, lock-screen inline, two circular accessories, and a rectangular
> accessory. Reuse that renderer nearly verbatim as a "your air, on your home
> screen" section: widgets that update as the visitor scrubs their own
> timeline. Demonstrating the paid feature with the visitor's own air is a far
> stronger pitch than a screenshot.
>
> - Mount at `{/* SLOT: cta */}`. Place it below the verdict and above the FAQ
>   so it never competes with the answer the visitor came for, and never delays
>   first paint — the hard rule is verdict in under 3 seconds on cellular.
> - Lead with glanceability, not alerts. The pitch is "see it without looking it
>   up"; notifications are the second bullet.
>   - ⚠️ **Superseded 2026-08-08.** Glanceability is now the *free* tier, so it
>     is no longer what the CTA sells — it is what the CTA gives away. Lead with
>     "free app, free widgets, free map," and make the paid line the one thing a
>     widget cannot do: reach you when you aren't looking. See
>     `platform-plan.md` §1.
> - App Store and Play Store badges, using each store's official badge assets
>   and sizing rules. **Build them behind a feature flag, default off** — the
>   apps don't exist yet and dead links are worse than no CTA.
> - **No email capture, no waitlist form.** `CLAUDE.md` forbids it and there is
>   no exception for this branch.
> - State the price plainly rather than hiding it behind a tap. ⚠️ **Changed
>   2026-08-08:** the price is no longer the headline, because the app is free.
>   The live copy shipped from this branch still reads "$2.99/month for iOS,
>   macOS, and Android" in `AppWidgetCTA.jsx` (lines 134 and 237) and in the
>   static SEO block in `index.html` (line 111). All three are now wrong and
>   need rewriting to "free · $2.99/month for alerts" or similar.
> - Must work in both ink and cream states and at every level; check it at
>   "All clear", where a smoke-forecast CTA has the least natural urgency.
>
> Add the section to the static SEO block in `index.html` if it can be server-
> delivered, so crawlers see it. Commit and push to `claude/b6-marketing`. Do
> not open a PR.

---

<a id="b7"></a>
## B7 — Notification backend · **Opus 5** · `claude/b7-notify-backend`

> Read `docs/smokeshow-platform-plan.md` §5 and §4, and
> `docs/forecast-api-contract.md` (from branch B1 — build against a mock of it
> if the implementation hasn't landed). Read `src/lib/{grid,verdict,rating}.js`.
>
> Build the service behind the paid apps' notifications. This is server state
> and it is *intentionally* outside `CLAUDE.md`'s static-first rule — that rule
> governs the web product, which has no notifications. Do not add server state
> to the web app.
>
> - **Device registry.** Anonymous device-scoped opaque IDs. No email, no
>   password, no accounts. A device registers: push token, platform, subscribed
>   locations, thresholds, quiet hours, sensitive-household flag.
> - **Dedupe by lattice.** Reuse `snapCoord()` from `src/lib/grid.js` to snap
>   subscriber locations onto the same lattice the forecast cache uses.
>   Evaluation is then `O(unique cells)`, not `O(users)` — ten thousand
>   subscribers in Denver is one evaluation. Get this right; it is the
>   difference between a cheap service and an unaffordable one.
> - **Evaluation loop.** Per hourly model run: fetch each occupied cell, run
>   `computeVerdict()`, diff against the last stored verdict, and fan out only
>   on a *state change* — threshold crossed, peak reached, cleared. Never on a
>   schedule.
> - **Quiet hours** (10 PM–7 AM local, urgent only) applied at fan-out, not at
>   send.
> - **Entitlement gate, server-side**, via the RevenueCat webhook. Lapsed
>   subscribers must stop costing you compute and delivery, and client-side
>   gating alone won't do that. Note (changed 2026-08-08): the apps are now free
>   and the subscription unlocks push *only*, so this gate governs a feature,
>   not the product — a lapsed device stops receiving notifications and keeps a
>   fully working app. Nothing else in this branch changes, but it does mean
>   **only subscribers ever register here**: a free user has no device record,
>   no token, and costs this service nothing. Design registration as an
>   upgrade-time action, not a first-launch one.
> - APNs and FCM fan-out with retry and token-invalidation handling.
>
> Ship the demo's stated posture verbatim: *"Threshold alerts only. No digests,
> no streaks, no engagement pings."* Do not add engagement mechanics.
>
> Include a load estimate at 1k / 10k / 100k subscribers, and an integration
> test that proves a single state change produces exactly one notification per
> device — duplicate smoke alerts at 3 AM will lose you the subscription.
> Commit and push to `claude/b7-notify-backend`. Do not open a PR.

---

<a id="b8"></a>
## B8 — Apple app: iOS + macOS · **Opus 5** · `claude/b8-apple`

> Read `docs/smokeshow-platform-plan.md` (all of it),
> `docs/forecast-api-contract.md` and `design/tokens.json` (from branches B1 and
> B0 — build against a mock if they haven't landed), `CLAUDE.md`, and the demo
> at `public/ifhghs/demo/index.html`, which is the design source.
>
> Build one SwiftUI codebase targeting iOS and macOS, in `apple/` in this repo.
>
> **Do not build a WebView wrapper.** It will likely be rejected under App Store
> Guideline 4.2, and a paid subscription on a thin wrapper invites more
> scrutiny, not less. Native SwiftUI throughout.
>
> - **Render, don't compute.** Consume `/api/forecast` for the derived verdict.
>   Do not reimplement `computeVerdict`, the rating scale, or clear-time logic
>   in Swift — the whole point of the endpoint is that a user's phone and laptop
>   can never disagree about when the smoke clears.
> - **The map is in the free tier** (added 2026-08-08). Do not choose a map SDK
>   here — that is branch B11's call, and it has already been made: MapLibre
>   Native, reading the same PMTiles artifact and style JSON the web reads, so
>   the three clients cannot draw different basemaps. **Do not use MapKit**; it
>   reads neither, and it would put Apple on a different basemap from Android
>   and the web. If B11 hasn't landed, stub the map view behind the same
>   interface and move on — it is not on the critical path for widgets.
> - **Widgets are the product.** WidgetKit, sharing SwiftUI views with the app.
>   The demo already designs against the right families:
>   `.w-small` → `systemSmall`, `.w-med` → `systemMedium`, `.lk-inline` →
>   `accessoryInline`, `.acc-circ` ×2 → `accessoryCircular`, `.acc-rect` →
>   `accessoryRectangular`. **You must additionally design `systemLarge` and
>   `systemExtraLarge`** (iPad and Mac desktop) — the demo has no design for
>   them. macOS gets the `system*` families only; it has no lock screen.
> - **Respect the WidgetKit reload budget** (~40–70 timeline reloads/day). Fetch
>   a full timeline in one call and build many entries from it. Do not poll.
> - **StoreKit 2 via RevenueCat.** ⚠️ **Changed 2026-08-08 — this section
>   previously specified $2.99/mo subscribe-to-use with a 14-day trial and no
>   permanent free tier. That is reversed.** The app is now **free and
>   permanent**; a $2.99/month subscription unlocks **push notifications only**.
>   The map, widgets, verdict and timeline are free forever. Reasoning is in
>   `platform-plan.md` §4: smoke is episodic, and a fixed trial window that
>   opens during clear air demonstrates nothing.
>   - **No trial to configure.** The free tier is the trial and it does not
>     expire. Disclose price and auto-renewal on the paywall as App Review
>     requires; there is no trial length to disclose.
>   - **Onboard straight into a widget.** Still the job, minus the deadline —
>     the free tier's value is ambient and cannot be felt from inside the app.
>     Prompt for widget installation on day 0.
>   - **No day-12 churn cliff to instrument.** Ask for the upgrade when the
>     verdict crosses a threshold for a watched location — "we could have told
>     you this at 4 AM" — not on a date. Never during clean air.
>   - **A lapsed subscription removes push and nothing else.** The widget and
>     the map keep working. Simpler to build than the old designed-lapse state,
>     and much easier to defend in review.
> - Push registration against branch B7's device registry. Anonymous device ID —
>   no accounts, no email.
> - Read colours, type scale, and motion from `design/tokens.json` so the apps
>   and the web cannot drift.
> - Every forecast label carries "model estimate"; past hours are never
>   "observed". The disclaimer copy ships verbatim from
>   `docs/smokeshow-build-brief.md`.
>
> **Worth scoping while you're here, in this order:** Apple Watch complications
> (nearly free once the `accessory*` views exist) and a Live Activity /
> Dynamic Island countdown during an active smoke event ("Clears in 4h") — the
> single most differentiated thing on the roadmap.
>
> Start with the widget families and the data layer, not the app shell — the
> widgets are what people are paying for and they carry the most unknowns.
> Commit and push to `claude/b8-apple`. Do not open a PR.

---

<a id="b9"></a>
## B9 — Android app · **Opus 5** · `claude/b9-android`

> Read `docs/smokeshow-platform-plan.md` (all of it),
> `docs/forecast-api-contract.md` and `design/tokens.json`, `CLAUDE.md`, and the
> demo at `public/ifhghs/demo/index.html`. If `apple/` exists, read it — match
> its structure and naming so the two apps stay reviewable side by side.
>
> Build a Kotlin + Jetpack Compose app in `android/` in this repo.
>
> - **Render, don't compute.** Consume `/api/forecast`. Do not reimplement the
>   verdict or rating logic in Kotlin.
> - **Widgets via Jetpack Glance.** Critical difference from iOS: **Glance has
>   no fixed widget families.** Widgets are responsive by `dp` and the user
>   resizes them freely. The demo's five fixed iOS layouts do **not** port
>   directly — you need a responsive spec with breakpoints that degrades
>   gracefully from a 2×1 tile to a 4×2. Design this explicitly and document the
>   breakpoints; it is the largest Android-specific design task and it is easy
>   to underestimate.
> - Cover the Android-specific surfaces the demo doesn't: Material You dynamic
>   colour (decide whether to adopt it or hold the brand palette — recommend
>   holding the palette, since the sky *is* the data), and predictive back.
> - **Google Play Billing via RevenueCat.** The app is **free and permanent**.
>   A $2.99/month subscription unlocks **push notifications only** — the map,
>   widgets, verdict and timeline are all free, forever, and an expired
>   subscription must leave every one of them working. No trial: the free tier
>   is the trial and it does not expire (see `platform-plan.md` §4). Same
>   structure as the Apple app; the two must not diverge on price or on what
>   sits behind the paywall.
> - **Ask for the upgrade at the smoke event, not on a schedule.** The prompt
>   belongs where the verdict crosses a threshold for a watched location — the
>   honest pitch is "we could have told you this at 4 AM." Never prompt during
>   clean air, and keep it rare.
> - FCM registration against branch B7's device registry. Anonymous device ID.
> - Read colours, type scale, and motion from `design/tokens.json`.
> - Every forecast label carries "model estimate"; past hours are never
>   "observed". Disclaimer copy verbatim from `docs/smokeshow-build-brief.md`.
>
> Start with the Glance responsive widget spec — it's the riskiest unknown and
> it constrains everything else. Commit and push to `claude/b9-android`. Do not
> open a PR.

---

<a id="b10"></a>
## B10 — Dark basemap + inverted smoke ramp · **Opus 5** · `claude/b10-dark-map`
*Queued behind B1. Touches the render layer only — no collision with B1's data layer.*

> Branch from `main`. Read `CLAUDE.md`, `docs/smokeshow-platform-plan.md`, and
> the demo's map at `public/ifhghs/demo/index.html` (~line 1490), which is the
> design reference.
>
> **The problem.** Production's map uses bright OpenStreetMap tiles
> (`SmokeMap.jsx:77`). The demo uses CARTO `dark_all`, and smoke reads as a pale
> glow against it — that look is the target. But the demo's ramp *darkens* with
> concentration (`rgb(150,146,138)` → `rgb(28,20,12)`), which on a dark basemap
> inverts the meaning. Measured, compositing the ramp over a `rgb(20,23,26)`
> basemap:
>
> | PM2.5 | 20 | 35 | 150 | 250 | 400 |
> | --- | --- | --- | --- | --- | --- |
> | demo ramp on dark | 1.29 | **1.51 ← peak** | 1.17 | 1.01 | 1.01 |
> | production ramp on dark | 2.13 | **2.34 ← peak** | 1.32 | 1.05 | 1.04 |
>
> Contrast peaks near 35 µg/m³ and then collapses. At Smokeshow-level air the
> smoke composites to `rgb(26,21,15)` against `rgb(20,23,26)` — **the worst air
> on the map becomes invisible.** Production's light basemap avoids this only
> because it runs the ramp the other way (1.04 → 12.08, monotonic).
>
> **The fix.** Dark basemap *and* invert the ramp so intensity rides brightness.
> A validated candidate — hue stays smoke-neutral and warms slightly, alpha
> carries the load:
>
> ```
> pm:    0     5    12    20    35    55   150   300
> rgb: 180,186,196 / 190,194,200 / 205,206,208 / 218,216,212
>    / 230,226,216 / 240,234,220 / 250,244,228 / 255,251,240
> a:  0.00  0.10  0.24  0.38  0.52  0.66  0.82  0.92
> ```
>
> Composited on `rgb(20,23,26)` this is monotonic 1.21 → 14.81, crossing 4.60 at
> the 35 µg/m³ "Smells like fire" threshold. Treat it as a starting point, not
> gospel — tune it, but **prove monotonicity across the full range** and ship
> the check as a script alongside `scripts/contrast-audit.mjs`.
>
> **Rule tension, already resolved — note it in your summary.** `CLAUDE.md`
> mandates a "gray→brown ramp, not AQI colors." White-on-black breaks the
> letter of that but keeps its intent: it's how smoke reads in GOES/VIIRS
> imagery and NOAA's own HRRR smoke products, so it still looks like smoke
> rather than a legend. Joe approved the direction. Update the `CLAUDE.md` line
> so the next reader isn't misled.
>
> **Scope:**
> - `src/components/SmokeMap.jsx` — swap the tile layer. **Use the three-layer
>   sandwich**, not `dark_all`: `dark_nolabels` → the smoke canvas →
>   `dark_only_labels` on top. Heavy smoke must never bury the city names, and
>   this is the only clean way to keep them readable. Keep CARTO's attribution.
> - `src/lib/rating.js` — replace `SMOKE_STOPS`.
> - `scripts/hrrr/render_frames.py:45-49` — the hand-synced NumPy copy of the
>   same ramp. **Both must change together**; the comment at `rating.js:80` and
>   `render_frames.py:43` exists precisely because they drift. Re-render the
>   frames and confirm the `data`-branch output still loads.
> - `src/components/SmokeLayer.js` — verify the per-pixel path still composites
>   correctly with the new alphas; the old ramp got darker as alpha rose, the
>   new one gets lighter, so any assumption baked in there will surface here.
>
> **Constraints:**
> - **The map section must hold a fixed dark context.** The rest of the page now
>   flips ink/cream with the live sky (branch B2); a basemap cannot flip with it
>   or the tiles will fight the type. Pin the map's own surface and make sure
>   the scrubber, agreement band, and clock chrome sitting over it stay legible
>   in that fixed context regardless of the sky above.
> - Do not change the map's placement — it stays portalled into `#map-slot`
>   above the FAQ for SEO, and it stays deferred behind the verdict. The
>   under-3-seconds-on-cellular rule is unaffected and must remain so.
> - Check the share card (`src/lib/shareCard.js`) and OG function (`api/og.js`)
>   do not inherit the ramp change unintentionally.
> - CARTO's free tier has usage limits and requires attribution. Confirm the
>   attribution renders, and note the ceiling in your summary — a viral smoke
>   event is exactly when it would bite.
>
> **Verify with the puppet rig** at `/ifhghs/demo` — branch B5 gave it a shape
> selector and platform frames, so you can force each level and compare. Deliver
> before/after captures at all five levels, plus the monotonicity check output.
> Commit and push to `claude/b10-dark-map`. Do not open a PR.

---

<a id="b11"></a>
## B11 — Self-hosted basemap · **Opus 5** · `claude/b11-self-hosted-basemap`
*Wave 5. Base: B10 merged. Must land its artifact before B8 or B9 renders a map.*

> Read `CLAUDE.md`, `docs/smokeshow-platform-plan.md` §1 and §9, and
> `src/components/SmokeMap.jsx`, `src/components/SmokeLayer.js`,
> `src/lib/basemap.js`, `src/lib/rating.js` and `scripts/smoke-ramp-audit.mjs`
> (all from B10).
>
> Replace CARTO's hosted tiles with a basemap this project owns.
>
> **Two independent reasons, either one sufficient.** CARTO's `basemap-styles`
> LICENSE.md — changed Oct–Nov 2025 — restricts their hosted tile services to
> enterprise customers and non-profit grants, with no free public tier; the
> 75,000 mapviews/month figure still quoted in older docs and third-party guides
> is stale. **Verify this yourself before starting**, because it sets whether
> this branch is urgent or merely correct. Independently, the apps are now free
> and the map is in the free tier (§1), so tile volume is unbounded and any
> per-view-priced provider is the wrong shape regardless of licensing.
>
> - **PMTiles + MapLibre.** One `.pmtiles` archive plus one style JSON, read by
>   MapLibre GL JS on the web and MapLibre Native on iOS and Android. This is
>   the same argument as B1's contract one layer down: three clients drawing
>   from one artifact cannot drift. Host on object storage with **zero egress**
>   (Cloudflare R2 is the reason to pick R2) — the whole point is that the
>   marginal cost of a free user's map view approaches zero.
> - **CONUS extent is enough for v1.** HRRR is CONUS-only
>   (`scripts/hrrr/render_frames.py` bounds), so a continental extract matches
>   the data. Note the storage cost and the rebuild cadence; an OSM basemap does
>   not need to be fresh to the week.
> - **The style must paint land at exactly `rgb(20, 23, 26)`.** `SMOKE_STOPS` is
>   audited against that tone and `npm run ramp` fails if `--map-surface` drifts
>   from it. If the style needs a different land colour, change the constant and
>   re-run the audit — do not let the two disagree.
> - **Keep the layer sandwich, but take the easier version.** B10 stacks
>   `dark_nolabels` → smoke canvas → `dark_only_labels` in a Leaflet pane at
>   z-index 450 because raster tiles gave no other way to keep place names above
>   heavy smoke. With vector tiles this is just layer ordering inside the style,
>   which is both cleaner and cheaper. Preserve the behaviour: labels must stay
>   legible at Smokeshow-level opacity.
> - **Decide Leaflet's fate explicitly.** Either keep Leaflet with
>   `protomaps-leaflet` (smaller diff, keeps `SmokeCanvasLayer` untouched) or
>   move to MapLibre GL JS (better long-term parity with the native clients,
>   but `SmokeCanvasLayer` and the HRRR `ImageOverlay` path both need porting).
>   Recommend the second if B8/B9 have not started their map work, the first if
>   they have. State the choice and why in the first commit.
> - **Keep B10's failure path.** `createTileHealth` in `src/lib/basemap.js` and
>   its `basemap_unavailable` event should survive the swap — a self-hosted
>   basemap can still 404 a bad deploy, and the bare-dark-surface fallback is
>   exactly as valid.
> - Attribution: OpenStreetMap contributors, plus whatever the tile build's
>   sources require. CARTO's credit comes out with CARTO's tiles.
>
> `npm run ramp` and `npm run verify:map` must both still pass, including
> `--fail-tiles`. Deliver a cost estimate at 10k / 100k / 1M daily actives
> against whatever hosting you pick. Commit and push to
> `claude/b11-self-hosted-basemap`. Do not open a PR.
