# Global smoke coverage — domains, encoding, and the byte budget

B11. Why the pre-rendered smoke field stopped at the US border, what replaced
it, and the numbers behind every choice.

## The problem

`scripts/hrrr/render_frames.py` renders NOAA HRRR-Smoke at 3 km over
`-125..-66.5 E, 24..50 N`. Outside that rectangle the map fell back to
`buildGrid()` — 81 CAMS point forecasts, nine across, interpolated. Nine blobs,
and nothing on screen said the reader had left the good coverage.

The rectangle cuts where it hurts most. Toronto, Montreal, Vancouver and
Winnipeg fall just inside. Calgary (51.05 N), Edmonton (53.55 N) and the NWT
fall outside — so the northern-Alberta and BC-interior fires that drive most
North American smoke events were off the map while their smoke was on it.
Europe never had coverage at all.

## What ships

Three **domains**, published side by side on the `data` branch:

| id | model | theme | resolution | extent | px | priority |
| --- | --- | --- | --- | --- | --- | --- |
| `hrrr` | NOAA HRRR-Smoke (MASSDEN, 8 m AGL) | light | 3 km | CONUS, `-125..-66.5 E`, `24..50 N` | 1200×680 | 100 |
| `cams` | Copernicus CAMS global forecast, surface PM2.5 | — | 40 km | `-180..180 E`, `-60..75 N` | 1200×639 | 10 |
| `hrrr-dark` | the `hrrr` field, dark-basemap ramp | dark | 3 km | as `hrrr` | 1200×680 | 1 |

`hrrr-dark` is one regrid, two palettes: the same HRRR field written with the
inverted ramp for clients drawing a dark basemap. It sits at the lowest
priority on the branch so a client that has never heard of `theme` cannot
select it, and `usable()` in `src/lib/frames.js` filters it out of the web
map, which draws Positron. A domain with no `theme` predates the field and is
light by definition, which is why `cams` has none.

Both come off the same plumbing in `scripts/render/`: the same Mercator target
grid, the same ramp, the same PNG encoder, the same manifest block. The CAMS
fields come from ECMWF's Atmosphere Data Store
(`cams-global-atmospheric-composition-forecasts`, `particulate_matter_2.5um`) —
the same CAMS product Open-Meteo already serves the app as point forecasts,
taken as a gridded field. Credentials live in the `ADS_API_KEY` Actions secret
and never reach the client.

The client picks the sharpest domain that **fills the viewport** and has a
frame for the selected hour — so HRRR wins inside CONUS at the zooms where its
3 km actually resolves, and a domain edge is never drawn across the map. See
decision 4. Where no domain has the hour, the 81-point grid still carries the
map — and now says so.

## Decision 1 — one global image, not regional domains

The brief offered three shapes: regional domains (North America / Europe /
rest), a coarse global tier with regional refinement, or a latitude-restricted
global field. **One global image, latitude-clipped, is what ships.**

Regional tiling does not save bytes. Three regions at the same resolution have
the same total pixel count as one world, plus three times the PNG headers,
three manifests, three render jobs, and a client that has to know which region
it is in and re-fetch when the reader pans across a boundary. The only thing it
buys is not rendering ocean — and ocean is the cheapest thing in the image,
because a PNG row of the palette's index 0 costs almost nothing.

The real lever is **bytes per pixel**, and there is a much better one available
(decision 3).

Latitude is clipped to **60 S .. 75 N**. Mercator y grows without bound toward
the poles, so the rows nearest the edges cost the most pixels per unit of
usefulness. 75 N keeps Utqiaġvik (71.3 N), Inuvik (68.4 N), Tromsø and all of
Siberia; it drops Svalbard. 60 S keeps Ushuaia (54.8 N) and South Georgia; it
drops the Antarctic stations. That clip removes about 32% of the pixels a
full ±85° Mercator world would need.

## Decision 2 — 0.3°/px, which is a 1.33× oversample and no more

CAMS global is a 0.4° product. Rendering it finer than that invents detail the
model does not have; rendering it coarser throws away detail it does. 1200 px
across 360° is 0.3°/px — enough oversample that Mercator's non-uniform row
spacing stays smooth, not enough to imply resolution that isn't there. It also
matches the HRRR domain's width exactly, so both domains have the same peak
decode cost and the client's image cache behaves identically for either.

The alternatives, measured (see below):

| width | °/px | oversample | canvas | KB/frame (pessimistic) | 61 frames |
| --- | --- | --- | --- | --- | --- |
| 1024 | 0.352 | 1.14× | 1024×545 | 229–256 | 13.7 MB |
| **1200** | **0.300** | **1.33×** | **1200×639** | **311–358** | **18.5 MB** |
| 1440 | 0.250 | 1.60× | 1440×767 | 418–501 | 24.9 MB |
| 1800 | 0.200 | 2.00× | 1800×958 | 582–739 | 34.7 MB |

