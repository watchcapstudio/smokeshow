# Re-skinning smokeshow.earth in the `/ifhghs/demo` visual language

Implementation plan for adopting the demo's design across the live app.

Source reviewed: the committed demo at `public/ifhghs/demo/index.html`
(1,428 lines, 17 commits, `#2`–`#17`), against `src/` at `eace33a`.

> **This document is Phase A of `docs/smokeshow-platform-plan.md`**, which
> covers the full product: free web plus paid iOS, macOS, and Android apps.
> The work here is split across branches **B0, B2, B3, B4, and B6** — prompts
> in `docs/branch-prompts.md`.
>
> Decisions since first draft: **the lake illustration is dropped** (the sky is
> the illustration now); **the web carries no notification settings**, only a
> call to action for the paid apps.

---

## 0. The governing constraint

**This is a re-skin. Every piece of functionality on the live site stays.**

The demo is a design study, not a feature spec. It was built as a standalone
file and it quietly drops most of the app's engineering — the edge cache proxy,
the tiered grid, the agreement band, sensor anchoring, the whole share stack,
the SEO payload, the PWA behaviours. None of that is a design decision; it is
just scope the demo didn't need.

So the rule for this work is:

> Read the demo as *visual language* — colour, type, motion, hierarchy,
> surfaces. Read production as *the feature set*. Where the demo has no design
> for a production feature, design one in the demo's language rather than
> dropping the feature.

That last clause is the real work, and §3 lists exactly where it bites.

---

## 1. What the demo contains

| Part | What it is | Role here |
| --- | --- | --- |
| **The phone screen** | A complete alternative visual system | The design source |
| **The widget column** | iOS home/lock-screen mockups | Out of scope — WidgetKit is native-only |
| **The rig** (right column) | Live/Puppet tabs, PM2.5 and time sliders | Keep as a dev tool, don't ship to users |

The phone screen is not a palette swap. Production today is a scrolling dark
page (`--bg: #16130f`) with a cream illustration card in it. The demo is a
full-bleed sky that *is* the reading — colour, sun position, and haze all
driven by `(pm25, hourOfDay)` — with type sitting directly on it, flipping
between ink and cream as the sky darkens. Adopting it means replacing the page
shell, not adding components to it.

---

## 2. The design language to port

Six things carry the look. Everything else is detail.

1. **Live sky** (`skyB()`, demo:577). Zenith/horizon colour pairs for day,
   golden hour, and night, mixed by solar altitude, then pushed toward
   brown-grey by PM2.5 across two ramps. Drives the background, sun position
   and dimming, star opacity, and a luminance-triggered `.dark-air` class that
   inverts all text. Highest-value item in the file.
2. **Ridgeline** (`setRidge()`, demo:824). Two SVG ridge silhouettes; the far
   one's haze is gone by ~32 µg/m³, the near one is swallowed gradually to 130.
   Reads as "how far can you see" — the objective anchor `src/lib/rating.js`
   already writes its copy around.
3. **Curve as scrubber track** (`buildCurve()`, demo:996). A 60-hour PM2.5 area
   chart with a dashed 35 µg/m³ threshold and a now-rule, with a transparent
   range input over it.
4. **Type and surface system.** Monospace eyebrows at 11px/0.16em uppercase;
   44px/800 verdict word; `#8C3E10` clear-line on light air, `#F0A468` on dark;
   `rgba(255,255,255,.30)` pill surfaces that flip to `rgba(0,0,0,.24)` on dark
   air. Film grain at 10% overlay.
5. **Bottom sheet** as the secondary surface — cream `rgba(251,247,238,.97)`,
   24px top radius, `translateY` transition, grab handle.
6. **Motion.** 650ms cubic ease-out glide on day tap; 0.25–0.4s linear
   crossfades on sky and ink; everything off under `prefers-reduced-motion`.

Plus two content ideas worth adopting: the **five-level ladder** in the sheet
(current level enlarged, thresholds right-aligned) and the **trend chip**
(hidden when clear and steady).

---

## 3. Production surfaces the demo has no design for

