# Rating scale review, August 2026

The five-level ladder in `src/lib/rating.js` was questioned and left unchanged.
This note records the reasoning so the same ground is not re-walked, and so the
one change that *is* worth making is written down rather than remembered.

The scale under review:

| PM2.5 | Level |
| --- | --- |
| < 12 | All clear |
| 12 – 35 | In the air |
| 35 – 55 | Smells like fire |
| 55 – 150 | Tastes like fire |
| 150+ | Smokeshow |

Two changes were proposed: insert a "Hint of fire" rung before "Smells like
fire", and move the "Tastes like fire" floor from 55 up to 95.

## Do not raise the "Tastes like fire" floor to 95

55 µg/m³ is where EPA flips from "Unhealthy for Sensitive Groups" to plain
"Unhealthy", which covers everyone rather than only sensitive groups. It is the
best-justified threshold on the ladder, and the label escalates exactly on it
today. Raising the floor to 95 puts the whole everyone-is-affected band under a
name that reads as a nuisance.

Two things break downstream:

- `cigaretteEquivalent()` is surfaced at "Tastes like fire" and above only. A
  full day at 55 is roughly 2.5 cigarettes and at 95 roughly 4.3. Raising the
  floor strips the dose framing out of 55–95 entirely. The comment block above
  `NOT_LINES` records that this exact class of mistake, reassuring copy that
  understated exposure by about 2x, was already caught and fixed once.
- `EPA_LINES[3]` and `EPA_SENS[3]` say to avoid prolonged exertion. That is the
  correct guidance from 55 up, and it would stop firing until 95.

## Do lower the "Smokeshow" floor from 150 to 125

The proposal was aimed at a real defect, at the other end of the same band.
55 – 150 is the widest rung on the ladder and 150 µg/m³ resolves through
`ugm3ToAqi()` to roughly AQI 225, three quarters of the way through the purple
"Very Unhealthy" range. So at 140 the app says the same two words it says at 56.

Moving the floor to 125 lands on AQI 201, the purple line, and on EPA's own
Very Unhealthy breakpoint at 125.5. "Tastes like fire" becomes 55 – 125, a 2.3x
band instead of 2.7x.

Blast radius is small and contained to the scale itself: the two thresholds in
`LEVELS`, the visibility anchors on the top two rungs, and `rating.test.js`. The
illustration, the 25 city pages and the Apple clients are untouched, because
none of them encode the numbers. This is the change to make if the scale is
reopened.

## Do not add a sixth rung

The "hint" rung already exists. It is "In the air", and its `notice` reads "A
faint campfire whiff for sensitive noses." Adding "Hint of fire" above it gives
three consecutive fire-named rungs and blurs the ladder rather than sharpening
it. The genuine concern underneath, that 12 – 35 covers a wide range and is
where most real smoke days live, is a copy problem on that rung, not a missing
rung.

The one good argument for six levels is that it would map 1:1 onto EPA's six
categories. It does not survive the cost:

- **The illustration.** `assets/gen_smokeshow_art.py` has four depth layers
  (hills, trees, water, dock) and five states, one layer eaten per level. A
  sixth state has no layer left to eat, and that mechanic is the illustration.
- **The city pages.** 25 hand-written `bands` arrays and 25 hand-written
  `landmarks` arrays in `src/data/locations.js`, all indexed 0–4. A sixth rung
  means 50 new strings written against real sightlines, under the standing rule
  that an invented landmark is worse than an absent one.
- **`ARRIVAL_THRESHOLD`.** It is 35, defined as the "Smells like fire" anchor.
  Insert a rung at 35 – 55 and the constant still reads 35 but stops meaning
  what its comment says, and the arrival text starts firing at the hint level.
- **Shipped clients.** "Level N of 5" is hardcoded in `ExplainSheet.jsx` and
  `ExplainSheet.swift`, and `Forecast.swift` hardcodes 35 as the smells
  threshold. Level *names* are safe, because they ride the `SCALE` array in the
  forecast payload rather than being retyped client-side. Anything keyed to the
  index is not: `OLFACTORY_FATIGUE_LEVEL_INDEX = 3` and the `levelIndex >= 2`
  test in `InstallNudge` both shift meaning under installed builds.

