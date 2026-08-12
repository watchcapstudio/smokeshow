# `/api/forecast` — contract v1

One server-computed verdict that the web, iOS, macOS, and Android clients all
render identically. **Clients render; they do not compute.**

Everything in `src/lib/{rating,verdict,days,trend,sky,sensors,aqi,agreement}.js`
runs once, on the edge, and ships as JSON. If Swift and Kotlin reimplement that
maths they will drift, and the first thing to drift is "when does it clear" —
the product's only promise (`docs/smokeshow-platform-plan.md` §2).

- Machine-readable schema: [`design/forecast-api-v1.schema.json`](../design/forecast-api-v1.schema.json)
  (JSON Schema draft 2020-12).
- Conformance is enforced by `src/lib/forecast.test.js`, which validates a real
  payload against that schema on every `npm test`.

---

## 1. Request

```
GET /api/forecast?lat=<number>&lon=<number>[&source=official|local|model]
```

| Param | Required | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `lat` | yes | number, −90…90 | — | Finite. Rejected otherwise. |
| `lon` | yes | number, −180…180 | — | Finite. Rejected otherwise. |
| `source` | no | `official` \| `local` \| `model` | `official` | Which measured row anchors the delivered series (§5). Unknown values are treated as `official`. |

No headers are required. No authentication. CORS is open
(`access-control-allow-origin: *`) so native clients and the web share one
endpoint.