This is the gap that decides whether the re-skin looks finished or half-done.
Each of these ships today and must keep working; none appears in the demo.

| Surface | File | What it needs |
| --- | --- | --- |
| **Agreement band** | `AgreementBand.jsx` | The model-disagreement band under the scrubber. Needs a treatment that reads on a live sky — probably a low-opacity ribbon in `--ink` rather than the current panel |
| **Share button + card** | `ShareButton.jsx`, `lib/shareCard.js` | Ships in v1 per the share spec. Needs a place in the demo's layout — the demo has no button chrome at all |
| **Shared-link banner** | `SharedBanner.jsx` | The "check your air" conversion moment for link recipients |
| **Location chooser** | `LocationSearch.jsx` | The demo's search lives in the map overlay only; production also needs the denied-permission path |
| **Install nudge** | `InstallNudge.jsx` | PWA prompt |
| **Pull to refresh** | `PullToRefresh.jsx` | Its spinner is currently styled for the dark shell |
| **Play / pause loop** | `Scrubber.jsx` | Satellite-loop playback. The demo dropped it; it stays |
| **Measured past-day boxes** | `FiveDayStrip.jsx` | Past days labelled "measured" vs "model estimate" |
| **Official / local source toggle** | `RatingChip.jsx` | User picks which measured source anchors the verdict |
| **Loading + error states** | `App.jsx:332-361` | Currently bare text on `--bg`; need a sky-aware equivalent |
| **SEO block** | `index.html` | FAQ, explainer, disclaimer, JSON-LD. Static, below the app, currently styled against the dark shell |

Two of these need a call from you rather than just a design pass:

**The map.** The demo opens it full-screen from the location name. Production
portals it into `#map-slot` above the FAQ so the static SEO content is in the
initial payload and the map defers behind the verdict. Recommendation: **keep
the map where it is and re-skin its chrome**, then optionally add an expand
affordance to go full-screen. Moving it behind a tap on the location name hides
it from crawlers and from anyone who doesn't know to tap.

**The lake illustration — decided: dropped.** `LakeScene.jsx` and the sky were
two answers to the same question and stacking them is busy. The sky is the
illustration now. `LakeScene.jsx` and its CSS come out (branch B2);
`assets/gen_smokeshow_art.py` and the SVGs stay in the repo as an archive.

---

## 4. Where the demo's code should not be copied

The demo takes shortcuts that are correct for a standalone file and wrong here.
Port the *look*, not these lines:

- **Direct Open-Meteo fetches** (demo:648, 1177). `/api/aq` exists so a viral
  smoke event doesn't blow the free tier. Route through `lib/openMeteo.js`.
- **Flat 7×7 grid at 0.35°** (demo:1169). Production runs three zoom tiers,
  81 points each, lattice-snapped so nearby users share cache entries.
- **`rampColor()`** (demo:1157). A different smoke ramp from production's
  `SMOKE_STOPS` (`rating.js:81`), which is perceptually weighted and kept in
  sync with `scripts/hrrr/render_frames.py`. Keep production's.
- **Fixed 6 AM–9 PM solar day** (`sin(π(t-6)/15)`, demo:578). Ignores latitude
  and season — visibly wrong in Fairbanks in June. Replace with a real solar
  position calculation (~20 lines, NOAA approximation).
- **`placePhoneRidge()`** (demo:852). Calls `getBoundingClientRect()` every
  frame to sit the ridge above the verdict word. Use a CSS anchor.
- **`innerHTML` curve rebuild** (demo:907). Re-serialises three SVGs per scrub
  event. Mutate `d` attributes instead.
- **Its own `/api/sensors` fetch** (demo:637). `App.jsx:125` already has this
  in state.

### Copy divergence

The demo rewrites strings that `src/lib/rating.js` implements deliberately:

| | Production | Demo |
| --- | --- | --- |
| Level 2 name | "In the air" | "Something's in the air" |
| Level 2 notice | "A faint campfire whiff **for sensitive noses**…" | "Faint campfire smell outdoors." |
| Level 3 notice | "**Most people** smell smoke outdoors, **though not everyone**…" | "You smell it the moment you step outside." |

