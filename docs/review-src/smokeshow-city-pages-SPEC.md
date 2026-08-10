# Smokeshow city pages — build spec

Paste this file plus `smokeshow-cities.json` into Claude Code.

## Goal

Generate 24 new city pages matching the existing `/smoke-forecast/chicago-il/`
template, plus hub and corridor pages. Chicago is already built and only needs
its internal link block added. Chicago is the reference implementation. Do not
redesign it.

## URL structure

`/smoke-forecast/{slug}/` — flat, no state directory segment.
Slugs are in the JSON. Example: `/smoke-forecast/minneapolis-mn/`

Do NOT create state or province directories. They rank for nothing and
create thin intermediate pages.

## Rendering requirements (highest priority)

The verdict block — current level, clear time, model run stamp — MUST be
present in the server-rendered HTML, not painted client-side after hydration.

- Use ISR / on-demand revalidation keyed to the HRRR cycle, not a daily cron.
  A clear time computed at 6am is wrong by 4pm.
- Client hydrates and overwrites with fresher data on load.
- Render a visible freshness stamp: `Forecast from the 18Z run, 2:00 PM CT`
- `<title>` stays the evergreen question. Never inject the clear time into
  the title or meta description — it goes stale in the SERP for hours.

Acceptance test: `curl -sL <url> | grep -iE "[0-9]{1,2}:[0-9]{2} ?(am|pm)"`
must return the clear time on a smoky day, and the all-clear state on a
clear day. If it returns nothing, the build is not done.

## Page structure (order matters)

1. Verdict block — level, clear time, run stamp
2. Map with -12h / +48h scrub
3. Five-day strip
4. `What each level looks like from {City}` — the landmark scale
5. `Where {City}'s smoke comes from` — provenance
6. `Smoke in {City}? Common questions.` — FAQ
7. Internal links block (see below)
8. Disclaimer — reuse Chicago's verbatim

## Level thresholds (source of truth)

From `src/lib/rating.js`. `levelForPM25` uses `pm25 < l.max`, so each max is
exclusive and the boundary value belongs to the level above.

| # | Level | µg/m³ |
|---|-------|-------|
| 0 | All clear | 0 to <12 |
| 1 | In the air | 12 to <35 |
| 2 | Smells like fire | 35 to <55 |
| 3 | Tastes like fire | 55 to <150 |
| 4 | Smokeshow | 150+ |

HARD COPY RULE: never cite an AQI number anywhere in page copy, FAQ, or meta.
These thresholds are deliberately rounder than the EPA PM2.5 breakpoints
(9.0 / 35.4 / 55.4 / 125.4 / 225.4) and diverge at both ends. The displayed AQI
chip comes from `ugm3ToAqi()`, a different scale, so the chip and the level name
will not always change at the same moment. Any sentence naming an AQI value will
eventually contradict the chip on the same page. Reference level NAMES only.

`ARRIVAL_THRESHOLD` is separate verdict logic, not a display level. Do not
reference it in copy.

## The landmark scale

Level NAMES are universal and map to concentration thresholds, not distance:
All clear / In the air / Smells like fire / Tastes like fire / Smokeshow

Distance BANDS are per-city and live in the JSON. This is deliberate.
Chicago's "All clear = 10+ miles" describes what All clear looks like in
Chicago. In Seattle, All clear means Mt. Rainier is visible at 58 miles.
Same threshold, different visible manifestation. Forcing one band set on
every city throws away the strongest local signal in the mountain markets.

Copy for all five levels, all 21 cities, is pre-written in the JSON under
`levels`. Use it as-is. Format: `{vantage} + {target} + {distance} + {what you see}`

Keep Chicago's rendered layout: level name, band, then the sentence.

## Language: declarative, not hedged

Write every level description declaratively. "Lolo Peak stands clean," not
"Lolo Peak may have gone flat." The section header already scopes it: this is
what a level looks like, not a claim about this minute. Hedging every line
adds ~110 qualifiers across the site and reads as software that does not trust
its own output, which is the exact weakness this site exists to beat.

The calibration is carried once, in the section intro, alongside Chicago's
existing "distances are approximate" line. Do not distribute it into the lines.

## What looks like smoke here but isn't

Six cities have a `not_smoke` field: Denver, Philadelphia, Pittsburgh,
Salt Lake City, Sacramento, Fresno. Render it as its own section directly after
provenance, headed `What looks like smoke in {City} but isn't`.

