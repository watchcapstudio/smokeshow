# SMOKESHOW platform plan — free web, paid apps

Product architecture and phased delivery for: a free HTML site that works in
any browser, plus paid iOS, macOS, and Android apps at $2.99/month where
notifications and widgets live. All four surfaces must read as one product.

Companion docs:
- `docs/smokeshow-demo-implementation-plan.md` — the web re-skin (Phase A)
- `docs/branch-prompts.md` — copy-paste prompts for each work branch

---

## 1. The split

| Surface | Price | Has | Does not have |
| --- | --- | --- | --- |
| **Web** (smokeshow.earth) | Free | Everything on the site today, re-skinned; store badges + widget showcase | Notification settings, widgets |
| **iOS** | $2.99/mo | Everything web has, native; home + lock-screen widgets; push | — |
| **macOS** | included | Same, desktop widget families | Lock-screen accessories (no such surface) |
| **Android** | $2.99/mo | Same; Glance widgets; push | — |

The web keeps its `CLAUDE.md` hard rules intact — static-first, no accounts,
no email capture. Server state (device tokens, entitlements) lives on the app
side, which is a different product with different rules. The web's only new
element is a call to action.

**What you're actually selling.** Not alerts — glanceability. "People want to
see the data without needing to look it up" is the pitch, and the widget is the
product. Alerts are the retention mechanic that keeps the subscription alive
between smoke events. Sequence the marketing accordingly: the widget is the
hero, notifications are the second bullet.

---

## 2. The finding that shapes everything

**Cross-platform frameworks do not get you widgets.** React Native, Flutter,
Capacitor — all of them require you to write widgets natively anyway: SwiftUI +
WidgetKit on Apple, Kotlin + Jetpack Glance on Android. The framework saves you
nothing at exactly the feature you are charging for.

Second: **a WebView wrapper of smokeshow.earth will likely be rejected** under
App Store Guideline 4.2 (minimum functionality), and a paid subscription on a
thin wrapper invites more scrutiny, not less.

So the architecture is:

- **One SwiftUI codebase → iOS + macOS**, sharing widget views. Real leverage.
- **One Kotlin/Compose codebase → Android.** Separate, no way around it.
- **The web app stays as it is** (Vite + React, static).

Three clients, not one. Which raises the parity problem, and its answer:

### The parity mechanism: compute the verdict server-side

Today `rating.js`, `verdict.js`, `days.js`, and the trend logic run in the
browser. If Swift and Kotlin reimplement them, they **will** drift — and the
first thing to drift is "when does it clear," which is the product's one
promise. A user whose phone says *clears 6 PM* and whose laptop says *clears
9 PM* has caught you being wrong.

**Add `/api/forecast`** returning the fully-derived answer: level, clear-time,
arrival, peak, trend, day summaries with day-parts, sky parameters, and the
measured rows. Clients render; they do not compute. One implementation, one
source of truth, four identical answers.

This also makes widgets cheap. WidgetKit budgets a limited number of timeline
reloads per day (roughly 40–70), so a widget must fetch a *timeline* — many
hours in one call — not a point. `/api/forecast` is exactly that call.

Keep the client-side path in the web app as a fallback so a bad deploy of the
endpoint degrades instead of breaking.

---

## 3. Widgets

### The demo is already designed against the right iOS families

| Demo element | WidgetKit family |
| --- | --- |
| `.w-small` 148×148 | `systemSmall` |
| `.w-med` 296×140 | `systemMedium` |
| `.lk-inline` | `accessoryInline` |
| `.acc-circ` ×2 (PM arc, countdown arc) | `accessoryCircular` |
| `.acc-rect` | `accessoryRectangular` |

That is a real head start — the hard design work is done and it maps cleanly.

**Gaps to design:**
- `systemLarge` and `systemExtraLarge` (iPad and Mac desktop widgets).
- **Android Glance has no fixed families.** Widgets are responsive by `dp` and
  the user resizes them freely. The Android widget needs a *responsive* spec
  with breakpoints, not five fixed layouts. This is the single biggest
  Android-specific design task and it is easy to underestimate.
