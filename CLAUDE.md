# SMOKESHOW

Wildfire smoke forecast web app for one user question: how bad is the air here, and when does it clear.

## Read these first, in order
1. `docs/smokeshow-build-brief.md` — full product spec, data sources, rating scale, map mechanic, model-agreement band
2. `docs/smokeshow-share-spec.md` — share/growth features (OG previews, share cards, link handoff). These ship in v1, not later.

## Assets
- `assets/smokeshow-*.svg` — the five-state rating illustration (one lake scene, smoke eats one depth layer per level)
- `assets/gen_smokeshow_art.py` — parametric generator for those SVGs. Preferred implementation: don't swap static files — wire the per-layer opacity/haze parameters from the STATES table into one SVG in the DOM and crossfade between states, including live while scrubbing the timeline.

## Build order
1. Verify Open-Meteo Air Quality API multi-coordinate batching syntax against live docs (the grid-fetch pattern in the brief depends on it — everything hangs off this)
2. Core data layer: point forecast + grid fetch, `past_days=1`, `timezone=auto`, rating mapper (PM2.5 → five levels), `getVerdict()` (rating, clear-time with 6-hour hold rule, trend)
3. Page skeleton: geolocation flow, rating chip + clear-time, forecast text — usable before the map exists
4. Map: Leaflet + canvas smoke layer (smoke over a light basemap, not AQI colors), scrubber -12hr/+48hr, night shading, 5-day strip
   - **The ramp always runs opposite the tiles.** That is the whole rule; the direction has now flipped twice and each flip was the same mistake. The map runs CARTO Positron: `light_nolabels` → smoke canvas → `light_only_labels`, so the ramp darkens — gray → brown → near-black, intensity riding darkness. A pale ramp on light tiles converges with the basemap and makes the worst air invisible, exactly as a darkening ramp did on the dark tiles this replaced. Joe called the dark basemap back to light; the ramp followed because it has to.
   - The labels ride their own pane above the smoke, because heavy smoke composites to near-opaque and would otherwise bury the city names right when a reader needs them.
   - `SMOKE_STOPS` in `src/lib/rating.js` is hand-mirrored in `scripts/render/ramp.py` — those are the only two copies, and both renderers import the Python one. Change both, then run `npm run ramp` — it proves the composite stays monotonic across the basemap's whole tonal band and fails if the two copies drift. `npm run verify:map` then re-measures the same thing off pixels a real browser painted.
   - Fire layer: `/api/fires` (NIFC WFIGS) → hover/tap card with name, containment, size, discovery date, cause. Facts only, each carrying the date it was reported. It does **not** move with the scrubber — the smoke is a forecast, a fire report is not — and the card says so.
   - Hotspot layer (separate from the fire cards above): NASA FIRMS heat detections, clustered by
     `scripts/hrrr/fetch_fires.py` in the same 4x/day Actions job that renders the frames, published as
     `fires.json` on the `data` branch and read by `src/lib/hotspots.js`. Needs a `FIRMS_MAP_KEY` repo
     secret (free, by email from NASA) - without it the step no-ops and the layer is simply absent, which
     is a supported state. These are thermal hotspots, not confirmed fires and not named incidents: never
     label them otherwise. Global, so it is the layer that covers Canada and Europe; the NIFC cards are
     US-only. `npm run verify:fires` measures the icon off painted pixels and fails if neither ring
     clears 3:1 against whatever is actually behind it.
   - The pre-rendered field is multi-domain: NOAA HRRR-Smoke at 3 km over CONUS, Copernicus CAMS at 40 km over the rest of the populated world, published side by side on the `data` branch. `docs/global-frames.md` carries the domain table, the manifest v2 contract, the byte budget and the reasoning behind every number. The manifest is versioned: `src/lib/frames.js` degrades to the 81-point grid on a version it does not understand, and the map always names the model and resolution on screen.
   - CAMS data requires Copernicus attribution wherever it is shown; ADS credentials are a GitHub Actions secret (`ADS_API_KEY`) and never reach the client.
5. Agreement band (run-to-run inputs for v1; build the data interface so v2 multi-model plugs in)
6. Share spec: OG edge function, share card, link handoff (definition of done is in that doc)
7. Illustration integration (parametric crossfade)

## Hard rules
- Static-first; the only server-side code is the OG edge function
- No accounts, no email capture, no interstitials; verdict paints in under 3 seconds on cellular (defer the map)
- Everything labeled as forecast/model estimate; past hours are "model estimate," never "observed"
- No invented health dose-response claims; disclaimer and explainer copy in the brief ship verbatim
- Deploy target: Cloudflare Pages or Vercel (choice drives the OG function implementation)