**Coordinates are snapped server-side** to the 0.1° lattice from
`src/lib/grid.js` (≈11 km, well inside CAMS's ~40 km resolution) before any
upstream call. Nearby users therefore produce byte-identical upstream URLs and
share the CDN cache. Clients should send their real coordinates and read
`location.snapped` back — do not pre-snap, or a future lattice change forks.

### Caching

| Layer | Directive | Why |
| --- | --- | --- |
| This endpoint | `public, s-maxage=600, stale-while-revalidate=1800` | `now.index` advances hourly; 10 minutes bounds its staleness to well under one hour bucket. |
| Upstream (`/api/aq`) | `public, s-maxage=1800, stale-while-revalidate=3600` | Already in place. The forecast function fetches Open-Meteo **through `/api/aq`**, never directly, so a viral smoke event costs one upstream fetch per cell per half hour regardless of traffic. |

Clients should not poll faster than every 10 minutes; there is nothing new to
see. Widget timelines should fetch **once** and schedule locally off `hours[]`
(that is the whole reason the endpoint returns a timeline rather than a point).

---

## 2. Response envelope

`200 application/json`

```jsonc
{
  "v": 1,
  "generatedAt": "2026-08-02T17:03:11Z",
  "location": { … },
  "now":      { … },
  "window":   { … },
  "source":   { … },
  "scale":    [ … ],   // 5 entries, the rating ladder
  "hours":    [ … ],   // the timeline
  "verdict":  { … },
  "days":     [ … ],
  "pastDays": [ … ],
  "measured": { … },
  "agreement":{ … }
}
```

`v` is `1` and only `1`. **A client that reads a `v` it does not recognise must
treat the response as unavailable and fall back**, not attempt a partial parse.
Breaking changes bump `v` and are served alongside the old version, never in
place of it. Additive, non-breaking changes (new optional fields) ship without a
version bump — so decoders must ignore unknown fields rather than fail on them.

All timestamps are UTC ISO-8601 with a literal `Z` and second precision
(`2026-08-02T17:00:00Z`). There are no local-time strings in the payload except
the pre-formatted human labels in `verdict` (§6), which exist precisely so all
four clients print the same sentence.

### `location`

```jsonc
"location": {
  "requested": { "lat": 44.9778, "lon": -93.2650 },  // echoed, as sent
  "snapped":   { "lat": 45.0,    "lon": -93.3    },  // what was actually fetched
  "timezone": "America/Chicago",                     // IANA, from Open-Meteo
  "utcOffsetSeconds": -18000                         // offset in effect at `now`
}
```

`timezone` is never null (Open-Meteo resolves one for every land coordinate;
`UTC` is the degenerate fallback). `utcOffsetSeconds` is the offset **at the
moment of `now`** — it does not describe hours on the other side of a DST
transition. Clients that need wall-clock labels for arbitrary hours should use
`timezone` with their platform's zone database, not add `utcOffsetSeconds`.
Every derived label in this payload (`verdict.*Label`, `days[].key`,
`days[].weekday`) was already computed in `timezone`, so most clients never need
either field.

### `now`

```jsonc
"now": {
  "index": 61,                        // index into hours[]
  "timeUTC": "2026-08-02T17:00:00Z",  // === hours[61].t
  "exactUTC": "2026-08-02T17:03:11Z"  // the instant the server used
}
```

`index` is the hour bucket nearest `exactUTC`, so it is accurate to ±30 minutes
by construction and can be one further bucket stale from the 10-minute cache. A
client that needs a tighter `now` may recompute it from `hours[].t` against its
own clock — but **must not** recompute the verdict from it. The verdict is
whatever the server said.

`index` is always a valid index into `hours` in a `200`.

### `window`

```jsonc
"window": { "pastHours": 72, "forecastHours": 120 }
```

Requested `past_days=3` / `forecast_days=5`, i.e. `hours.length` is typically
192. **Do not hardcode 192.** Open-Meteo trims the tail of the run, and the
window may widen in a future additive change. Index everything off
`hours.length` and `now.index`.

Past hours are **model estimate, never observed** (`CLAUDE.md` hard rule). The
one measured claim in the payload is `measured.official` / `measured.local` at
`now`, and both carry their own provenance. UI labelling of past hours is the
client's job and the required word is "model estimate".

### `source`

```jsonc
"source": {
  "requested": "official",   // what the query asked for
  "applied":   "official",   // what was actually used — may differ
  "model": "cams-global"     // the forecast model behind pm25Model
}
```

`applied` degrades `official → local → model` when the requested row is absent.
When `applied` is `"model"`, `measured.anchor.offsetUg` is `0` and `pm25` equals
`pm25Model` for every hour.

---

## 3. `scale` — the rating ladder

Five entries, index `0…4`, in ascending severity. Shipped in every response so
that no client hardcodes health copy: `CLAUDE.md` requires the disclaimer and
explainer copy to ship verbatim, and copy pasted into a Swift file is copy that
drifts.

```jsonc
{
  "index": 2,
  "key": "smells",
  "name": "Hazy",
  "rangeUg": "35 – 55",
  "maxUg": 55,                      // null on the top entry (unbounded)
  "visibility": "3–5 miles",
  "notice": "Most people smell smoke outdoors, though not everyone. …",
  "notLine": "Still well short of one cigarette over a full day outside. …",
  "guidance": {
    "general":   "sensitive groups should cut back on long or heavy exertion. …",
    "sensitive": "cut back on long or heavy exertion. Move the workout indoors …"
  }
}
```

`guidance.sensitive` is the sensitive-household variant (asthma, young kids,
older adults, pregnancy, heart or lung conditions) — one level stricter than
`guidance.general`. Which one a client shows is a local user preference; both
always ship.

No field in `scale` is ever null except `maxUg` on index 4. The array is always
exactly 5 entries. `key` values are stable identifiers and safe to switch on;
`name` and all prose are display copy and may be re-worded without a version
bump.

---

## 4. `hours` — the timeline

An array in ascending time order, one entry per hour, no gaps in `t`.

```jsonc
{
  "t": "2026-08-02T17:00:00Z",
  "pm25": 41.2,          // delivered series: model + measured anchor (§5)
  "pm25Model": 38.0,     // raw model, un-anchored
  "aqi": 115,            // US AQI of pm25 (EPA 2024 breakpoints)
  "levelIndex": 2,       // index into scale[]
  "trend": "falling",    // 6h-lookahead slope, verdict-guarded
  "agreement": "agree",
  "sky": { … }
}
```

| Field | Type | Null when |
| --- | --- | --- |
| `t` | string | never |
| `pm25` | number \| null | the upstream model has a gap at this hour |
| `pm25Model` | number \| null | same gap |
| `aqi` | integer \| null | `pm25` is null |
| `levelIndex` | 0…4 \| null | `pm25` is null |
| `trend` | `rising` \| `falling` \| `steady` \| null | `pm25` is null |
| `agreement` | `agree` \| `fade` \| `diverge` | never |
| `sky` | object \| null | never null in v1 — reserved so a future `?sky=off` slimming can omit it without a version bump |

**Gaps are real.** Open-Meteo returns `null` for hours it has no value for, and
the series is not truncated at the first one. Every consumer must handle a null
mid-array: a widget renders that hour as unknown, it does not render zero. Zero
µg/m³ is a *claim about clean air* and would be a lie.

`trend` is `src/lib/trend.js`: a 6-hour lookahead slope with a ±4 µg/m³
deadband, suppressed below 12 µg/m³, and then muted to `steady` wherever it
would contradict `verdict.trend`. A client that renders both a trend chip and
the headline will therefore never show "Improving" beside "No clear air in the
5-day window". Do not recompute this — the guard is the point.

`agreement` is `src/lib/agreement.js` and in v1 carries **lead-time fade only**:
`fade` past +36 h, `agree` otherwise. `diverge` is defined and reserved for the
multi-model comparison; the server does not emit it in v1 (see §9).

### `hours[].sky`

Everything needed to paint the sky for that hour at that location, from
`src/lib/sky.js` (NOAA/Meeus solar position, ~0.01° accuracy).

```jsonc
"sky": {
  "zenith":  [139, 169, 196],   // [r, g, b], each 0–255
  "mid":     [176, 190, 199],
  "horizon": [226, 222, 206],
  "isDark": false,              // paint foreground ink light when true
  "starOpacity": 0.0,           // 0–1
  "smoke": { "s1": 0.27, "s2": 0 },
  "sun": {
    "altitudeDeg": 42.1,        // negative below the horizon
    "azimuthDeg": 210.4,        // clockwise from north
    "visible": true,            // altitude > 1.1°
    "xFrac": 0.66,              // screen placement, 0 = left/east … 1 = right/west
    "yFrac": 0.29,              // 0 = top … 1 = bottom
    "dim": 0.27                 // 0 clear → 1 smoke-dimmed
  }
}
```

Colours are integer RGB triples, not CSS strings — every platform can build its
own colour type without parsing. `isDark` is the `.dark-air` ink inversion
(perceptual luminance of `mid` below 0.42); it is the server's answer to "light
or dark foreground", and clients should not re-derive it from the colours.

No field inside `sky` is ever null when `sky` itself is present. When `pm25` is
null the sky is computed at 0 µg/m³ — an hour with no data still has a sun.

---

## 5. `measured` — official, local, model. Never averaged

Three separate answers, deliberately kept apart. During fast-moving smoke a
regulatory monitor 38 miles away and a cluster of consumer sensors 8 miles away
legitimately disagree; blending them yields a number neither source said.

```jsonc
"measured": {
  "official": {              // nearest AirNow regulatory monitor
    "ug": 44.4, "aqi": 122, "count": 6,
    "area": "Minneapolis", "distanceMi": 38,
    "observedAt": "2026-08-02T16:00"
  },
  "local": {                 // median of EPA-corrected PurpleAir units
    "ug": 51.0, "aqi": 139, "count": 27, "medianDistanceMi": 8
  },
  "model": { "ug": 38.0, "aqi": 106 },   // pm25Model at now.index
  "anchor": { "source": "official", "offsetUg": 6.4, "decayHours": 12 }
}
```

| Field | Null when |
| --- | --- |
| `measured.official` | no AirNow key configured, no monitor within 50 mi, or the upstream failed |
| `measured.local` | no PurpleAir key configured, no sensor in the ~30 mi box, or the upstream failed |
| `measured.model` | `pm25Model[now.index]` is null — then `.ug` and `.aqi` are both null, but the object itself is present |
| `official.area`, `official.distanceMi`, `official.observedAt` | the monitor did not report them; `ug`, `aqi`, `count` are never null inside a present row |
| `local.medianDistanceMi` | no sensor reported a position |
| `measured.anchor` | never — `source` is `"model"` and `offsetUg` is `0` when nothing measured was available |

`observedAt` is the monitor's own local wall-clock stamp with **no zone and no
`Z`** (`YYYY-MM-DDTHH:00`) — that is how AirNow reports it and inventing a zone
would be worse than passing it through. It is display-only; do not parse it into
an instant.

### The anchor

`measured.anchor` describes what was done to the model series to produce
`hours[].pm25`, per `applySensorAnchor()` in `src/lib/sensors.js`:

> Shift the model by the measured-vs-model gap at `now`, decaying the correction
> linearly to zero over the next `decayHours` (12) hours. Hours before `now` are
> untouched — they are labelled model estimate, and a single-point offset does
> not generalise backwards or spatially.

`offsetUg` is `measured[anchor.source].ug − pm25Model[now.index]`, signed.

**The verdict is computed on the anchored series**, so `?source=` changes the
answer. That is intended: a user who trusts their neighbourhood's PurpleAir
cluster should get a clear-time consistent with it. It is also why `source` is a
query parameter and not a client-side post-process — the alternative is four
clients each re-deriving a verdict, which is the exact failure this endpoint
exists to prevent. Clients that offer the toggle refetch on change; the URL is
snapped and CDN-cached, so the round trip is cheap.

---

## 6. `verdict` — the answer

The full `computeVerdict()` result plus its rendered strings.

```jsonc
"verdict": {
  "above": true,              // pm25 at now is >= 35 µg/m³ ("Hazy")
  "levelIndex": 2,
  "trend": "clearing",        // clearing | stuck | worsening | steady
  "headline": "Clears Thursday ~6 PM",

  "clearIndex": 74,
  "clearAtUTC": "2026-08-04T23:00:00Z",
  "clearLabel": "Thursday ~6 PM",

  "arrivalIndex": null,
  "arrivalAtUTC": null,
  "arrivalLabel": null,

  "peakIndex": 66,
  "peakAtUTC": "2026-08-03T22:00:00Z",
  "peakPm25": 88.4
}
```

| Field | Type | Null when |
| --- | --- | --- |
| `above` | boolean | never |
| `levelIndex` | 0…4 | never (0 when `pm25` at `now` is null) |
| `trend` | enum | never |
| `headline` | string | never |
| `clearIndex` / `clearAtUTC` / `clearLabel` | integer / string / string | **`above` is false, or no sustained clear exists in the window.** All three are null together. |
| `arrivalIndex` / `arrivalAtUTC` / `arrivalLabel` | integer / string / string | **`above` is true, or no sustained arrival exists.** All three are null together. |
| `peakIndex` / `peakAtUTC` | integer / string | never — worst case the peak is `now` itself |
| `peakPm25` | number \| null | `pm25[peakIndex]` is null (a fully-null forward window) |

`clearIndex` and `arrivalIndex` are mutually exclusive: at most one is non-null,
and both are null when the air simply never crosses the line.

### The hold rules, and why you must not reimplement them

`clearIndex` is the first hour at which PM2.5 drops below 35 µg/m³ **and stays
there for 6 consecutive hours**. `arrivalIndex` is the first hour at or above
35 µg/m³ that **holds for 3**. The asymmetry is deliberate: a brief spike still
matters more than a brief dip, and "Clears Thursday ~6 PM" must survive a
one-hour head-fake in the model.

This is the single most drift-prone piece of logic in the product. It is tested
in `src/lib/verdict.test.js`, it runs once here, and every client renders
`clearLabel` verbatim. A native app that recomputes a clear-time from `hours[]`
is a bug even when it agrees.

### Labels

`clearLabel` / `arrivalLabel` are `"Thursday ~6 PM"` — weekday, then a literal
tilde, then the hour, formatted in `location.timezone`. **The tilde is required**
(share spec): the forecast is an estimate and the label must say so. `headline`
is one of exactly five sentences:

| Condition | `headline` |
| --- | --- |
| `above`, clear found | `Clears {clearLabel}` |
| `above`, no clear | `No clear air in the 5-day window` |
| not `above`, arrival found | `Smoke arrives {arrivalLabel}` |
| not `above`, level 0 | `Stays clear for the next 5 days` |
| not `above`, level 1+ | `Doesn't reach Smells-like-fire in 5 days` |

Render `headline` as-is. It is the sentence the product promises, and it is the
one string guaranteed identical on a user's phone and their laptop.

---

## 7. `days` and `pastDays`

`days` — up to 5 forward day summaries starting with today, computed in
`location.timezone`.

```jsonc
{
  "key": "2026-08-02",       // local calendar date, YYYY-MM-DD
  "weekday": "Sat",          // en-US short weekday
  "levelIndex": 2,           // level of the day's WORST hour
  "minPm25": 8.1,
  "maxPm25": 61.0,
  "dayParts": [
    { "key": "morning",   "label": "Morning",   "bucket": { "name": "Middle",   "color": "#f0c98c" } },
    { "key": "afternoon", "label": "Afternoon", "bucket": { "name": "Elevated", "color": "#ec9f5e" } },
    { "key": "evening",   "label": "Evening",   "bucket": { "name": "Clear",    "color": "#f1ece3" } }
  ]
}
```

- `days[0]` is **today from `now` forward** — its `maxPm25` is the worst
  remaining hour, not the worst hour of the whole calendar day. Hours already
  past are excluded on purpose: the strip answers "what is left of today".
- `dayParts` is always exactly 3 entries in `morning` (06–12), `afternoon`
  (12–18), `evening` (18–24) order. `bucket` is null when no hour of the day
  fell in that part — the common case being today's already-elapsed parts.
  Buckets are the coarse 4-step strip scale (`Clear` / `Middle` / `Elevated` /
  `Smokeshow`), **not** the 5-level rating scale; do not cross-index them.
- `levelIndex`, `minPm25`, `maxPm25` are null when every hour of that day is
  null.
- `days` may be shorter than 5 near the end of the model run. It is never empty
  in a `200`.

`pastDays` — up to 3 complete local days *before* today, oldest first, same
fields minus `dayParts`. Model estimate, not observation; a client that shows
these must say so. `pastDays` may be empty.

---

## 8. `agreement`

```jsonc
"agreement": {
  "multiModel": false,
  "diverged": false,
  "label": "Single-model forecast. Confidence fades past 36 hours."
}
```

Summary of the per-hour `hours[].agreement` values. In v1 `multiModel` is always
`false` and `diverged` always `false`: the endpoint compares one model against
lead time, not against a second model. `label` is display copy and is the string
to render.

The HRRR-Smoke comparison that produces `diverge` is a client-side feed today
(`src/lib/hrrr.js`, CONUS only). The web app continues to compute its own
agreement band from it and may show a richer answer than this field. Native
clients render this field and get the honest structural note. When HRRR moves
server-side, `multiModel` and `diverge` start appearing here with no shape
change — which is why they are in the contract now.

---

## 9. Errors, and how clients degrade

Every non-200 carries the same envelope so a decoder never sees two shapes:

```jsonc
{ "v": 1, "error": { "code": "bad-coords", "message": "lat and lon must be finite numbers" } }
```

| Status | `code` | Cause |
| --- | --- | --- |
| `400` | `bad-coords` | `lat`/`lon` missing, non-finite, or out of range |
| `502` | `upstream-failed` | Open-Meteo unreachable or returned an error through `/api/aq` |
| `502` | `no-series` | Upstream responded but returned no usable hourly series |
| `500` | `internal` | Anything else |

Error responses are `cache-control: no-store`.

**The rule for every client: degrade, do not crash.**

1. `v !== 1`, an `error` object, a non-200, a non-JSON body, or a timeout →
   treat the forecast as unavailable.
2. The web app then falls back to its existing client-side path (fetch
   Open-Meteo through `/api/aq`, compute locally with the same `src/lib/*`
   modules). A bad deploy of this endpoint degrades the web to yesterday's
   behaviour; it does not break it.
3. Native clients show the last successfully cached payload with its
   `generatedAt` visible, or an explicit "forecast unavailable" state. A widget
   must never render a stale number as if it were current, and must never render
   `0 µg/m³` for missing data.
4. Any single field being null is **not** an error. Nulls are documented above
   and are the normal state of a real forecast — a missing sensor row, a gap in
   the model, a day with no evening left. Decode with optionals throughout.
5. Unknown fields are ignored, not rejected. Additive changes ship without a
   version bump.

---

## 10. Mocking this contract (B7 / B8 / B9)

`design/forecast-api-v1.schema.json` is the source of truth for shape. A mock
that validates against it is a valid `/api/forecast` as far as this contract is
concerned.

Cases every client should be built against before the real endpoint exists:

| Case | How to build it |
| --- | --- |
| Clear, staying clear | `verdict.above=false`, all indices null, `headline: "Stays clear for the next 5 days"` |
| Smoke now, clears Thursday | `above=true`, `clearIndex` set, `arrivalIndex` null |
| Smoke now, never clears | `above=true`, all clear fields null, `headline: "No clear air in the 5-day window"` |
| Clean now, smoke arriving | `above=false`, `arrivalIndex` set |
| No sensors anywhere | `measured.official` and `measured.local` both null, `anchor.source: "model"`, `offsetUg: 0` |
| Official and local far apart | both rows present, `local.ug` ≈ 2× `official.ug` — the case the explainer copy exists to justify |
| Model gaps | a run of `hours[].pm25 = null` mid-array; assert nothing renders `0` |
| Endpoint down | `502` + error envelope; assert the fallback path |
| Short window | `hours.length` well under 192, `days.length` of 3 |

Deriving these from the schema keeps the mock honest. Deriving them by hand from
this prose does not.