- macOS desktop widgets support `systemSmall/Medium/Large/ExtraLarge` but none
  of the accessory families.

**Worth taking while you're in there:** Apple Watch complications are nearly
free once the `accessory*` SwiftUI views exist. And a **Live Activity /
Dynamic Island** during an active smoke event ("Clears in 4h", counting down)
is the most differentiated thing on this list — nothing else in weather does
smoke this way.

### Widgets as web marketing

The demo already renders live widget mocks driven by real data
(`renderWidgets()`, demo:921). That is a finished marketing asset: a
"your air, on your home screen" block whose widgets update as the visitor
scrubs the timeline. Reuse it nearly verbatim for the web CTA section — it
demonstrates the paid feature using the visitor's own air, which is a far
stronger pitch than a screenshot.

---

## 4. Subscriptions

- **StoreKit 2** (iOS/macOS) + **Google Play Billing** (Android).
- **Use RevenueCat for v1.** It handles both stores, receipt validation, and
  the entitlement webhook you need to gate push server-side. Roughly 1% of
  revenue and it saves well over a week of billing plumbing you do not want to
  own. Revisit once volume justifies it.
- **Entitlement must be checked server-side** before the notification worker
  fans out to a device. Client-side gating alone means you keep paying APNs/FCM
  and compute for lapsed subscribers.
- **Identity stays anonymous.** A device-scoped opaque ID, no email, no
  password. Keeps the spirit of the no-accounts rule and removes a signup step
  from the funnel.

**Free tier — decided: none. Subscribe, with a 14-day free trial.** Standard
weather-app model. Configure the trial as a store-native introductory offer
(StoreKit introductory offer / Play base-plan free trial) so eligibility is
enforced by the store, one per account per subscription group, and RevenueCat
reports it uniformly across both.

Two consequences worth designing for rather than discovering:

- **The trial's job is to get a widget onto the home screen on day 0.** A trial
  that never becomes a glance never converts — the product's value is ambient,
  and it can't be felt from inside the app. Widget installation is the
  onboarding step, not a settings-screen afterthought.
- **Day 12–14 is the churn cliff, and the widget is the surface it happens on.**
  When the trial lapses the widget either disappears (iOS) or keeps rendering
  something (Android). What it shows at that moment is a deliberate design
  decision — your best conversion prompt, or a blank tile that reads as broken.
  Decide it; don't let it fall out of the implementation.

---

## 5. Notifications

Free to send (APNs and FCM both), so the cost is the evaluation loop.

Reuse work that already exists: `src/lib/grid.js` snaps coordinates to a
lattice. Snap subscriber locations the same way and evaluation becomes
`O(unique cells)`, not `O(users)` — ten thousand subscribers in Denver is one
evaluation.

Per hourly model run: fetch each occupied cell, run `computeVerdict()`, diff
against the last stored verdict, and fan out only on a *state change* —
threshold crossed, peak reached, cleared. Honor quiet hours (10 PM–7 AM local,
urgent only) at fan-out, not at send.

The demo's posture in the settings sheet is the right one and should ship as
written: *"Threshold alerts only. No digests, no streaks, no engagement
pings."*

---

## 6. The puppet harness — findings and the fix

You asked whether I checked it. I did, and it needs one structural change plus
a set of additions.

### What's wrong now

The puppet forces a **scalar** PM2.5 (`S.puppet.pm`) rather than a series.
Every downstream function that needs a time axis then has to fake one
separately, and they have already drifted apart:

1. **The trend chip contradicts the curve.** `pmAt()` returns a constant in
   puppet mode, so `trendAt()` always computes zero slope and the chip reads
   "Holding steady" — while `curveVals()` (demo:863) synthesizes a *rising,
   peaking* curve for levels 2+. The widget draws a peak while the chip denies
   one.
