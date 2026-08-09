#!/usr/bin/env python3
"""Render CAMS global near-surface PM2.5 to web-map PNG frames.

This is the GLOBAL domain: ~40 km, most of the populated world. It is what the
map shows anywhere HRRR's 3 km CONUS box does not reach — Edmonton, the BC
interior, the NWT, all of Europe, everywhere else. scripts/hrrr/render_frames.py
renders the sharp domain; both run on the shared plumbing in scripts/render/
and the client picks the sharpest domain that contains the map centre.

Source is ECMWF's Atmosphere Data Store (ADS), dataset
`cams-global-atmospheric-composition-forecasts`, variable
`particulate_matter_2.5um` — the same CAMS product Open-Meteo serves as point
forecasts, taken as a gridded field so the map can paint a plume instead of
interpolating nine dots.

Writes:

  out/cams/frame-<YYYYMMDDTHH>.png   one per valid hour, -12h .. +48h
  out/cams/domain.json               this domain's manifest block

Credentials: ADS_API_KEY in the environment (GitHub Actions secret — never on
the client). Free registration at https://ads.atmosphere.copernicus.eu/.

  python scripts/cams/render_frames.py                    # live ADS
  python scripts/cams/render_frames.py --source synthetic # no credentials

Copernicus attribution is required wherever this data is shown; the map prints
it next to the CARTO and OSM credits (src/components/SmokeMap.jsx).
"""

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from render.frames import domain_block, save_frame, target_grid, write_domain  # noqa: E402

OUT = os.environ.get("OUT_DIR", "out")
DOMAIN = "cams"
# Below HRRR's, so HRRR keeps winning inside CONUS.
PRIORITY = 10

# Global extent, latitude clipped to the populated bands. Why these numbers,
# and why one image rather than regional tiles, is argued in
# docs/global-frames.md — the byte budget is the whole design constraint.
LON_W, LON_E, LAT_S, LAT_N = -180.0, 180.0, -60.0, 75.0
WIDTH = 1200  # 0.3 deg/px — a 1.33x oversample of CAMS's 0.4 deg, no more

CAMS_RES_KM = 40  # 0.4 deg at the equator
KG_M3_TO_UG_M3 = 1e9

PAST_HOURS = 12
FORECAST_HOURS = 48

ADS_URL = "https://ads.atmosphere.copernicus.eu/api"
ADS_DATASET = "cams-global-atmospheric-composition-forecasts"
ADS_VARIABLE = "particulate_matter_2.5um"