## Decision 3 — PNG-8 whose palette *is* the ramp

Every pixel a frame can hold lies on one curve. The field is a scalar and the
ramp is a function of it, so an RGBA frame spends four bytes saying what one
byte can say. Frames are therefore written as indexed PNG with a 256-entry
palette derived from `SMOKE_STOPS` (`scripts/render/ramp.py`), never re-typed.

Index spacing is quadratic in µg/m³, so the fine steps land where the rating
thresholds are (5 / 12 / 20 / 35 / 55) and the coarse ones land above 150 where
the ramp is nearly flat. The largest alpha step between adjacent palette
entries is **3/255** — below what bands visibly on a smooth plume. `npm run
ramp` proves it: check 4 asks `ramp.py` for the exact bytes it will write and
compares every entry against `smokeRGBA()`.

This is not only a global-domain win. Re-encoding the four real published HRRR
frames from the `data` branch:

```
frame               px   RGBA KB  PNG-8 KB   ratio
frame-20260802T06  816000   413.1     201.3   2.05
frame-20260802T12  816000   415.7     204.4   2.03
frame-20260802T18  816000   385.0     198.1   1.94
frame-20260802T21  816000   394.0     207.3   1.90
```

**The CONUS map gets about twice as fast at the same fidelity** — 402 KB → 203
KB mean, ~24 MB → ~12 MB for a full 61-frame scrub.

## The byte budget

**Per frame: ≤ 360 KB. Full 61-frame window: ≤ 22 MB. Initial map paint: 2
frames.** Both domains now measured on real published data — see below.

The estimate was made before ADS credentials existed. Method: take the real
published HRRR fields off the `data` branch, recover PM2.5 (alpha is a strictly
increasing function of concentration, so the ramp inverts), resample CONUS to
the global domain's cell size, and tile that patch across a full 1200×639
canvas with a different flip and roll per tile so deflate cannot back-reference.
Two variants bracketed how much structure survives the trip to 40 km:

- **busy** — area-average 3 km straight to the target cell. Keeps HRRR's sharp
  gradients as sub-cell noise a 40 km model does not resolve: **358 KB**.
- **smooth** — gaussian blur to a 40 km effective footprint first, then
  average. What a 40 km model actually resolves: **311 KB**.

### What the real frames weigh

First CAMS publish, 2026-08-08 00Z run, and the CONUS domain beside it:

```
domain      frames   mean      max      total
hrrr        61       248 KB    266 KB   14.8 MB
cams        61       349 KB    361 KB   20.8 MB
```

**The per-frame bracket held: 349 KB sits inside 311–358.** Two corrections
worth recording, though.

The first is mine. The headline above originally read "≤ 19 MB" for the window,
which was 311 KB × 61 — the *smooth* end — while the per-frame ceiling beside it
was the *busy* end. Mixing the optimistic total with the pessimistic per-frame
number is not a bracket, it is a summary that cannot be true of any single
world. The pessimistic total was always 21.3 MB; the real one is 20.8 MB.

The second is about the world. Real CAMS lands at the **busy** end of the
bracket, not the middle, and the reasoning that called that end conservative
was wrong: "every ocean and desert as busy as CONUS in fire season" was
supposed to be an absurd worst case, but CAMS reports non-zero surface PM2.5
almost everywhere — Saharan dust, sea salt, Indo-Gangetic haze, biomass burning
across the tropics. There is very little of the cheap all-index-0 area the
optimistic proxy assumed. The synthetic-field render (`--source synthetic`)
comes out at 31 KB mean precisely because invented plumes over an empty planet
compress like nothing real does. **A clean planet is the thing that never
happens, not a busy one.**

**Does the map paint without stalling?** The reader downloads the hours they
look at, not the window. `scripts/verify-domains.mjs` measures what the browser
actually pulls, against the live branch:

```
Missoula (HRRR + CAMS backfill)   7 requests, 4 frames, 2290 KB
Edmonton (CAMS)                   4 requests, 2 frames,  718 KB
Madrid   (CAMS)                   4 requests, 2 frames,  718 KB
```

718 KB for a two-frame initial paint outside CONUS — roughly 3 s on a 2 Mbps
cellular link, for a component that is lazily mounted below the fold. Missoula
is the expensive case at 2290 KB, because a view that spills past the sharp
domain's edge loads four frames: two HRRR and two CAMS. **The
verdict-in-under-3-seconds rule is untouched: the map is deferred and the
verdict never waits on it.**

One unrelated saving fell out of the same measurement. `hrrr/series.json` is
2.2 MB and every reader was pulling it, including readers nowhere near CONUS.
It is now fetched lazily and only for readers inside the publishing domain's
extent.

