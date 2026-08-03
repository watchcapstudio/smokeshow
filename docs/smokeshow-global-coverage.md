# B11 — Global smoke coverage: the byte budget, decided

The pre-rendered smoke field is CONUS-only. `render_frames.py` clips to
24–50°N, −125 to −66.5°W, and outside that box the map falls back to an
81-point grid — nine samples across — with nothing telling the user they have
left the good coverage.

The box cuts in the worst possible place. Toronto, Montreal, Vancouver and
Winnipeg fall just inside; **Calgary, Edmonton and the NWT fall outside — so
the northern-Alberta and BC-interior fires that drive most North American
smoke events are off the map while their smoke is on it.** Europe has never had
coverage at all.

The brief names one thing as the risk: *file size*. 61 frames of a global field
is a lot of PNG on a branch served through raw.githubusercontent. This document
is that decision, measured rather than estimated.

---

## 1. What is shipping today

Fetched from the live `data` branch:

| | |
| --- | --- |
| Frame | 1200 × 680, RGBA PNG |
| Bytes | **413 KB** |
| Frames | 61 |
| Total | ~25 MB |
| Coverage | CONUS only |

413 KB per frame is the budget the product already accepts. Every number below
is measured against it.

## 2. The finding: the wash is one-dimensional

The smoke image is a strict function of one variable. Colour comes from
`SMOKE_STOPS` by PM2.5 and nothing else — the ash-grain stipple is applied
**client-side in screen space** (`SmokeCanvasLayer`), precisely so that texture
is not baked into an image that gets upscaled 10–20×.

So the frame needs a palette sampled along the ramp, not a general-purpose
RGBA encoder. Measured on the **live production frame**, re-encoded three ways:

| Encoding | Bytes | vs today | Max channel error where visible |
| --- | --- | --- | --- |
| RGBA (today) | 413 KB | — | 0 |
| Adaptive quantisation, 256 colours | 58 KB | 14% | **23/255 — visible banding** |
| Fixed ramp palette, 256 entries | 165 KB | 40% | 1/255 |
| **Fixed ramp palette, 64 entries** | **92 KB** | **22%** | **2/255** |
| Fixed ramp palette, 32 entries | 65 KB | 16% | 4/255 |

Adaptive quantisation is the trap. It is the smallest, and it is wrong: it does
not know the image is one-dimensional, so it spends entries on colours the ramp
never produces and lands at 23/255 — banding, on a ramp deliberately built to
be shallow.

A fixed palette sampled along the ramp is near-exact for a fraction more bytes.
**64 entries at 2/255 is the pick**: 2/255 is under 1% of a channel, on a wash
that is at most 92% opaque over a dark basemap.

Two details that matter:

- **Entries are spaced uniformly in alpha, not in PM2.5.** Alpha is what the
  eye reads on a dark basemap, and the ramp is deliberately non-linear in PM2.5
  — most of its travel is spent under 55 µg/m³, where most days live.
- **Values under 2 µg/m³ snap to fully transparent.** Below that the wash is
  under 5% opaque — invisible, but expensive, because a faint noisy background
  occupies many distinct indices and destroys the compressor's run lengths.
  This is also the more honest rendering: "no smoke to notice" runs to
  12 µg/m³. The floor cannot go past 2 — at 3 µg/m³ the error jumps to 15/255
  because genuinely visible values start getting flattened.

## 3. The domain decision: one world image

The instinct is regional domains, and the measurement says don't bother.

CAMS global runs at **0.4°** (~44 km). At native resolution the entire world
between 60°S and 75°N is only ~900 px wide. There is no high-resolution global
field to be economical about — the field is coarse, and the only question is
how much to supersample it for smooth upscaling on the client.

Measured, synthetic worst case (twelve continental plumes plus a noisy haze
background — busier than a real day):

| Domain | Image | Bytes/frame | 61 frames |
| --- | --- | --- | --- |
| World, −180…180 / −60…75 | 900 × 479 | 96 KB | 5.7 MB |
| **World, −180…180 / −60…75** | **1800 × 958** | **147 KB** | **8.8 MB** |
| World, −180…180 / −60…75 | 2400 × 1278 | 208 KB | 12.4 MB |
| North America only | 1200 × 914 | 24 KB | 1.4 MB |
| Europe only | 1200 × 1210 | 19 KB | 1.2 MB |

**Decision: one world frame at 1800 × 958.**

- 1800 px across 360° is 0.2°/px — exactly 2× the CAMS grid, so it supersamples
  for smooth upscaling without inventing detail the model does not have.