def latest_cycle(now=None):
    """Most recent 00/12Z CAMS cycle old enough to have been disseminated.

    CAMS global forecasts run twice daily and reach the ADS roughly 6-8 hours
    after the nominal time. 9 hours is the conservative wait: late is a stale
    map, early is a failed job.
    """
    now = now or datetime.now(timezone.utc)
    candidate = now - timedelta(hours=9)
    return candidate.replace(
        hour=(candidate.hour // 12) * 12, minute=0, second=0, microsecond=0
    )


# ------------------------------------------------------------------ retrieval


def fetch_ads(run_dt, leadtimes, path):
    """One ADS retrieval: a single run, one variable, N lead times, as GRIB."""
    import cdsapi

    key = os.environ.get("ADS_API_KEY")
    if not key:
        raise SystemExit("ADS_API_KEY is not set (GitHub Actions secret)")

    client = cdsapi.Client(url=os.environ.get("ADS_API_URL", ADS_URL), key=key)
    client.retrieve(
        ADS_DATASET,
        {
            "variable": [ADS_VARIABLE],
            "date": f"{run_dt:%Y-%m-%d}/{run_dt:%Y-%m-%d}",
            "time": f"{run_dt:%H}:00",
            "leadtime_hour": [str(h) for h in leadtimes],
            "type": ["forecast"],
            "data_format": "grib",
        },
        path,
    )
    return path


def read_grib(path):
    """GRIB -> (values[t, lat, lon] in ug/m3, lats, lons, leadtime hours)."""
    import xarray as xr

    ds = xr.open_dataset(path, engine="cfgrib", backend_kwargs={"indexpath": ""})
    var = ds[list(ds.data_vars)[0]]
    if "step" not in var.dims:  # a single lead time comes back squeezed
        var = var.expand_dims("step")
    values = np.asarray(var.values, dtype=float) * KG_M3_TO_UG_M3
    steps = [int(np.timedelta64(s, "h") / np.timedelta64(1, "h")) for s in np.atleast_1d(ds.step.values)]
    return values, np.asarray(ds.latitude.values), np.asarray(ds.longitude.values), steps


# -------------------------------------------------------------------- regrid


class Regridder:
    """Bilinear regrid from CAMS's regular lat/lon grid to the image grid.

    The longitude axis wraps: CAMS is published on 0..360 and the image spans
    -180..180, so the seam is an index modulo rather than a special case. A
    hard edge down the middle of the Pacific is exactly the kind of artefact a
    global field is supposed to remove.
    """

    def __init__(self, src_lats, src_lons):
        self.nlat = len(src_lats)
        self.nlon = len(src_lons)
        lat0, dlat = float(src_lats[0]), float(src_lats[1] - src_lats[0])
        lon0, dlon = float(src_lons[0]), float(src_lons[1] - src_lons[0])

        lats, lons, self.height = target_grid(LON_W, LON_E, LAT_S, LAT_N, WIDTH)
        lon2d, lat2d = np.meshgrid(lons, lats)

        fi = np.clip((lat2d - lat0) / dlat, 0, self.nlat - 1.0001)
        fj = ((lon2d - lon0) / dlon) % self.nlon

        self.i0 = np.floor(fi).astype(int)
        self.j0 = np.floor(fj).astype(int)
        self.i1 = np.minimum(self.i0 + 1, self.nlat - 1)
        self.j1 = (self.j0 + 1) % self.nlon
        self.wi = fi - self.i0
        self.wj = fj - self.j0

    def image(self, field):
        a = field[self.i0, self.j0]
        b = field[self.i0, self.j1]
        c = field[self.i1, self.j0]
        d = field[self.i1, self.j1]
        top = a + (b - a) * self.wj
        bot = c + (d - c) * self.wj
        return top + (bot - top) * self.wi


# ---------------------------------------------------------------------- main


def collect(run, args):
    """{valid datetime -> field} for -12h .. +48h, newest run winning."""
    prev = run - timedelta(hours=12)
    by_time = {}

    if args.source == "synthetic":
        from synthetic_field import synthetic_run  # noqa: E402

        for run_dt, leads in ((prev, range(0, 12)), (run, range(0, FORECAST_HOURS + 1))):
            values, lats, lons, steps = synthetic_run(run_dt, list(leads))
            for k, step in enumerate(steps):
                by_time[run_dt + timedelta(hours=step)] = values[k]
        return by_time, lats, lons

    lats = lons = None
    os.makedirs(args.cache, exist_ok=True)
    # The older run covers the 12 hours behind the current one; the current run
    # covers everything from its own hour forward and overwrites the overlap
    # (dicts keep the later write). The past is optional — a map that starts at
    # "now" is still a map; a map with no forecast is not.
    jobs = [
        (prev, list(range(0, PAST_HOURS)), True),
        (run, list(range(0, FORECAST_HOURS + 1)), False),
    ]
    for run_dt, leads, optional in jobs:
        path = os.path.join(args.cache, f"cams-{run_dt:%Y%m%d%H}.grib")
        try:
            if not os.path.exists(path):
                fetch_ads(run_dt, leads, path)
            values, lats, lons, steps = read_grib(path)
        except Exception as e:
            if not optional:
                raise
            print(f"  skip {run_dt:%Y-%m-%d %HZ} (past hours): {type(e).__name__}: {e}")
            continue
        for k, step in enumerate(steps):
            by_time[run_dt + timedelta(hours=step)] = values[k]
        print(f"  {run_dt:%Y-%m-%d %HZ}: {len(steps)} lead times")
    return by_time, lats, lons


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["ads", "synthetic"], default="ads")
    ap.add_argument("--cache", default=os.environ.get("CAMS_CACHE", "cams-cache"))
    ap.add_argument("--run", help="override the cycle, e.g. 2026-08-02T12")
    args = ap.parse_args()

    run = (
        datetime.strptime(args.run, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
        if args.run
        else latest_cycle()
    )
    print(f"CAMS run: {run:%Y-%m-%d %HZ}  (source: {args.source})")

    by_time, src_lats, src_lons = collect(run, args)
    regridder = Regridder(src_lats, src_lons)

    out_dir = os.path.join(OUT, DOMAIN)
    os.makedirs(out_dir, exist_ok=True)

    window = [run - timedelta(hours=PAST_HOURS) + timedelta(hours=h)
              for h in range(PAST_HOURS + FORECAST_HOURS + 1)]

    frames = []
    for valid in window:
        field = by_time.get(valid)
        if field is None:
            print(f"  skip {valid:%Y-%m-%dT%H} (no lead time covers it)")
            continue
        stamp = valid.strftime("%Y%m%dT%H")
        path = f"{out_dir}/frame-{stamp}.png"
        save_frame(path, regridder.image(field))
        frames.append({"time": valid.strftime("%Y-%m-%dT%H:00"), "file": f"frame-{stamp}.png"})
        print(f"  wrote {valid:%Y-%m-%dT%H}  {os.path.getsize(path) / 1024:6.1f} KB")

    if not frames:
        raise SystemExit("no frames rendered — aborting so the data branch keeps the last good run")

    total = sum(os.path.getsize(f"{out_dir}/{f['file']}") for f in frames)
    print(
        f"done: {len(frames)} frames, {WIDTH}x{regridder.height}, "
        f"{total / 1024 / 1024:.1f} MB total, {total / len(frames) / 1024:.0f} KB mean"
    )

    write_domain(
        OUT,
        domain_block(
            id=DOMAIN,
            label="Copernicus CAMS global",
            model="CAMS global forecast, near-surface PM2.5",
            source="Copernicus Atmosphere Monitoring Service",
            resolution_km=CAMS_RES_KM,
            priority=PRIORITY,
            bounds={"latS": LAT_S, "latN": LAT_N, "lonW": LON_W, "lonE": LON_E},
            width=WIDTH,
            height=regridder.height,
            frames=frames,
            run=run.strftime("%Y-%m-%dT%H:00"),
            generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            wraps=True,
            measures="all PM2.5",
        ),
    )


if __name__ == "__main__":
    main()