`rating.js:1-7` states the rule: *describe what MOST people notice, never what
the reader WILL feel.* The demo's copy is punchier and breaks it.
Recommendation: **production's names and notices win.** The demo's genuinely
new blocks — the ladder ranges, `EPA_LINES`, `EPA_SENS`, and "the plan"
line — are additive and worth adopting, with `NOT_LINES` reviewed against the
"no invented health dose-response claims" rule (two of them are reassurances
about cigarette equivalence, which is still a dose claim).

### Performance

The sky is CSS gradients and costs nothing. The risk is the scrub path: the
demo's `update()` re-renders the sky, re-serialises three curve SVGs, recomputes
the ridge, and redraws the map canvas on every `input` event. That's fine at
demo scale and won't be in React with the map mounted. Mitigation: write CSS
custom properties instead of re-rendering, mutate SVG attributes in place, and
throttle the map canvas to `requestAnimationFrame`. The
`verdict-paints-in-under-3-seconds` rule is unaffected — the sky paints with
the first PM2.5 value.

---

## 5. Phases

Five phases, each independently shippable and revertible. No phase removes a
feature.

### Phase 0 — Shared engine (½ day)

No visual change ships. Pull the demo's maths into `src/lib/` so it's tested
and shared.

- **New `src/lib/sky.js`** — port `skyB()`, `mix()`, `lerp()`, `clamp01()`,
  `lum()`. Export `skyFor(pm25, date, lat, lon)` → `{ zenith, mid, horizon,
  sunX, sunY, sunCore, sunOpacity, starOpacity, isDark }`. Real solar position
  per §4.
- **New `src/lib/trend.js`** — port `trendAt()` (demo:766): six-hour lookahead,
  ±4 µg/m³ deadband, suppressed below 12. Guard against contradicting
  `computeVerdict()`'s trend, which answers a different question (threshold
  crossings, not slope) — the chip must not say "Improving" while the headline
  says "No clear air as far as the forecast goes."
- **Tests** — sky output at five level anchors × four times of day; trend
  deadband edges. No test runner exists today; either add Vitest or extend the
  `scripts/verify-*.mjs` Puppeteer pattern (open question §7).

### Phase 1 — The sky and the ink system (1.5–2 days)

The change that makes the app feel like the demo.

- **New `src/components/SkyBackdrop.jsx`** — fixed layer behind `#root`:
  gradient, sun, stars, grain. Writes `--sky-zen` / `--sky-mid` / `--sky-hor` /
  `--ink` on `:root` rather than re-rendering children, so scrubbing is a style
  write.
- **`src/index.css`** — existing `:root` colours become fallbacks; all chrome
  reads `--ink`. Port the `.dark-air` inversion (horizon luminance < 0.42 →
  cream `#F4E9D6`, else ink `#26221B`).
- **Contrast audit.** The demo's single luminance threshold lands near 4.5:1 at
  the crossover. Check every text colour against the actual gradient at the
  boundary; be willing to add a scrim behind the type block. Budget half a day
  — this is the most likely thing to be quietly wrong.
- **Re-skin the surfaces the demo doesn't cover** (§3): loading and error
  states, pull-to-refresh spinner, install nudge, shared banner, location
  chooser, and the static SEO block below the app.

### Phase 2 — Ridgeline, curve scrubber, motion (1–1.5 days)

- **New `src/components/Ridgeline.jsx`** — port the two ridge paths and
  `setRidge()`. Renders once; scrub mutates two `stop-opacity` attributes.
  CSS-anchored, not measured per frame.
- **Re-skin `src/components/Scrubber.jsx`** — keep the props, the range input
  (accessible, keyboard-driven), **and play/pause**. Add the 60-hour area chart
  behind it, memoised per data change, with only the thumb moving on scrub.
  Keep the 35 µg/m³ dashed threshold and the now-rule.
- **Re-skin `src/components/AgreementBand.jsx`** — needs a new treatment for
  the sky background (§3).