2. **Three hardcoded string tables must be hand-synced.** `PUPPET_CLEARS`
   (demo:544), the array inside `widgetSub()` (demo:779), and the branch in
   `nextChangeInfo()` (demo:796). They have drifted: at level 1 the phone says
   *"Thins out by evening"* while the countdown accessory says *"9h TO SMOKE"* —
   opposite futures, same state.
3. **The scrubber is disabled in puppet** (`opacity:.35; pointer-events:none`,
   demo:110) — a direct consequence of there being no series to scrub.
4. **Measured rows are synthesized at fixed ratios** (official = pm×1.15,
   local = pm×0.88, demo:1081) and both are always present. You cannot QA the
   states that matter: no sensors nearby, official-only, local-only, or a
   *large* divergence — which is the exact case the sheet's explanatory
   paragraph exists to justify.

### The fix — one decision

**Make the puppet synthesize a full 61-hour series instead of a scalar.**
Then `pmAt()`, `trendAt()`, `verdictLine()`, `widgetSub()`, and
`nextChangeInfo()` all run their real implementations unmodified, all three
string tables delete themselves, and the scrubber comes back on. Every
inconsistency above disappears as a side effect.

Control it with the existing PM slider as *amplitude* plus a new **shape**
selector: `Flat · Rising · Peaking · Clearing · Stuck all week`.

### Additions, in priority order

1. **Shape selector** (above) — the keystone.
2. **Sensors control** — `none / official / local / both`, plus a divergence
   slider. Needed to QA the measured-vs-model block, currently unreachable.
3. **Platform frames** — `Web · iOS · Android · macOS`. The rig currently only
   shows an iPhone. For a four-surface product this is the tool that answers
   "do they look like the same thing," which is the whole requirement.
4. **Place-name field** — long names ("Colorado Springs") versus short ("Bend")
   is a live layout risk at 148px widget width and there is no way to test it.
5. **Pin the ink crossover** — the `.dark-air` inversion flips at luminance
   0.42 and you currently have to drag the hour slider and hope to land on it.
   A button that jumps to the crossover for the current PM makes the contrast
   audit repeatable.
6. **Units and sensitive-household toggles** surfaced in the rig, not buried in
   the app's settings sheet.
7. **Share and OG card previews** — the two surfaces most likely to drift, with
   no preview today.
8. **Reduced-motion toggle**, so the motion path gets tested without changing
   OS settings.

This upgrades the puppet from a demo toy into the cross-platform design QA
tool, which is load-bearing given the parity requirement. It is also cheap —
it's one HTML file with no build step.

---

## 7. Timing

Today is **August 2, 2026** — mid-season. North American smoke season runs
roughly May–October.

Realistically iOS + widgets + billing is 5–7 weeks of focused work, landing
late September: the tail of this season. That argues for:

- **Ship the web re-skin now**, this season, with the widget showcase and
  "apps coming" framing. It compounds the free audience during the months that
  actually generate traffic.
- **Build the apps through the off-season**, beta in the tail of 2026, launch
  ahead of the 2027 opening.

Note the hard rule forbids email capture, so there is no waitlist play — the
web CTA can only be store badges once the stores are live. If you want a
waitlist, that rule needs an explicit exception.

---

## 8. Phases and branches

Nine work branches. `B0` must land first; `W1` runs concurrently; `W2` starts
once its dependency lands. Prompts for each are in `docs/branch-prompts.md`.

**The web re-skin ships first** (waves 1–3), then the platform work
(waves 4–5).

