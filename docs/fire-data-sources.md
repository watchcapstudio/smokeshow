# Fire data: what's available, what's true, and how to wire it up

*Written 2026-08-02. Every number below was measured against the live services on
that date, not quoted from documentation. Re-measure before trusting them.*

This document answers one question: **can we put fires on the map and let someone
hover one to see what it is and how contained it is?**

Short answer: yes in the United States, partly in Canada, no in most of the world.
The reason is not technical. Containment percentage is a US fire-management
reporting convention, and most countries do not produce the number at all.

---

## 1. The two datasets, and why they must stay separate

There are two completely different kinds of fire data. Conflating them is the
single biggest trap here.

| | **Satellite hotspots** | **Named incidents** |
| --- | --- | --- |
| What it is | Thermal anomalies detected from orbit | Human incident reports filed by fire crews |
| Source | NASA FIRMS | NIFC WFIGS (US), provincial agencies (Canada) |
| Coverage | Global | US, and Canada in a different shape |
| Latency | ~3 hours | Once or twice per day |
| Has a name? | No | Yes |
| Has containment %? | No | Yes (US only) |
| Has a perimeter? | No | Yes (US) |
| Unit of data | One pixel of heat | One fire |

**A hotspot is not a fire.** One large fire produces dozens or hundreds of
detections. A hotspot can also be a gas flare, a steel mill, a volcano, or a
burning landfill.

**These two datasets do not join.** There is no key linking a FIRMS detection to
a WFIGS incident. You could guess by proximity, and you would be wrong often
enough to matter: two fires burning twenty miles apart, one named and one not,
will happily swap labels. Smokeshow's "no invented claims" rule (`CLAUDE.md`,
Hard rules) forbids that guess.

**Therefore: two layers, not one.**

- Named incidents render from WFIGS, using their own reported coordinates. Hover
  gives name, acres, containment, cause, days burning. Fully attributable.
- Hotspots render from FIRMS as unnamed heat texture. Hover gives
  "satellite heat detection, 2h ago." Nothing more, because nothing more is known.

This is also less work than trying to fuse them.

---

## 2. NIFC WFIGS, the US source

This is the real one. It is the same data the interagency fire community uses,
fed from IRWIN, the system incident commanders report into.

**Service root:**

```
https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/
```

Two layers matter:

| Layer | Geometry | Records (2026-08-02) |
| --- | --- | --- |
| `WFIGS_Incident_Locations_Current/FeatureServer/0` | point | 531 total, 252 wildfire ≥100 acres |
| `WFIGS_Interagency_Perimeters_Current/FeatureServer/0` | polygon | 221 |

Standard ArcGIS REST query. No API key, no signup, no registration.

```bash
curl -G "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query" \
  --data-urlencode "where=IncidentTypeCategory IN ('WF','CX') AND IncidentSize >= 100" \
  --data-urlencode "outFields=IncidentName,PercentContained,IncidentSize,FireCause,FireDiscoveryDateTime,ModifiedOnDateTime_dt,POOState,IrwinID" \
  --data-urlencode "f=geojson"
```

### Fields worth pulling

The incident layer has 97 fields. These are the ones that earn their place:

| Field | Notes |
| --- | --- |
| `IncidentName` | Casing is inconsistent. `Kaiser Canyon` and `ROWE CREEK COMPLEX` and `0445 CROSSWHITE` all appear. Normalize for display. |
| `PercentContained` | Integer 0–100, nullable. See §4. |
| `IncidentSize` | Acres. The current best estimate. |
| `IncidentTypeCategory` | `WF` wildfire, `CX` complex, `RX` **prescribed burn**. Filter `RX` out or you will label a planned burn as a wildfire. |
| `FireCause` | Human / Natural / Unknown / Undetermined |
| `FireDiscoveryDateTime` | Epoch ms. Gives "burning for 11 days". |
| `ModifiedOnDateTime_dt` | Epoch ms. **Render this.** It is how the user knows the number's age. |
| `POOState` | `US-OR` form. |
| `IrwinID` | Stable join key to the perimeter layer. |
| `CpxName` | Parent complex, when a fire has been rolled into one. |

### Payload size

A trimmed pull of 252 incidents with six fields and no geometry is **47 KB raw,
7.5 KB gzipped**. With geometry, budget roughly double. This is small enough to
bake into a static file without thinking about it.