### A published domain is immortal, and the allow-list that fixed it

A published directory on the `data` branch never goes away on its own.
`publish.sh` deliberately preserves directories it does not own — that mutual
trust is what lets the HRRR and CAMS jobs run on independent schedules without
either knowing the other exists — and `assemble_manifest.py` merges every
`domain.json` it finds, for the same reason. Together they mean anything
published stays published, and a `workflow_dispatch` from any branch can add a
domain to production.

`KNOWN_DOMAINS` in `assemble_manifest.py` closes that: a directory is not a
domain unless it is named there. Unknown directories carrying a `domain.json`
are **removed**, not merely skipped — skipping keeps them off the manifest but
leaves the frames on the branch forever, and this is the one step in the
pipeline that sees the whole tree. Directories with no `domain.json` are left
alone; they are not domains and not this step's business.

The fix is deliberately *not* to make publishers distrust each other's
directories. It is to say out loud what a domain is.

**How this went wrong first, which is the part worth keeping.** `hrrr-dark`
appeared on the branch as an unfamiliar third domain, was read as an accidental
dispatch, and was pruned — 14.8 MB deleted from the live branch. It was not an
accident. It is the deliberate dark-basemap render of the HRRR field, added to
`hrrr.yml` twenty-five minutes earlier, published at `priority: 1` and
`theme: dark` precisely so that no client which has never heard of `theme` can
select it. The evidence read as abandonment (low priority, an inverted palette,
never selected) was in fact the safety design working exactly as intended.

The next scheduled HRRR publish restored it, because `publish.sh` copies every
name in `DOMAINS`. The allow-list would have deleted it again on every run.

So the allow-list is not a judgement about what looks unfamiliar — that
judgement was wrong the first time it was made. It is a statement of what this
project publishes, and it has to be updated in the same change that adds a
renderer. `scripts/render/domains.test.js` enforces that in both directions: it
fails if a workflow publishes a domain the allow-list omits, and if the
allow-list names one nothing writes. The two lists live in different languages
in different directories, so nothing else keeps them in step.

## Decision 4 — the sharpest domain that FILLS the viewport

This decision moved twice. Both earlier versions drew a line across Montana,
and the line is the thing to design against.

**First attempt — sharpest domain containing the map centre.** HRRR inside
CONUS, CAMS outside. Zoom out anywhere near the border and HRRR's rectangle
ends at 50 N with the plume cut off mid-flow, nothing beyond it.

**Second attempt — backfill.** Paint the next domain down *outside* the sharp
rectangle, clipped even-odd so the two never overlap. This made the line worse,
not better, and measuring showed why it could never work:

**HRRR-Smoke MASSDEN is smoke. CAMS `particulate_matter_2.5um` is total
PM2.5** — dust, sea salt, sulfate, traffic. Over 21,888 co-located samples
inside CONUS at the same valid hour:

| | mean | p50 | p90 | p99 | frac > 35 |
| --- | --- | --- | --- | --- | --- |
| HRRR 3 km | 5.73 | 1.04 | 9.76 | 86.59 | 4.5% |
| CAMS 40 km | 10.58 | 8.53 | 17.73 | 45.22 | 2.5% |

Where there is smoke they agree almost exactly — **median ratio 1.00** across
the 3,296 cells where both read above 5 µg/m³, correlation 0.614, and the
two-degree means either side of the 50 N seam are 17.66 against 18.74. No unit
error, no calibration gap. What differs is the floor: CAMS carries roughly
8.5 µg/m³ of ordinary background aerosol that HRRR, modelling only smoke,
reports as clean (p50 8.53 against 1.04). The ramp's low end is steep by
design, so that floor paints as a continuous wash while HRRR's clean air stays
transparent, and the two butted together drew the difference as a hard-edged
rectangle — inviting the reader to compare quantities that are not comparable.

**What ships — `pickForView()`.** The map paints the sharpest domain whose
bounds contain the *entire viewport*, and failing that the widest domain
available. Never two at once, never one running out mid-screen.

| view | domain |
| --- | --- |
| Missoula, zoom 9 | `hrrr` — 3 km, its box fills the screen |
| Missoula, zoom 4 | `cams` — the view runs past 50 N |
| MT/AB border, zoom 9 | `hrrr` |
| MT/AB border, zoom 4 | `cams` |
| Edmonton or Madrid, any zoom | `cams` |

The seam cannot be drawn, because a domain is only used when it covers
everything on screen. What replaces it is a *transition*: zoom out past the
threshold and the field changes character. That is disclosed — the badge names
the model and its resolution, and it changes at the same moment the field does.
A zoom transition the reader caused is honest in a way a fixed line through
Montana is not, because the line reads as geography.

