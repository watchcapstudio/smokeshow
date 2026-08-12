# SMOKESHOW — Build Brief (v3)

Single-page web app. On load, the browser asks for the user's location (with permission). The page shows: an animated smoke map covering the recent past and the next two days, an experience-based rating ("Hazy"), a model-agreement indicator, forecast text, a middle-school explainer, and a disclaimer.

## Locked decisions
- Name: **SMOKESHOW**. The worst rating level is also "Smokeshow" — the app's name is the condition you're trying to avoid.
- Location: browser geolocation with permission grant, cached; no pins, no repeated entry. Manual search only as denied-permission fallback.
- Timeline: past ~12 hours through next 48 hours as the primary scrubbable window; compact 5-day strip below for "when does it actually clear."
- Ratings describe **experience, not color codes**: what you can see, and what your body notices. Numbers (µg/m³, AQI) available small, for those who want them.
- Architecture: static first, backend upgrade later.

## Page layout, top to bottom
1. Location banner: resolved place name + "update location."
2. **Rating chip** — big, plain words from the experience scale, with one supporting line ("Haze reads plainly against the sky. Visibility around 4 miles.").
3. Animated smoke map, play/pause, **scrubber -12hr to +48hr**, "Now" marker, night hours shaded, day + time-of-day labels large ("Tue 7:00 AM").
4. **Model agreement band** under the scrubber.
5. 5-day strip: one rating word per day — "clears Thursday" legible at a glance.
6. Forecast text.
7. Explainer.
8. Disclaimer.

## Experience rating scale
Each level = a name + what you'd notice. Thresholds in PM2.5 µg/m³, aligned to EPA breakpoints so the data mapping stays standard. Visibility anchors follow the published wildfire-smoke visibility method (the "5-3-1" style index used by state health agencies) — Claude Code: calibrate the mileage numbers against a published visibility index table, don't freehand them.

| PM2.5 | Name | What you'd notice |
|---|---|---|
| < 12 | **All clear** | Sky looks normal. You can see 10+ miles. |
| 12 – 35 | **In the air** | Distant treelines look soft and the horizon loses its edge. Roughly 5–10 miles of visibility. |
| 35 – 55 | **Hazy** | Haze reads plainly against the sky. Sun looks orange at the edges. Roughly 3–5 miles of visibility. Scratchy throat after a long stretch outdoors. |
| 55 – 150 | **Heavy haze** | Roughly 1.5–3 miles of visibility, and the haze reaches indoors near windows. Eyes sting. A full day breathing this is on the order of smoking a few cigarettes. |
| 150+ | **Smokeshow** | Visibility under ~1.5 miles. Fine ash possible. Everyone inside, windows closed, run filtration if you have it. |

The middle three names were **renamed in August 2026**, from "Something's in the
air", "Smells like fire" and "Tastes like fire". The originals asserted a smell
the reader often could not find: fine particles scatter light well below the
concentration at which anyone smells anything, and long-transport smoke arrives
aged, with the odorous compounds largely stripped and the particles intact. The
names now track what the sky does, which is what the visibility anchor below was
always for. The level *keys* in the payload (`something`, `smells`, `tastes`)
were deliberately left alone; they are a wire enum read by shipped clients.

Notes for implementation:
- The visibility anchor is the trust-builder: the user can look out the window and check the model against reality. Surface it in the chip's supporting line.
- Cigarette equivalence uses the published Berkeley Earth rule of thumb (~22 µg/m³ over 24 hours ≈ one cigarette). Use it only at "Heavy haze" and above, phrased as "on the order of" — never a precise count.
- One-line truth worth showing at higher levels: "Your nose stops noticing smoke after a while. The smoke doesn't stop." (Olfactory fatigue — people under-react on day two.)
- Do NOT invent symptom dose-response ("X minutes outside = Z coughs"). No literature supports that mapping and it turns the disclaimer into a fig leaf. Visibility and the cigarette heuristic are the defensible experience anchors; smell is not, because it varies too much between people and fades out of transported smoke.

## Data sources (v1, all free, no server, no keys)
- **Browser Geolocation API** — `getCurrentPosition` on first load; cache coords + grant in localStorage.
- **Open-Meteo Air Quality API** (`/v1/air-quality`) — hourly PM2.5, `past_days=1`, 5 forecast days, `timezone=auto`. CAMS global (~40km). Batch via comma-separated coordinate lists — verify syntax against current docs first.
- **Open-Meteo Geocoding API** — fallback search + reverse geocoding.
- **NOAA HRRR-Smoke graphics** (rapidrefresh.noaa.gov/hrrr/HRRRsmoke) — link out as "high-detail NOAA view." Integrated HRRR is v2.