---

## 3. The rate limit (read this before designing anything)

The service is free but it is **a shared, saturated public resource with a hard
per-minute cap.**

Observed on 2026-08-02 while writing this doc:

```
{"error":{"code":429,"message":"Unable to perform query. Too many requests.",
"details":["API calls quota exceeded (90728 request units)! maximum allowed
request units (57600) per Minute. Retry after 60 sec."]}}
```

The cap is 57,600 request units per minute **across all consumers of the
service**, and it was sitting at 90,728. That was not us. A handful of curl calls
cannot produce that; the wider internet was hammering it. Fire season is exactly
when this service is most loaded and exactly when we need it.

Three consequences, and they are not negotiable:

1. **Never call this from the client.** A viral smoke event points a crowd at a
   service that is already over quota. It will 429, and every user sees a broken
   map.
2. **Cache it server-side, on a schedule.** `.github/workflows/hrrr.yml` already
   runs 4×/day and force-pushes to the `data` branch. Write `fires.json` from
   that same job. No new infrastructure.
3. **Serve the last good copy on failure.** A 429 or a timeout means keep
   yesterday's file and carry on. Absent data means no icons, never a broken map.

There is no SLA. It is a government service on ArcGIS Online and it can simply
be down.

---

## 4. Is the containment number any good?

Measured across the 252 active US wildfires ≥100 acres on 2026-08-02:

| Measure | Result |
| --- | --- |
| Missing `PercentContained`, all fires | 12% (31 of 252) |
| Missing `PercentContained`, fires ≥5,000 acres | **0 of 74** |
| Median record age, all fires | 23 hours |
| Median record age, ≥5,000 ac and <90% contained | **9 hours** |
| Updated within 24h, ≥5,000 ac and <90% contained | **37 of 37 (100%)** |

**The gaps are concentrated exactly where they don't matter.** Every stale record
is a fire that is finished or trivial. Some real examples from that pull:

```
Snyder            28,264 ac   100% contained   318h since update
Shingle Creek        628 ac    95% contained   335h since update
Beaver               115 ac    null            317h since update
```

Nobody updates a fire that is out. Meanwhile every fire that is both large and
actively burning, which is to say every fire that is actually generating the
smoke Smokeshow forecasts, was updated inside 24 hours without exception.

For our use case, the data is good.

### What "reliable" does not mean here

**This is a daily human report, not telemetry.** Containment comes from incident
commanders filing at the end of an operational period. The service republishes
within minutes of a filing, but the underlying number moves once or twice a day.

Do not present it as live. Present it with its timestamp.

---

## 5. Outside the US

| Region | Named fires | Containment | Source |
| --- | --- | --- | --- |
| **US** | yes | yes, a real percent | NIFC WFIGS |
| **Canada** | yes, province by province | **no percent**, a status word | BC Wildfire Service, CWFIS, provincial agencies |
| **Europe** | partial | no, burnt area only | EFFIS |
| **Australia** | yes, state by state | no percent, a status word | NSW RFS and equivalents |
| **Everywhere else** | no | no | none |

Canada reports **stage of control**, not a percentage: `Out of Control`,
`Being Held`, `Under Control`, `Out`. This is arguably more honest than a
percentage but it is a different data type, and any UI must handle both.

Verified working for British Columbia:

```bash
curl "https://openmaps.gov.bc.ca/geo/pub/WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_PNTS_SP/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_PNTS_SP&count=3&outputFormat=application/json"
```

Returns `INCIDENT_NAME`, `FIRE_STATUS`, `CURRENT_SIZE`, `FIRE_CAUSE`,
`GEOGRAPHIC_DESCRIPTION`, and a `FIRE_URL` deep link. Note the geometry comes
back in **BC Albers (EPSG:3005), not WGS84**. There are `LATITUDE` and
`LONGITUDE` properties, use those.

There is no single pan-Canadian feed with per-fire containment. Each province
publishes its own, in its own schema. That is a real integration cost, and it is
why the honest scope is "US named fires, global hotspots."

---

## 6. Where to see all this in a browser