| Wave | # | Branch | Concurrent with | Owns | Model | Est. |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | **B0** | `claude/b0-scaffold` | B5 | CSS split, tokens, App.jsx slots, Vitest, `sky.js`, `trend.js` | Sonnet 5 | 1d |
| **1** | **B5** | `claude/b5-puppet` | B0 | The demo file only | Sonnet 5 | 1–1.5d |
| **2** | **B2** | `claude/b2-sky-shell` | B3, B4 | `SkyBackdrop`, shell CSS, contrast audit, lake removal | **Opus 5** | 1.5–2d |
| **2** | **B3** | `claude/b3-timeline` | B2, B4 | Ridgeline, Scrubber, AgreementBand, FiveDayStrip | Sonnet 5 | 1–1.5d |
| **2** | **B4** | `claude/b4-verdict-sheet` | B2, B3 | ExplainSheet, TrendChip, prefs, RatingChip, ShareButton | Sonnet 5 | 1.5d |
| **3** | **B6** | `claude/b6-marketing` | — | Web CTA + widget showcase + store badges | Sonnet 5 | 1–2d |
| | | *— web re-skin ships —* | | | | |
| **4** | **B1** | `claude/b1-forecast-api` | — | `api/forecast.js` + the JSON contract | **Opus 5** | 3–4d |
| **5** | **B7** | `claude/b7-notify-backend` | B8, B9 | Device registry, entitlement, eval loop, APNs/FCM | **Opus 5** | 2–3w |
| **5** | **B8** | `claude/b8-apple` | B7, B9 | SwiftUI app + WidgetKit, iOS + macOS, StoreKit | **Opus 5** | 5–7w |
| **5** | **B9** | `claude/b9-android` | B7, B8 | Kotlin/Compose + Glance, Play Billing | **Opus 5** | 3–5w |

Web re-skin: ~4–6 days elapsed with the concurrency above (vs. ~8 serial).

### Sequencing notes

- **B0 exists to make waves 1–2 safe to run in parallel.** `src/index.css` is
  1,040 lines and three branches want it; B0 splits it per-component and adds
  named slots in `App.jsx` so B2/B3/B4 fill slots instead of fighting over the
  tree. It also lands `sky.js` and `trend.js`, which all three depend on.
- **B5 is fully independent** — it touches only `public/ifhghs/demo/`. Start it
  the same moment as B0.
- **B1 must publish the JSON contract as its first commit**, before the
  implementation. That single file unblocks B7, B8, and B9 to start against a
  mock server — turning a serial chain into a parallel one and saving weeks.
- **B8 and B9 can run fully concurrently, but a ~2-week stagger is better
  value.** Apple is one codebase for two platforms and wildfire smoke skews to
  high-iOS-share regions, so B8 leads; starting B9 once B8's data layer and
  widget patterns exist buys consistency cheaply. Run them together only if
  launch date beats consistency.

### Why these models

- **Opus 5** where a wrong decision is expensive and hard to reverse: the API
  contract four clients depend on (B1), the solar math and accessibility
  contrast judgment that define the whole look (B2), distributed correctness
  in the notification loop (B7), and both native apps where real money moves
  through store billing (B8, B9).
- **Sonnet 5** where the source is in front of you and the target is
  specified: mechanical CSS restructuring (B0), component ports from demo code
  that already works (B3, B4), the standalone harness (B5), and the marketing
  block (B6).

---

## 9. Decisions taken

- **Lake illustration dropped.** ✅ Removes `LakeScene.jsx` and
  `assets/smokeshow-*.svg` from the app; the sky is the illustration now. The
  `assets/gen_smokeshow_art.py` generator stays in the repo as an archive.
- **Web has no notification settings** — CTA only.
- **Widgets are marketing on web, UI on native.**
- **No free tier in the apps.** Subscribe at $2.99/mo with a **14-day free
  trial**, store-native introductory offer (§4).
- **The web re-skin ships first**, before any platform work (§8).

## 10. Still open

1. **Copy** — production's level names and notices over the demo's, and a
   sign-off on `NOT_LINES` against the no-invented-dose-response rule.
2. **Repo layout for native** — `apple/` and `android/` in this repo, or
   separate repos? Recommend a monorepo so the design tokens and API contract
   have one home and cannot drift.
3. **Waitlist** — needs an explicit exception to the no-email-capture rule, or
   it doesn't happen (§7).
