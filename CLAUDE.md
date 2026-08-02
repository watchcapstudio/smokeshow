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
4. Map: Leaflet + canvas smoke layer (pale smoke on a dark basemap, not AQI colors), scrubber -12hr/+48hr, night shading, 5-day strip
   - The ramp was originally specified gray→brown, which assumed a light basemap. The map now runs CARTO `dark_nolabels` → smoke canvas → `dark_only_labels`, so the ramp is inverted: cool gray → warm ivory, intensity riding brightness. A darkening ramp on dark tiles made the worst air on the map invisible. This is how smoke reads in GOES/VIIRS and NOAA's HRRR smoke products, so the "looks like smoke, not a legend" intent is intact. Joe approved the direction.
   - `SMOKE_STOPS` in `src/lib/rating.js` is hand-mirrored in `scripts/hrrr/render_frames.py`. Change both, then run `npm run ramp` — it proves the composite stays monotonic and fails if the two copies drift.
5. Agreement band (run-to-run inputs for v1; build the data interface so v2 multi-model plugs in)
6. Share spec: OG edge function, share card, link handoff (definition of done is in that doc)
7. Illustration integration (parametric crossfade)

## Hard rules
- Static-first; the only server-side code is the OG edge function
- No accounts, no email capture, no interstitials; verdict paints in under 3 seconds on cellular (defer the map)
- Everything labeled as forecast/model estimate; past hours are "model estimate," never "observed"
- No invented health dose-response claims; disclaimer and explainer copy in the brief ship verbatim
- Deploy target: Cloudflare Pages or Vercel (choice drives the OG function implementation)