- **147 KB per frame is a third of the 413 KB the product already ships.**
- Regional domains would save ~7 MB of branch storage and cost a domain-
  selection bug surface, a second manifest shape, and seams at every boundary.
  Not worth it at this price.
- Latitudes beyond 75°N / 60°S are dropped. Mercator stretches them absurdly
  and essentially nobody lives there; including them would roughly double the
  image height to serve a rounding error of users.

### What the whole data branch costs afterwards

| | Today | After B11 |
| --- | --- | --- |
| HRRR CONUS | 61 × 413 KB = 25 MB | 61 × 92 KB = 5.5 MB |
| CAMS global | — | 61 × 147 KB = 9 MB |
| **Total** | **25 MB** | **14.5 MB** |

The branch gets **smaller while gaining the entire planet**, because re-encoding
HRRR with the same palette pays for the global set twice over.

### Cellular

The client loads two frames per hour shown — current and next — not all 61. At
147 KB that is roughly a second on a slow connection, against 413 KB today. The
verdict-in-under-3-seconds rule is untouched either way (the map is deferred),
and the map itself gets faster, not slower.

## 4. What this does not decide

- **CAMS PM2.5 is total particulate, not smoke specifically**, where HRRR's
  MASSDEN is smoke. Over northern India or eastern China the global field will
  show heavy "smoke" that is industrial haze. This is not a new problem — the
  existing 81-point fallback already draws Open-Meteo CAMS PM2.5 everywhere
  outside CONUS, so the frames are consistent with what the product already
  does. It is worth deciding deliberately rather than inheriting, and it is the
  strongest argument for labelling the active domain in the UI.
- **HRRR keeps winning inside CONUS.** `SmokeMap.jsx` already prefers a sharp
  frame when one exists and falls back when it does not; this is additive and
  that preference logic is not being rewritten.

---

## 5. Status

**Done**

- `scripts/smokefield/ramp.py` — one shared Python copy of the ramp, the
  Mercator target grid, and the paletted frame encoder. Still exactly two
  copies of the ramp in the repo, no matter how many domains render.
- `npm run ramp` re-pointed at the shared module and passing.
- `scripts/hrrr/render_frames.py` refactored onto it — CONUS frames drop
  413 KB → 92 KB with no visible change.
- `scripts/cams/render_global.py` — the global renderer. CAMS is a regular
  lat/lon grid, so the resampler is bilinear index math with no projection
  library.
- `scripts/cams/selftest.py` — proves the geometry offline, which matters
  because the render job needs ECMWF and so cannot run in CI on every commit.
  Edmonton, Missoula, Madrid, Sydney and Anchorage each land within a pixel of
  where the Mercator math says; no antimeridian bleed; north is up; either
  latitude ordering resamples identically.
- `src/lib/smokeFrames.js` (replacing `lib/hrrr.js`) — manifest v2, two
  domains fetched independently, unknown versions dropped, degradation to the
  point grid. 23 tests.
- Coverage disclosure under the map, and Copernicus/CAMS attribution beside
  the CARTO and OSM credits.
- Both render jobs publish into their own subdirectory of the `data` branch
  under a shared concurrency group.

### A bug found on the way

`hrrrMode` was decided by **time alone** (`SmokeMap.jsx:165`), never by
location. Outside CONUS the app therefore did *not* fall back to the 81-point
grid as this brief assumed — it pinned the CONUS image overlay onto a map that
does not contain the reader and drew **no smoke over them at all**. An Edmonton
reader saw an empty map with the plume off to the south, which is worse than
the coarse fallback it was believed to be getting. Selection is now by hour and
by place, which fixes it independently of the new domain.

## 6. Remaining

- **One repo secret: `ADS_API_KEY`.** Free registration at
  <https://ads.atmosphere.copernicus.eu/>, then accept the licence for
  `cams-global-atmospheric-composition-forecasts`. The workflow fails with that
  instruction if the secret is missing rather than failing obscurely.
- **First real render.** `cams-global` is `workflow_dispatch`-able; the first
  run publishes `data/cams/` and the map picks it up with no client change.
- **The three captures** (Missoula, Edmonton, Madrid). These need the CARTO
  basemap, which the build sandbox blocks; running the existing Puppeteer
  capture in Actions, where the network is open, produces them from the same
  code.
- **Byte budget confirmation against a real field.** The 147 KB/frame figure is
  measured on a deliberately pessimistic synthetic field; the first real run
  should come in at or under it, and the job prints the total.
