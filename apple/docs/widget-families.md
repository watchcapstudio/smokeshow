# Widget families

The demo (`public/ifhghs/demo/index.html`) is the design source and it already
maps cleanly onto WidgetKit. Two families it does not cover are designed here.

| Demo element | Family | Status |
| --- | --- | --- |
| `.w-small` 148×148 | `systemSmall` | ported |
| `.w-med` 296×140 | `systemMedium` | ported |
| `.lk-inline` | `accessoryInline` | ported |
| `.acc-circ` (PM arc) | `accessoryCircular` | ported |
| `.acc-circ` (countdown) | `accessoryCircular` | ported, separate widget kind |
| `.acc-rect` | `accessoryRectangular` | ported |
| — | `systemLarge` | **designed here** |
| — | `systemExtraLarge` | **designed here** |
| — | `accessoryCorner` (watch) | designed here |

Every family renders from one `WidgetEntryModel`, resolved when the timeline is
built. No widget view touches a `Forecast`, because a view that can index into
`hours[]` is one refactor away from computing something.

## The three facts

Each family is the same three facts in a different amount of room:

1. **Where** — the place name, in the monospaced eyebrow, uppercased.
2. **What** — `scale[levelIndex].name`, server copy, verbatim.
3. **When** — `verdict.headline`, server copy, verbatim.

Below those, in whatever room is left: the reading with its mandatory "model
estimate" tag, the sky, the ridgeline as a visibility gauge, the 61-hour curve,
and the five-day strip.

## The two circular accessories are two widget kinds

iOS places one circular widget per *kind* per slot. Shipping the PM arc and the
countdown as a single kind would mean a user could only have one of them. They
are `SmokeshowAirAccessory` and `SmokeshowCountdownAccessory` so both can sit
under the clock at once, which is how the demo draws them.

## systemLarge — designed here

The demo has no design for it. What earns the extra height, in order:

- the level name at 30pt, and the headline beneath it;
- the reading, tagged "model estimate";
- **the five-day strip**, with the day-part bars the small families cannot fit.
  This is the family where the tile answers "when does it clear" *and* "what
  does the week look like" — the two questions the app itself opens with;
- a footer carrying the agreement label ("Single-model forecast. Confidence
  fades past 36 hours.") and the payload's age.

The footer is not decoration. A tile this large reads as authoritative, and a
tile that reads as authoritative without saying where its numbers come from
invites the user to treat a model as a measurement.

## systemExtraLarge — designed here

iPad and Mac only. It is a desktop object rather than a glance: read from feet
away, visible for hours. So it splits.

- **Left column** — place, level name at 38pt, headline, reading, and the
  footer; the 61-hour curve runs along the bottom of this column only (56% of
  the width), so the eye reads text-then-shape rather than text-over-shape.
- **Right column** — the week as *rows*, one per day, each broken into morning,
  afternoon, and evening with the server's own day-part colours and labels. This
  is the only family with room to name the day-parts instead of implying them.

Day-part colours come from `days[].dayParts[].bucket.color` — the coarse
four-step strip scale, which is **not** the five-level rating scale. They are
never cross-indexed.

## macOS

`systemSmall`, `systemMedium`, `systemLarge`, `systemExtraLarge` only. macOS has
no lock screen, so no accessory family exists there; the accessory views are
compiled out entirely (`#if os(iOS) || os(watchOS)`).

## Accessories are monochrome

The lock screen tints accessory widgets and renders them without colour. None of
the accessory views may lean on the rating colour to carry meaning — the number,
the word, and the arc do the work. The rating colours from `design/tokens.json`
appear only on the system families and inside the app.

## Empty, missing, and lapsed

Three states, all designed rather than implicit:

- **Model gap** (`pm25 == null`) — the reading renders `—` and the arc empties.
  Never `0`. Zero µg/m³ is a claim about clean air. On the curve the line breaks
  and the hour is hatched.
- **Unavailable** — no payload we will show as current. The tile says so and
  prints the age of what it last had.
- **Lapsed** — the trial ended. Place name and sky stay so the tile still looks
  like itself; the forecast is withheld, not frozen. See `trial-and-lapse.md`.

## Place selection

Widgets are configured with an AppIntent (`SelectPlaceIntent`) backed by the
saved-place store, so a user with two places gets two widgets. An unconfigured
widget falls back to the app's selected place — which is what makes day-0
onboarding work: the first widget added needs no configuration at all.