That last point generalises. `levelIndex` is a wire value read by clients that
are already in the field, so any change to the *number* of levels is a contract
change and needs to be versioned like one. Changing a *threshold* is not, which
is the other reason the 125 change is cheap and this one is not.

## Decision

Left as-is on 2026-08-12. If it is reopened, the 125 floor is the first move and
it stands on its own.

---

# Naming review: getting the scale off smell

A second pass, same week. The question this time was not where the thresholds
sit but what the rungs are called. Two of the five names claim a smell, and the
report from the field is that the app said "Smells like fire" on a day that did
not smell like anything.

## The names already contradict the file they live in

`rating.js` opens by stating the rule:

> describe what MOST people notice, never what the reader WILL feel. Noses vary
> wildly, and fine particles can irritate with no campfire smell at all (dust,
> exhaust, aged smoke). Visibility is the one objective anchor everyone can
> check, so each level leads them to the window.

Every other surface honours that. The `notice` copy hedges carefully ("Most
people smell smoke outdoors, though not everyone"). The hub carries a section
called "How the visibility scale works". The per-city bands are distances.

The names do not. And `NOSE_CAVEAT` exists for no other purpose than to walk
them back, rendering on the chip at every level at or above 1
(`RatingChip.jsx:140`): "Noses differ, and fine particles can irritate without
any smell. The honest test is visibility: how far can you see?"

That constant is the tell. The product ships an apology for its own labels.
Renaming off smell deletes the apology rather than adding to it.

The physical case points the same way. Visibility degrades from scattering well
below the concentration where anyone smells anything, and long-transport smoke
(Canadian boreal into the Great Lakes, which is most of what this app forecasts)
arrives aged, with the odorous compounds largely stripped and the particles
intact. Seeing it before smelling it is the normal case here, not the edge one.

## What a rename actually costs

Cheaper than expected, and the reasons are worth writing down.

- **Names are server copy.** Clients render `scale[levelIndex].name` from the
  forecast payload rather than hardcoding strings. A rename reaches TestFlight
  build 8 with no app update.
- **Keys must NOT change.** `Forecast.ScaleEntry.Key` (`Forecast.swift:136`) is
  a wire enum with cases `smells` and `tastes` and an `.unknown` fallback.
  Renaming the keys makes shipped builds decode `.unknown` and lose their
  per-level accent colours, which are keyed the same way in `shareCard.js`. The
  keys stay semantically stale on purpose; that is the cheap half of the trade.
- **City copy is nearly untouched.** The only level names in `locations.js` are
  inside the phrase "All clear through Smokeshow" (2 occurrences), which names
  the endpoints and survives any rename of the middle rungs. One mention in
  `gen-location-pages.mjs` and five in the build brief need editing.

## The length budget is 16 characters

Measured, not guessed:

| Surface | Constraint |
| --- | --- |
| Share card hero (`shareCard.js:50`) | Auto-fits from 130px down to 24px across 1080px. 16 chars renders near full size; 27 chars lands around half, and the hero stops being a hero. |
| Share card 5-day strip (`shareCard.js:76`) | Word-wraps into a 203px box at 24px. Roughly two words per line, three lines before it overflows the 130px cell. |
| App 5-day strip (`FiveDayStrip.css:195`) | 0.78rem inside a one-fifth column, about 65px on a 360px phone. |
| Widget / lock screen (`WidgetModel.levelName`) | Appears alone, with no ladder around it. Must carry severity standalone. |

The current longest names are "Smells like fire" and "Tastes like fire" at 16
characters. That is the budget the layout was built against.

## Why "Hazy hills & trees" cannot be a universal name

It was the strongest idea in the proposal, and it fails on one specific rule.
Level names are universal; what a level *looks like* is per-city. That split is
stated in both `CLAUDE.md` and the header of `locations.js`, and it is the
reason there are 25 pages instead of one.

"Hills" is a landscape claim. It is true in Denver, Salt Lake and Seattle, and
false on the Chicago lakefront and in Detroit, where the whole sightline is
water and skyline. A universal rung named for hills asserts terrain that a third
of the covered cities do not have.

The imagery is still worth keeping. It belongs where the per-city material
already lives: the `landmarks` arrays, and the ladder rungs in the explain
sheet, which today render name and range only and drop `level.visibility`
entirely (`ExplainSheet.jsx:106-107`).

## Candidate sets

All keep "All clear", "In the air" and "Smokeshow"; all replace only rungs 2
and 3. Character counts in brackets.

| Set | 35 – 55 | 55 – 150 | Read |
| --- | --- | --- | --- |
| **A. Visible / Thick** | Visible smoke [13] | Thick smoke [11] | Unmistakably smoke rather than fog. Escalates on one axis a reader can check. Flattest voice of the four. |
| **B. Haze** | Hazy [4] | Heavy haze [10] | Shortest, best on the strip, closest to how people actually talk. "Haze" reads as weather, not smoke, and rung 2 lands soft. |
| **C. Conversational** | Seeing smoke [12] | Can't see far [13] | Keeps some of the voice the current ladder has. "Can't see far" is a consequence rather than a description, which is the honest framing. |
| **D. Plain-spoken** | Smoke you can see [17] | Can't see through it [20] | The clearest of the four and the only one over budget. Halves the share-card hero and wraps to three lines on the strip. |

## The tradeoff nobody should be talked out of

The current ladder is a joke with a punchline: smells, tastes, smokeshow. It is
the reason the product has the name it has. Every candidate above is more honest
and less funny, and rung 5 keeps carrying the voice alone.

Set C preserves the most character for the smallest accuracy cost. Set A is the
safest. Set D is the clearest and the only one the layout would have to be
changed to accommodate.

## Also decided

The explain sheet's EPA guidance paragraph becomes one sentence plus a "Learn
more" link. The destination already exists: the "How the visibility scale works"
section on the hub (`gen-location-pages.mjs:686`). EPA category material goes on
that page rather than into the sheet.

If the category is named in the UI at all, it must be derived from the value via
the existing `aqiCategory()` and never from the level index. The rungs do not
sit 1:1 on EPA's categories: "Tastes like fire" (55 - 150) spans EPA *Unhealthy*
and *Very Unhealthy*, which split at 125.5.

## Outcome

**Set B shipped, August 2026.** "Smells like fire" became **Hazy**, "Tastes like
fire" became **Heavy haze**. Thresholds were not touched; the 125 floor argued
for above remains unmade and stands on its own whenever the scale is reopened.

What went with the rename:

- `NOSE_CAVEAT` is deleted. It existed only to walk the smell names back, and
  the names no longer need walking back. The olfactory-fatigue caveat at level 3
  and above stays, because it tells the reader *not* to trust their nose, which
  is the same argument the new names make.
- `notice` and `NOT_LINES` copy lead with visibility at every level. No line
  tells a reader what they will smell.
- The explain sheet's guidance is one sentence plus a "Learn more" link to
  `/smoke-forecast/#visibility-scale`, rather than more paragraphs in the sheet.
  The hub section gained a paragraph on why the names track sight and not smell,
  and an `id` to link to.
- `api/og.js` kept a hand-typed copy of the five names, used for the 5-day strip
  in link previews. It now derives from `LEVELS`. Left alone, the rename would
  have shipped previews naming levels the app no longer used, and nothing would
  have caught it: no test covers that file's copy.
- The two renamed art states and their SVGs follow the names
  (`smokeshow-3-hazy.svg`, `smokeshow-4-heavy-haze.svg`).

Known and deliberately not updated: `public/ifhghs/demo/index.html` is a frozen
`noindex` prototype carrying its own hardcoded ladder. It was already out of
sync before this change (it still says "Something's in the air"), and syncing it
is a separate decision about whether that demo is still live at all.