This exists because those cities have a native haze — ozone, humidity, valley
dust, inversion — that visually mimics smoke and sends people to this page on
days when nothing is burning. Answering that honestly is a trust asset and a
distinct SEO target ("why is it hazy in {city}", "brown cloud denver").

Cities without the field get no section. Do not invent one.

## Valley / gateway sections

Two cities carry an extra prose section covering nearby towns that share their
air but do not warrant their own pages. Render after provenance.

### Flathead Valley (Whitefish only)

Whitefish has a `flathead_valley` field covering Kalispell, Columbia Falls,
Bigfork, and Glacier. Kalispell matters here: it outranks Whitefish on search
volume (60 vs 20) but Whitefish carries the outdoor community. The page is built
on the Whitefish slug and covers Kalispell in prose, meta description, and FAQ.
Revisit in 90 days per the note in its `validate` array.

### Yellowstone gateway (Bozeman only)

Bozeman has a `yellowstone_gateway` field. It names Livingston, Big Sky,
Gardiner, and West Yellowstone inside real prose rather than giving them their
own pages, which catches the long tail without adding thin pages. Search volume
for all four measures at zero.

## Provenance section

Pre-written per city in the JSON under `provenance`. Two paragraphs:
where the smoke comes from and how it travels, then a named historical
event that made locals start caring.

## FAQ

Use Chicago's six questions verbatim, swapping the city name where it reads
naturally and serves the query. Same questions across all cities is correct.

The ANSWERS must be materially different per city. Every answer must reference
at least one thing that appears nowhere else on the site: a named landmark from
that city's `levels`, its specific smoke source region, its historical event, or
its `not_smoke` detail. If an answer would read identically with the city name
swapped, rewrite it. That is the failure mode that turns 23 pages into one page
duplicated 23 times.

IMPORTANT: include an air-quality-phrased question on every page.
`Why is {City}'s air quality bad today?` — search volume for
"air quality {city}" runs 5 to 20x "smoke in {city}". Minneapolis is 2,900/mo.
That phrasing needs to be a structural element, not buried.

## Internal linking

Footer, sitewide, 5 links only: hub, how it works, about, privacy,
Canadian smoke explainer. Do NOT put 21 city links in the footer.

Hub page at `/smoke-forecast/` — 300 words on what a clear time is and how
the visibility scale works, then cities grouped by corridor. Not a link dump.

Each city page links to 5-8 destinations, all contextually earned:
- `upwind` cities from the JSON, anchored as "wildfire smoke in {City}"
- `nearby` cities from the JSON
- its `corridor` page
- the relevant explainer

Upwind links are the differentiator. Chicago links to Minneapolis and
Milwaukee because Ontario smoke usually crosses them a day earlier. That is
editorially true, unique per page, and unfakeable by a scraper.

## Corridor pages

Three, at `/smoke-forecast/corridor/{slug}/`:
- `canadian-smoke-great-lakes-northeast`
- `wildfire-smoke-pacific-northwest-northern-rockies`
- `wildfire-smoke-california-great-basin`

Each is editorial, holds its cities, and targets the regional head terms.

## Meta

Follow Chicago exactly:
- title: `Wildfire Smoke in {City} — When Will It Clear? | SMOKESHOW`
- description: `Live wildfire smoke forecast for {City}, {ST}. See the smoke over the city right now, where it came from, and the clear time — when the air is forecast to stay cleaner for six straight hours.`
- og:image: `/api/og?place={City}%2C%20{ST}`

## Build order

1. Missoula alone. Live outreach in that market has nowhere to land. Ship it,
   review it against the Chicago page, fix the template, then continue.
2. Whitefish, Bozeman, Jackson, Winnipeg, Minneapolis
3. Seattle, Denver, Spokane
4. Detroit, Milwaukee, Cleveland, Toronto
5. Boston, New York, Philadelphia, Pittsburgh
6. Portland, Bend, Boise, Salt Lake City, Reno, Sacramento, Fresno
7. Chicago link block, hub, three corridor pages

Do not batch all 24 in one pass. A template error ships 24 times.

## Canada

ECCC data is incorporated, so Toronto and Winnipeg build normally.

METRIC. Canadian pages use kilometres throughout — bands, level copy, and any
distance in the FAQ. Toronto and Winnipeg are already written in km in the JSON.
Apply the same to any Canadian city added later. Do not convert US pages.

Winnipeg matters out of proportion to its size. It is the upwind anchor for
Minneapolis and, one step further, for the entire Great Lakes and Northeast
corridor. Build it before the eastern cities so their upwind links resolve.