The cost is real and worth stating: zoomed out over the US you get 40 km total
PM2.5 instead of 3 km smoke, so plume filaments soften and background haze
appears. The gain is that during a Canadian-fire smoke event — the scenario the
brief is built around — zooming out finally shows the source region instead of
blank space above the border.

Neither seam was feathered at any point. A feather between two models is an
invented gradient across a real disagreement.

**What would let the sharp field win at every zoom** is a global field that
means what HRRR means. CAMS models seven aerosol types including organic matter
and black carbon, with biomass-burning emissions from GFAS, but does not expose
a fire-only surface tracer — organic matter and black carbon include fossil and
biofuel sources too. Swapping `particulate_matter_2.5um` for OM+BC would drop
Saharan dust and sea salt and probably most of the floor, at the price of an
approximation. It has not been measured, so it is not a plan yet. The even-odd
clipping code is in `git log` for whenever it is.

Worth noting the mismatch reaches past the map: the verdict comes from
Open-Meteo, which is CAMS **total PM2.5**, while the CONUS map layer is
smoke-only. A pre-existing product question this branch did not create and does
not settle.

## The manifest contract — v2

One `bounds` object could not describe two domains, so this is a versioned
break rather than an extension.

```jsonc
{
  "version": 2,
  "generated": "2026-08-02T21:00:00Z",
  "domains": [                    // sorted sharpest-first by `priority`
    {
      "id": "hrrr",               // also the directory on the data branch
      "label": "NOAA HRRR-Smoke", // what the coverage badge prints
      "model": "HRRR-Smoke near-surface (MASSDEN, 8m AGL)",
      "source": "NOAA HRRR-Smoke",
      "resolutionKm": 3,
      "priority": 100,            // higher wins where domains overlap
      "bounds": { "latS": 24, "latN": 50, "lonW": -125, "lonE": -66.5 },
      "width": 1200, "height": 680,
      "wraps": false,             // true = spans the full 360 degrees
      "run": "2026-08-02T18:00",
      "generated": "2026-08-02T21:00:00Z",
      "series": "series.json",    // optional: agreement-band point series
      "frames": [{ "time": "2026-08-02T06:00", "file": "frame-20260802T06.png" }]
    }
  ]
}
```

`src/lib/frames.js` accepts `version: 2` and nothing else. Anything else —
a newer publisher, the old single-`bounds` shape, a domain missing its bounds —
returns `null`, and the map degrades to the point grid with the badge saying
so. That is the intended failure mode, and it is what
`src/lib/frames.test.js` pins.

**Rollout order, for the next version bump.** Both sides degrade gracefully,
but not symmetrically, so the order is not a coin flip. `publish.sh` swaps a
domain's whole directory, so the moment a render job runs, the *old* manifest
path stops existing — an already-deployed old client 404s and silently loses
its frames. A new client meeting an old manifest degrades to the point grid
**and says so on the coverage badge**. Same fallback, but only one of them
tells the reader. So: deploy the client first, then dispatch the render jobs.

v1 → v2 shipped that way. The client landed on `main`, then `hrrr.yml` ran on
its next scheduled cycle and republished as v2.

## Publishing

Each render job writes `out/<domain>/` and calls `scripts/render/publish.sh`,
which pulls the current `data` branch (that is where the *other* domains live),
swaps in its own directory, rebuilds the root manifest from every `domain.json`
present, and force-pushes a fresh orphan commit. The branch stays one commit
deep on purpose — 61 PNGs rewritten four times a day would grow the repository
without bound and nothing reads the history.

`hrrr.yml` and `cams.yml` share the `data-branch` concurrency group with
`cancel-in-progress: false`, so they queue instead of overwriting each other's
directory with a stale copy. Their schedules do not overlap in any case: HRRR
at 02:40/08:40/14:40/20:40 UTC, CAMS at 09:30/21:30 UTC (CAMS global runs 00Z
and 12Z and reaches the ADS 6–8 hours later; `latest_cycle()` waits 9).

## Reproducing the numbers

```sh
# global frames, no ADS credentials needed — synthetic field, real pipeline
python scripts/cams/render_frames.py --source synthetic

# the ramp gate, including the shipped palette
npm run ramp

# coverage captures at Missoula / Edmonton / Madrid, two zooms each
npx vite --port 5173 &
npm run verify:domains
```

`scripts/verify-domains.mjs` mirrors every domain the `data` branch publishes,
verbatim, so the smoke in those captures is genuine NOAA and Copernicus output
at its published resolution and byte size. Only the basemap tiles are stubbed —
Positron's tones taken from `SMOKE_BASEMAP_BACKDROPS` so the composite
arithmetic is real while the cartography is not. If the branch has no `cams`
domain yet the rig falls back to the synthetic field and says so on stdout.
