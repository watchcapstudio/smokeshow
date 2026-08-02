#!/usr/bin/env python3
"""Fetch NASA FIRMS active-fire detections and cluster them into map icons.

FIRMS reports THERMAL HOTSPOTS, not fires. One fire yields dozens to thousands
of detections: each satellite overpass flags every pixel that looks hot, and
four sensors pass over the same ground several times a day. Plotted raw that is
a swarm of dots, not a map. So this script does three things:

  1. filters on FIRMS' own confidence field (see KEEP_* below),
  2. links surviving detections into connected components at ~10 km, and
  3. writes one record per component with a detection COUNT, which is a
     reasonable proxy for scale and reads better than the raw swarm.

Output: out/fires.json, published to the `data` branch by the same GitHub
Actions job that renders the HRRR frames (.github/workflows/hrrr.yml). The
MAP_KEY is an Actions secret and never reaches the client.

Absent output is a supported state — the client draws no icons and the map is
otherwise unaffected — so every failure path here is non-fatal by design.

Env:
  FIRMS_MAP_KEY      required for a live fetch (free, by email from NASA)
  FIRMS_FIXTURE_DIR  read <SOURCE>.csv from this directory instead of the API,
                     for offline runs of the exact filter/cluster path
  FIRES_OUT          output directory (default: out)
"""

import csv
import io
import json
import math
import os
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"

# VIIRS 375m carries the detail; MODIS 1km is kept because it has the longer
# record and catches large fires the VIIRS swath happens to miss.
SOURCES = [
    "VIIRS_SNPP_NRT",
    "VIIRS_NOAA20_NRT",
    "VIIRS_NOAA21_NRT",
    "MODIS_NRT",
]

AREA = "world"
DAY_RANGE = 1  # FIRMS' own rolling 24h window
WINDOW_HOURS = 24

# --- confidence ------------------------------------------------------------
# VIIRS ships a category: l(ow) / n(ominal) / h(igh). NASA's own guidance is
# that low-confidence VIIRS detections are the ones most likely to be something
# other than a fire, so they are dropped and nominal+high are kept.
#
# MODIS ships 0-100. 30 is MODIS' documented nominal-confidence floor; below it
# the detection is flagged low. Same call, same reasoning.
#
# This drops genuine small or cool fires along with the false alarms. That is
# the trade this layer is making: a missing icon is a smaller lie than an icon
# over a gas flare labelled "heat detection".
KEEP_VIIRS_CONFIDENCE = {"n", "h"}
KEEP_MODIS_CONFIDENCE = 30

# FIRMS' `type` field, present on standard-processing products and absent from
# most NRT feeds: 0 vegetation fire, 1 active volcano, 2 other static land
# source (the gas-flare / industrial bucket), 3 offshore. When it is there,
# keep only 0 — that is the only filter FIRMS gives us for flares and volcanoes.
# When it is absent, confidence is the only screen and some flares survive.
KEEP_TYPE = {0}

LINK_KM = 10.0  # detections within one connected 10km chain are one complex
MAX_CLUSTERS = 6000  # keeps fires.json small enough to be an additive fetch

OUT = os.environ.get("FIRES_OUT", "out")

EARTH_R_KM = 6371.0
DLAT = LINK_KM / 111.32  # ~0.0899 deg; cells are 10km tall, 10km*cos(lat) wide
LON_SPAN = 2  # scan +/-2 lon cells so a 10km gap still links at high latitude