## The map
1. Point grid around the user — ~9x9 at ~25km spacing (~200km square).
2. Batch-fetch hourly PM2.5, past 12hr + 5 days; keep under ~100 points; debounce.
3. Render smoke **as smoke**: a translucent gray → brown → near-black ramp by concentration, not an AQI rainbow. Basemap stays readable underneath; heavy smoke literally darkens the map. (This replaces color-coded categories on the map; category words live in the chip and strips.)
4. Scrubber steps hourly; past hours slightly desaturated and labeled "model estimate."
5. Marker on the user's location showing that hour's rating word.

## Model agreement: divergence is signal
UI unchanged from v2: an hour-aligned **agreement band** under the scrubber — solid where models agree, hatched/faded where they diverge — plus a summary chip ("Models agree" / "Models split — tap for detail"). Tap opens overlaid per-model PM2.5 curves with one sentence: "When these lines separate, treat timing as uncertain by ±6–12 hours."

- v1 inputs: run-to-run comparison (cache previous CAMS pull in localStorage, compare same valid hours) + lead-time fade past +36hr.
- v2 inputs: HRRR-Smoke vs CAMS vs FireSmoke.ca BlueSky (per-run NetCDF downloadable; derivative services welcomed). Band UI unchanged; build the data interface now.
- Standing caveat, always visible small: "All smoke models depend on satellites seeing the fires. Clouds or thick smoke can hide fires, and hidden fires aren't in any forecast."

## Forecast text (rule-based, no LLM)
- Arrival/clearing at the "Hazy" threshold (35 µg/m³); peak level + timing; cleanest stretch in 5 days.
- Written in the rating language: "Back to Hazy by Tuesday afternoon, peaks Wednesday morning at Heavy haze, drops to In the air Thursday evening. Cleanest stretch: Friday."
- Honesty rule: trust timing and geography over exact numbers; models underestimate surface PM2.5 in extreme events.

## Stack
- React or vanilla JS, Leaflet + OSM tiles, canvas smoke layer
- Static deploy: GitHub Pages / Cloudflare Pages / Vercel
- localStorage: location grant + coords, previous-run cache

## v2 upgrade path (do not build yet)
- Backend cron: Python + Herbie pulls HRRR-Smoke near-surface MASSDEN GRIB2 from NOAA's AWS archive, renders frames/tiles → sharp 3km layer for -12hr/+48hr.
- Multi-model feed into the agreement band.

## Watch-outs
- Geolocation requires HTTPS (localhost exempt in dev). "Permission denied" → search box, never a dead end.
- Past data is model reanalysis, not monitor readings — label "model estimate."
- `timezone=auto` everywhere; local time with AM/PM on the scrubber.
- Everything is a forecast/estimate. Label accordingly.

---

## Disclaimer copy (drop in as-is)

**SMOKESHOW is for informational and educational purposes only.** It is not health, medical, or safety advice. Forecasts are model estimates and can be wrong — sometimes by a lot. Descriptions of what you might smell, see, or feel are generalizations, not predictions about your body. For decisions about your health, outdoor activity, or air quality safety, rely on official sources like AirNow.gov, the National Weather Service, and your local health authorities, and talk to a medical professional about your own situation.

---

## Explainer copy (drop in as-is, edit freely)

### Why is smoke so hard to forecast?

Forecasting smoke is like forecasting weather — with three extra problems stacked on top.

**First, you have to find the fires.** Satellites spot fires by detecting heat from space. But clouds can hide a fire from the satellite. So can thick smoke from another fire. A fire the satellite can't see is a fire the forecast doesn't know about.

**Second, you have to guess the smoke.** Nobody can measure exactly how much smoke a fire makes. Scientists estimate it from how hot the fire looks from space and what's burning underneath. Grass, pine forest, and swampy peat all burn differently and make different amounts of smoke.

**Third, you ride the wind.** Smoke goes wherever the wind carries it — sometimes more than a thousand miles. If the wind forecast is off by even a little, the smoke ends up somewhere else. And height matters: smoke riding high in the sky might pass right over your town while the air at the ground stays clean. It's the low smoke you actually breathe.

Each step adds a little error, and the errors multiply. That's why smoke forecasts are pretty sharp for the next day or two and get fuzzy after that — and why this page tells you when the models agree and when they don't.