- **`src/components/FiveDayStrip.jsx`** — add the demo's `glideTo()` easing on
  day tap (650ms cubic ease-out, straight jump under reduced motion). Keep the
  measured past-day boxes. Day-part bars are already shipped and already match
  the demo.

### Phase 3 — Trend chip, explain sheet, prefs (1.5 days)

- **New `src/components/TrendChip.jsx`** — reads `lib/trend.js`, hidden when
  clear and steady.
- **New `src/components/ExplainSheet.jsx`** — bottom sheet: eyebrow
  (`Level N of 5 · X µg/m³ · model estimate`), five-level ladder built from
  `LEVELS` (do not re-declare the table), `NOT_LINES[i]`, EPA guidance with the
  sensitive-household variant, "the plan" line, measured-vs-model rows, and the
  disclaimer. Rows read from `sensorNow` already in `App.jsx:125`.
  Add what the demo lacks: focus trap, `Escape` to close, `aria-modal`.
  Triggers: verdict word, clear-line, sense line, number, "What this means".
- **`src/lib/rating.js`** — add `NOT_LINES`, `EPA_LINES`, `EPA_SENS`, `RANGES`
  beside `LEVELS`, subject to the §4 copy review.
- **New `src/lib/prefs.js`** — extend `lib/storage.js` (don't add a second
  helper) for `units` and `sensitive`. Wire `units` through `RatingChip` and the
  sheet eyebrow; `lib/aqi.js` already does the conversion.
- **Re-skin `ShareButton.jsx`** and the share card — the demo has no button
  chrome, so this needs a design pass in its language.

### Phase 4 — Map chrome (1–1.5 days)

- Re-skin the inline map in place: the demo's top gradient bar, mono clock,
  back/expand affordance, and the FAB treatment. Keep `#map-slot` and the
  portal (§3).
- Optional: expand-to-full-screen overlay, reusing `LocationSearch` and
  `lib/geolocation.js` rather than the demo's inline geocoder.
- Keep production's `SMOKE_STOPS` ramp, tiered grid, and `/api/aq` routing.

### Phase 5 — Settings sheet and app CTA (1–2 days)

**Decided: the web carries no notification settings.** Notifications are a paid
app feature (`docs/smokeshow-platform-plan.md` §5), so the web's settings sheet
holds the units toggle and the sensitive-household pref only. The demo's
"Watching this air. You'll hear when it changes" row does **not** ship — it
promises push the site can't deliver.

In its place, the web gets a **call to action for the paid apps** (branch B6).
The demo already renders live widget mocks from real data (`renderWidgets()`,
demo:921) — reuse that as a "your air, on your home screen" section whose
widgets update as the visitor scrubs their own timeline. Store badges go behind
a feature flag until the apps exist. No email capture, no waitlist — the hard
rule stands.

---

## 6. Effort

| Phase | Scope | Estimate |
| --- | --- | --- |
| 0 | Shared sky/trend libs + tests | 0.5 day |
| 1 | Sky, ink inversion, contrast audit, uncovered surfaces | 1.5–2 days |
| 2 | Ridgeline, curve scrubber, agreement band, motion | 1–1.5 days |
| 3 | Trend chip, explain sheet, prefs, share button | 1.5 days |
| 4 | Map chrome | 1–1.5 days |
| 5 | Settings sheet + app CTA | 1–2 days |
| **Total** | | **~7–8 days** |

Phases 0–3 are the core look and stand alone at ~4.5–5 days if you want to ship
in two passes. Phase 0 is branch B0, which also unblocks the rest to run
concurrently — see `docs/branch-prompts.md`.

---

## 7. Open questions

1. **Map placement** — confirm it stays inline above the FAQ (SEO) with an
   optional expand, rather than moving behind the location name.
2. **Copy** — confirm production's level names and notices win over the demo's,
   and sign off on `NOT_LINES` against the no-invented-dose-response rule.
3. **Test runner** — Vitest is now scoped into branch B0. Confirm, or say if
   you'd rather keep extending the Puppeteer `scripts/verify-*.mjs` pattern.

Settled: lake dropped (§3), no web notification settings (Phase 5).
