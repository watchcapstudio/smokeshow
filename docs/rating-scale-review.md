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