| | |
| --- | --- |
| [maps.nwcg.gov/sa](https://maps.nwcg.gov/sa/) | The WFIGS data rendered. What the fire community actually uses. Click a fire for name, acres, containment. |
| [data-nifc.opendata.arcgis.com](https://data-nifc.opendata.arcgis.com/) | Service catalog, field documentation, update cadence. |
| [inciweb.wildfire.gov](https://inciweb.wildfire.gov/) | Narrative incident updates, evacuations, photos. Good "read more" target. |
| [firms.modaps.eosdis.nasa.gov/map](https://firms.modaps.eosdis.nasa.gov/map/) | The hotspot layer. Open it next to NWCG to see the difference concretely. |
| [watchduty.org](https://www.watchduty.org/) | The consumer app in this space. Worth studying for presentation. |

---

## 7. Suggested copy

Smokeshow's voice is plain, concrete, and refuses to overclaim. `src/lib/rating.js`
is the reference: *"Visibility under about 1.5 miles."* Fire copy should sound
like that, and must obey the `CLAUDE.md` hard rule against invented claims.

### Named incident, on hover or tap

```
ROWE CREEK COMPLEX
313,439 acres · 55% contained
Burning since July 15 · Reported 9 hours ago
```

Normalize the name casing to `Rowe Creek Complex`.

**"Reported" is doing real work.** It is not "updated" or "live". Crews file once
or twice a day and that phrasing sets the expectation correctly.

When containment is null, say so plainly rather than hiding the row or printing
`0%`, which is a different and much scarier claim:

```
Containment not reported
```

### Hotspot, on hover or tap

```
Satellite heat detection
Seen 2 hours ago · VIIRS, 375m
Not a confirmed fire.
```

That last line is the important one. These detections include gas flares and
industrial heat.

### Layer legend

```
● Named fires    reported by fire crews
· Heat detections    seen from orbit
```

### Explainer, for the sheet or an info tap

Matches the register of the existing `AgreementBand` copy:

> Named fires come from the interagency reporting system US fire crews file into,
> usually once or twice a day. Containment is their estimate of how much of the
> fire's edge is held, not how much of it is out.
>
> Heat detections come from satellites passing overhead every few hours. They
> show where something is hot, which is usually a fire but is sometimes a gas
> flare or a factory. They have no name and no size.
>
> Outside the United States we can show heat detections but rarely fire names,
> and almost never containment.

### Copy rules

- Never call a hotspot a fire. It is a "heat detection".
- Never print containment without its report age next to it.
- Never say "live" or "real-time" about containment.
- Never render `0%` for a null. Say "not reported".
- Filter `IncidentTypeCategory = 'RX'` out, or say "prescribed burn" explicitly.
  Labeling a planned burn as a wildfire is the worst failure mode here.

---

## 8. Suggested build

This revises `docs/branch-prompts.md` §B12, which was written when FIRMS looked
like the only option and therefore ruled named incidents out of scope. WFIGS
changes that premise for the US. The rest of the B12 prompt still stands,
including the design constraints about legibility against a bright smoke plume.

1. **Extend the existing job.** In `.github/workflows/hrrr.yml`, after the frame
   render, pull WFIGS and FIRMS and write `fires.json` to the `data` branch.
   Keep the last good copy on any non-200. The FIRMS `MAP_KEY` stays a GitHub
   Actions secret and never reaches the client; WFIGS needs no key at all.
2. **One file, two feature collections**, `incidents` and `hotspots`, so the
   client never has to guess which kind of thing it is holding.
3. **Cluster the hotspots** at write time, not in the browser. Size by detection
   count. Filter on the FIRMS confidence field and record the threshold chosen
   in the file itself.
4. **Render incidents above hotspots.** Named fires are the answer to "where is
   this coming from"; hotspots are supporting texture.
5. **Perimeters are a later increment.** The polygon layer joins on `IrwinID`
   and reads far better than a dot at close zoom, but it is additive and should
   not gate the first version.
6. **Degrade quietly.** No `fires.json`, or a stale one, means fewer icons or an
   age caveat. It never means a broken map.

### Open questions for whoever builds this

- Do fires appear at all zoom levels, or only zoomed out? B12 argues zoomed out,
  since that is where "where is this coming from" gets asked.
- Does tapping a named fire deep-link to InciWeb? Free, useful, and it is
  someone else's hosting.
- Canada is the second most likely smoke source for US users. Is BC alone worth
  integrating, given it means a second schema and a status word instead of a
  percentage?