def fetch(source, map_key):
    url = f"{API}/{map_key}/{source}/{AREA}/{DAY_RANGE}"
    req = urllib.request.Request(url, headers={"User-Agent": "smokeshow/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read().decode("utf-8", "replace")


def load(source, map_key, fixture_dir):
    if fixture_dir:
        path = os.path.join(fixture_dir, f"{source}.csv")
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as f:
            return f.read()
    return fetch(source, map_key)


def parse_time(row):
    """FIRMS splits the stamp: acq_date YYYY-MM-DD, acq_time HHMM (UTC)."""
    hhmm = str(row.get("acq_time", "")).strip().zfill(4)
    try:
        return datetime.strptime(row["acq_date"].strip() + hhmm, "%Y-%m-%d%H%M").replace(
            tzinfo=timezone.utc
        )
    except (KeyError, ValueError):
        return None


def keep_confidence(source, raw):
    """True if the detection clears the threshold for its sensor."""
    v = str(raw).strip().lower()
    if source.startswith("MODIS"):
        try:
            return int(float(v)) >= KEEP_MODIS_CONFIDENCE
        except ValueError:
            return False
    # A few VIIRS rows carry the word rather than the letter.
    return v[:1] in KEEP_VIIRS_CONFIDENCE if v else False


def read_source(source, text, cutoff, stats):
    """CSV -> [(lat, lon, when, frp, is_high)], counting every row dropped."""
    out = []
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "latitude" not in reader.fieldnames:
        # FIRMS answers a bad key or a throttled request with a plain-text body,
        # not an HTTP error, so an unparseable header is the failure signal.
        raise ValueError(f"{source}: unexpected response header {reader.fieldnames!r}")

    for row in reader:
        stats["fetched"] += 1
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (KeyError, TypeError, ValueError):
            stats["dropped_malformed"] += 1
            continue

        if not keep_confidence(source, row.get("confidence", "")):
            stats["dropped_confidence"] += 1
            continue

        if "type" in row and str(row["type"]).strip() != "":
            try:
                if int(float(row["type"])) not in KEEP_TYPE:
                    stats["dropped_type"] += 1
                    continue
            except ValueError:
                pass

        when = parse_time(row)
        if when is None:
            stats["dropped_malformed"] += 1
            continue
        if when < cutoff:
            stats["dropped_stale"] += 1
            continue

        try:
            frp = float(row.get("frp") or 0.0)
        except ValueError:
            frp = 0.0

        conf = str(row.get("confidence", "")).strip().lower()
        if source.startswith("MODIS"):
            is_high = conf.isdigit() and int(conf) >= 80
        else:
            is_high = conf.startswith("h")

        stats["kept"] += 1
        out.append((lat, lon, when, frp, is_high))
    return out


class Union:
    def __init__(self):
        self.parent = {}

    def find(self, a):
        root = a
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[a] != root:  # path compression
            self.parent[a], a = root, self.parent[a]
        return root

    def add(self, a):
        self.parent.setdefault(a, a)

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def cluster(points):
    """Connected components of occupied ~10km cells.

    Union-find runs over CELLS, not detections: a big complex is tens of
    thousands of detections but only a few dozen occupied cells, and single-link
    on a field that dense gives the same components either way for a fraction of
    the work.
    """
    cells = defaultdict(list)
    for idx, (lat, lon, *_rest) in enumerate(points):
        cells[(math.floor(lat / DLAT), math.floor(lon / DLAT))].append(idx)

    uf = Union()
    for key in cells:
        uf.add(key)
    for (ci, cj) in cells:
        for di in (-1, 0, 1):
            for dj in range(-LON_SPAN, LON_SPAN + 1):
                if di == 0 and dj == 0:
                    continue
                nb = (ci + di, cj + dj)
                if nb in cells:
                    uf.union((ci, cj), nb)

    groups = defaultdict(list)
    for key, idxs in cells.items():
        groups[uf.find(key)].extend(idxs)
    return list(groups.values())


def summarize(points, idxs, generated):
    lat = sum(points[i][0] for i in idxs) / len(idxs)
    lon = sum(points[i][1] for i in idxs) / len(idxs)
    frp = sum(points[i][3] for i in idxs)
    last = max(points[i][2] for i in idxs)
    high = sum(1 for i in idxs if points[i][4])
    age_min = max(0, int(round((generated - last).total_seconds() / 60)))
    return [
        round(lat, 3),
        round(lon, 3),
        len(idxs),
        round(frp, 1),
        age_min,
        high,
    ]


def main():
    map_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    fixture_dir = os.environ.get("FIRMS_FIXTURE_DIR", "").strip()
    if not map_key and not fixture_dir:
        print("FIRMS_MAP_KEY not set — skipping the fire layer for this run")
        return 0

    generated = datetime.now(timezone.utc).replace(microsecond=0)
    cutoff = generated - timedelta(hours=WINDOW_HOURS)

    stats = defaultdict(int)
    points = []
    used = []
    for source in SOURCES:
        try:
            text = load(source, map_key, fixture_dir)
            if text is None:
                print(f"  {source}: no fixture, skipped")
                continue
            rows = read_source(source, text, cutoff, stats)
        except (urllib.error.URLError, ValueError, OSError) as e:
            # One sensor down is not a reason to lose the other three.
            print(f"  {source}: {type(e).__name__}: {e}")
            stats["sources_failed"] += 1
            continue
        used.append(source)
        points.extend(rows)
        print(f"  {source}: {len(rows)} kept")

    if not points:
        print("no detections survived the filters — writing nothing, layer stays absent")
        return 0

    groups = cluster(points)
    groups.sort(key=len, reverse=True)
    truncated = max(0, len(groups) - MAX_CLUSTERS)
    if truncated:
        # Never silent: the number goes in the log AND in the JSON.
        cut = len(groups[MAX_CLUSTERS])
        print(f"  capping at {MAX_CLUSTERS} clusters, dropping {truncated} with <= {cut} detections")
    kept_groups = groups[:MAX_CLUSTERS]

    clusters = [summarize(points, g, generated) for g in kept_groups]

    payload = {
        "generated": generated.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "NASA FIRMS near real-time active fire / thermal anomalies",
        "sensors": used,
        "windowHours": WINDOW_HOURS,
        "linkKm": LINK_KM,
        "confidence": {
            "viirs": "nominal+high (drops 'l')",
            "modis": f">= {KEEP_MODIS_CONFIDENCE}",
            "type": "vegetation fire only, where FIRMS supplies the type field",
        },
        "counts": {
            "fetched": stats["fetched"],
            "kept": stats["kept"],
            "droppedConfidence": stats["dropped_confidence"],
            "droppedType": stats["dropped_type"],
            "droppedStale": stats["dropped_stale"],
            "droppedMalformed": stats["dropped_malformed"],
            "sourcesFailed": stats["sources_failed"],
            "clusters": len(groups),
            "clustersKept": len(clusters),
            "clustersDropped": truncated,
        },
        # [lat, lon, detections, frpSumMW, ageMinutesAtGenerated, highConfidence]
        "fields": ["lat", "lon", "n", "frp", "age", "hi"],
        "clusters": clusters,
    }

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "fires.json"), "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    print(
        f"done: {stats['fetched']} detections fetched, {stats['kept']} kept "
        f"({stats['dropped_confidence']} below confidence, {stats['dropped_type']} wrong type, "
        f"{stats['dropped_stale']} outside {WINDOW_HOURS}h), "
        f"{len(groups)} clusters, {len(clusters)} written"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
