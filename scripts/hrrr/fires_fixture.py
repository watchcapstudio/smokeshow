#!/usr/bin/env python3
"""Synthesise FIRMS-shaped CSVs so fetch_fires.py can be run without a MAP_KEY.

This is a TEST FIXTURE, not data. It exists so the filter/cluster path in
fetch_fires.py can be exercised offline and so scripts/verify-fires.mjs has a
fires.json to draw. The geometry is modelled on how VIIRS/MODIS actually behave
— a complex is a swarm of hundreds to thousands of pixels re-detected on every
overpass, a fifth of VIIRS rows come back low-confidence, and flare fields look
like small permanent fires — but the fires themselves are invented.

  python scripts/hrrr/fires_fixture.py --out /tmp/firms
  FIRMS_FIXTURE_DIR=/tmp/firms FIRES_OUT=/tmp/out python scripts/hrrr/fetch_fires.py
"""

import argparse
import math
import os
import random
from datetime import datetime, timedelta, timezone

VIIRS_HEADER = (
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,"
    "instrument,confidence,version,bright_ti5,frp,daynight"
)
# MODIS NRT is the product that tends to carry `type`; VIIRS NRT does not.
MODIS_HEADER = (
    "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,"
    "instrument,confidence,version,bright_t31,frp,daynight,type"
)

# name, lat, lon, radius_km, detections_per_viirs_overpass
COMPLEXES = [
    # Northern BC / Alberta boreal — the zoomed-out "where is this coming
    # from" case that prompted the layer.
    ("bc-north-a", 57.62, -122.85, 34, 900),
    ("bc-north-b", 58.31, -121.40, 22, 420),
    ("bc-north-c", 56.94, -124.10, 16, 210),
    ("ab-west", 58.80, -118.20, 26, 520),
    ("nwt-south", 60.45, -116.90, 19, 260),
    ("sask-north", 56.10, -105.60, 14, 150),
    ("on-north", 51.30, -90.20, 12, 110),
    ("qc-north", 52.80, -75.40, 17, 190),
    # CONUS
    ("or-cascades", 43.55, -122.10, 11, 130),
    ("ca-north", 40.85, -122.95, 9, 95),
    ("ca-sierra", 37.40, -119.60, 7, 60),
    ("id-central", 45.10, -115.30, 13, 140),
    ("mt-west", 47.20, -114.10, 8, 70),
    ("nm-gila", 33.30, -108.40, 6, 45),
    ("wa-east", 48.30, -119.70, 5, 35),
    # Rest of world, so a global file is a global file.
    ("siberia-a", 62.40, 108.30, 30, 700),
    ("siberia-b", 66.10, 128.90, 21, 380),
    ("amazon-a", -9.40, -63.20, 15, 240),
    ("amazon-b", -11.80, -55.60, 12, 170),
    ("angola", -11.20, 19.40, 26, 900),
    ("drc", -5.10, 23.70, 24, 820),
    ("sudan", 9.80, 28.60, 20, 560),
    ("australia-nt", -14.20, 132.60, 18, 300),
    ("indonesia", -2.30, 113.80, 9, 120),
    ("portugal", 40.10, -7.90, 4, 40),
    ("greece", 38.40, 23.10, 3, 28),
]

# Persistent industrial heat: gas flares and one volcano. These are the false
# positives the confidence field only half-catches — that is the point of
# putting them in the fixture.
FLARES = [
    ("bakken", 47.95, -103.30, 60),
    ("permian", 31.90, -102.40, 75),
    ("niger-delta", 4.80, 6.20, 40),
    ("gulf-flares", 29.30, 48.10, 55),
    ("kilauea", 19.42, -155.29, 25),  # volcano, type=1 in MODIS
]

SENSORS = [
    ("VIIRS_SNPP_NRT", "N", "VIIRS", [3, 14]),
    ("VIIRS_NOAA20_NRT", "1", "VIIRS", [1, 12]),
    ("VIIRS_NOAA21_NRT", "2", "VIIRS", [2, 13]),
    ("MODIS_NRT", "Terra", "MODIS", [10]),
]


def jitter(rng, lat, lon, radius_km):
    """A point in a ring-weighted blob — fires burn at the perimeter."""
    ang = rng.uniform(0, 2 * math.pi)
    r = radius_km * math.sqrt(rng.uniform(0.15, 1.0))
    dlat = r * math.cos(ang) / 111.32
    dlon = r * math.sin(ang) / (111.32 * max(0.15, math.cos(math.radians(lat))))
    return lat + dlat, lon + dlon


def viirs_confidence(rng):
    # Roughly the live mix: most nominal, a real low-confidence tail.
    x = rng.random()
    return "l" if x < 0.19 else ("h" if x < 0.42 else "n")


def modis_confidence(rng):
    x = rng.random()
    return rng.randint(0, 29) if x < 0.16 else rng.randint(30, 100)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/firms")
    ap.add_argument("--seed", type=int, default=20260802)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    os.makedirs(args.out, exist_ok=True)
    now = datetime.now(timezone.utc)

    for source, sat, instrument, overpass_hours in SENSORS:
        modis = instrument == "MODIS"
        lines = [MODIS_HEADER if modis else VIIRS_HEADER]

        def row(lat, lon, when, frp, conf, ftype):
            night = when.hour < 6 or when.hour > 18
            bright = rng.uniform(320, 367) if not modis else rng.uniform(300, 400)
            b2 = rng.uniform(280, 300)
            base = (
                f"{lat:.5f},{lon:.5f},{bright:.1f},0.4,0.4,"
                f"{when:%Y-%m-%d},{when:%H%M},{sat},{instrument},{conf},2.0NRT,"
                f"{b2:.1f},{frp:.1f},{'N' if night else 'D'}"
            )
            return base + (f",{ftype}" if modis else "")

        for hour in overpass_hours:
            when = (now - timedelta(hours=(now.hour - hour) % 24)).replace(
                minute=rng.randrange(0, 60), second=0, microsecond=0
            )
            for _name, lat, lon, radius, per_pass in COMPLEXES:
                # MODIS at 1km sees far fewer pixels over the same ground.
                n = int(per_pass * (0.14 if modis else 1.0) * rng.uniform(0.7, 1.2))
                for _ in range(n):
                    plat, plon = jitter(rng, lat, lon, radius)
                    conf = modis_confidence(rng) if modis else viirs_confidence(rng)
                    lines.append(
                        row(plat, plon, when, rng.uniform(1.5, 260.0), conf, 0)
                    )

            for _name, lat, lon, per_pass in FLARES:
                n = int(per_pass * (0.2 if modis else 1.0))
                volcano = _name == "kilauea"
                for _ in range(n):
                    plat, plon = jitter(rng, lat, lon, 18)
                    conf = modis_confidence(rng) if modis else viirs_confidence(rng)
                    lines.append(
                        row(
                            plat,
                            plon,
                            when,
                            rng.uniform(0.8, 40.0),
                            conf,
                            1 if volcano else 2,
                        )
                    )

            # Scattered one-off detections: new starts, ag burns, and noise.
            for _ in range(900 if not modis else 160):
                plat = rng.uniform(-52, 68)
                plon = rng.uniform(-179, 179)
                conf = modis_confidence(rng) if modis else viirs_confidence(rng)
                lines.append(row(plat, plon, when, rng.uniform(0.5, 30.0), conf, 0))

        path = os.path.join(args.out, f"{source}.csv")
        with open(path, "w") as f:
            f.write("\n".join(lines) + "\n")
        print(f"{path}: {len(lines) - 1} rows")


if __name__ == "__main__":
    main()
