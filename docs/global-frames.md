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

Two **domains**, published side by side on the `data` branch:

| id | model | resolution | extent | px | priority |
| --- | --- | --- | --- | --- | --- |
| `hrrr` | NOAA HRRR-Smoke (MASSDEN, 8 m AGL) | 3 km | CONUS, `-125..-66.5 E`, `24..50 N` | 1200×680 | 100 |
| `cams` | Copernicus CAMS global forecast, surface PM2.5 | 40 km | `-180..180 E`, `-60..75 N` | 1200×639 | 10 |

Both come off the same plumbing in `scripts/render/`: the same Mercator target
grid, the same ramp, the same PNG encoder, the same manifest block. The CAMS
fields come from ECMWF's Atmosphere Data Store
(`cams-global-atmospheric-composition-forecasts`, `particulate_matter_2.5um`) —
the same CAMS product Open-Meteo already serves the app as point forecasts,
taken as a gridded field. Credentials live in the `ADS_API_KEY` Actions secret
and never reach the client.

The client picks the sharpest domain that contains the map centre and has a
frame for the selected hour. HRRR keeps winning inside CONUS. Where nothing
covers, the 81-point grid still carries the map — and now says so.

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

### A published domain is immortal, and that is a bug

The first two-domain manifest came back with **three** domains. A
`workflow_dispatch` of `hrrr-smoke` from the `feat/smoke-map` branch published
an `hrrr-dark` domain — a full 61-frame duplicate of CONUS, 14.8 MB, carrying
the superseded *pale-on-dark* palette — straight into the live `data` branch.

Nothing here is defective in isolation. `publish.sh` deliberately preserves
directories it does not own, because that is what lets HRRR and CAMS coexist.
`assemble_manifest.py` merges every `domain.json` it finds, because that is what
lets a workflow stay ignorant of the others. Together they mean **an abandoned
domain is never removed**, and any branch that can dispatch a render job can add
one to production.

It is currently inert: at `priority: 1` the client picks `hrrr` as primary and
`cams` as backfill, and never reaches it — `verify-domains.mjs` mirrors all
three domains and confirms the selection. But it is 14.8 MB of dead weight, it
inflates the manifest every client parses to 12.5 KB, and its frames paint the
ramp backwards for the current basemap. If it were ever selected the smoke would
be near-invisible, which is the exact failure CLAUDE.md records happening twice
already.

Unresolved. The cheap fix is deleting the directory; the durable one is for the
manifest to carry an explicit domain allow-list, so an unrecognised directory is
ignored rather than published.

## Decision 4 — the sharp domain's edge gets backfilled, not blended

At wide zoom in Missoula, the old behaviour drew HRRR's rectangle and left
everything past 50 N black — a reader looking north at the fires making their
smoke saw nothing. When the sharp domain does not fill the viewport, the next
domain down now paints the region *outside* the sharp rectangle, clipped with
an even-odd path so the two never overlap and nothing is blended. The sharp
field still wins everywhere it exists.

The seam is a visible step wherever the two models disagree. It is not
feathered. A feather would be an invented gradient between two model outputs,
and this product does not invent gradients; the badge says `3 km here, 40 km
beyond · model estimate` and its tooltip says the seam is a change of model,
not of air.

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
