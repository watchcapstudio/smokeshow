#!/usr/bin/env python3
"""Render CAMS global PM2.5 to web-map PNG frames — the everywhere domain.

The HRRR job (scripts/hrrr/render_frames.py) renders a sharp 3 km field over
CONUS. This one renders the whole populated world at CAMS's native 0.4°, so
that Edmonton, Calgary, the NWT, and Europe stop falling off the map — see
docs/smokeshow-global-coverage.md for why the box used to cut where it did and
what it cost.

  out/cams/frame-<YYYYMMDDTHH>.png   one per valid hour, -12h .. +48h
  out/cams/manifest.json             v2 domain manifest

Source is ECMWF's Atmosphere Data Store. Credentials come from the
ADS_API_KEY secret in GitHub Actions and are never present on the client.

Both renderers share scripts/smokefield/ramp.py — one ramp, one encoder, one
Mercator grid. Frames are paletted PNG-8: 147 KB for the world at 1800x958,
against the 413 KB CONUS RGBA frame this replaces.
"""

import json
import os
import sys
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from smokefield.ramp import save_frame, target_grid  # noqa: E402

warnings.filterwarnings("ignore")

OUT = os.environ.get("OUT_DIR", "out/cams")
# Downloaded netCDF stays OUT of the published directory: the data branch
# carries frames and a manifest, not hundreds of megabytes of source GRIB.
CACHE = os.environ.get("CAMS_CACHE", ".cams-cache")

# The populated world. Beyond 75°N / 60°S Mercator stretches absurdly and
# essentially nobody lives there; including those bands would roughly double the
# image height to serve a rounding error of users.
LON_W, LON_E, LAT_S, LAT_N = -180.0, 180.0, -60.0, 75.0

# 1800 px across 360° is 0.2°/px — exactly 2x the CAMS grid. Enough to upscale
# smoothly on the client, not so much that it implies detail the model does not
# have. The byte budget behind this number is in docs/smokeshow-global-coverage.md.
WIDTH = 1800

CAMS_DEG = 0.4
DATASET = "cams-global-atmospheric-composition-forecasts"
VARIABLE = "particulate_matter_2.5um"
KG_M3_TO_UG_M3 = 1e9

# CAMS global runs 00Z and 12Z. Products land roughly 7-8 hours after the cycle,
# so a cycle is only safe to request once it is comfortably old.
CYCLE_LAG_HOURS = 9
FORECAST_HOURS = 48
PAST_HOURS = 12

DOMAIN = {
    "key": "cams-global",
    "model": "CAMS global atmospheric composition forecast (PM2.5)",
    # Surfaced in the UI. The map must say which field a reader is looking at —
    # honesty about model resolution is the same rule as "model estimate, never
    # observed", and the silent fallback is the gap B11 exists to close.
    "label": "40 km global model",
    "resolutionKm": 44,
    # HRRR wins wherever it has a frame; this is the everywhere-else field.
    "priority": 1,
}


def latest_cycle(now=None):
    now = now or datetime.now(timezone.utc)
    candidate = now - timedelta(hours=CYCLE_LAG_HOURS)
    return candidate.replace(
        hour=(candidate.hour // 12) * 12, minute=0, second=0, microsecond=0
    )


def fetch(run_dt, steps):
    """Pull one CAMS run's PM2.5 steps from ADS as netCDF. Returns the path.

    ADS credentials are read by cdsapi from CDSAPI_URL/CDSAPI_KEY, which the
    workflow sets from the ADS_API_KEY secret.
    """
    import cdsapi

    os.makedirs(CACHE, exist_ok=True)
    path = f"{CACHE}/cams-{run_dt:%Y%m%d%H}.nc"
    if os.path.exists(path):
        return path
    cdsapi.Client().retrieve(
        DATASET,
        {
            "variable": VARIABLE,
            "date": f"{run_dt:%Y-%m-%d}/{run_dt:%Y-%m-%d}",
            "time": f"{run_dt:%H}:00",
            "leadtime_hour": [str(s) for s in steps],
            "type": "forecast",
            "format": "netcdf",
        },
        path,
    )
    return path


def open_run(path):
    """(values[step, lat, lon] in µg/m³, lats, lons, step_hours)."""
    import xarray as xr

    ds = xr.open_dataset(path)
    var = ds[list(ds.data_vars)[0]]
    lats = ds["latitude"].values
    lons = ds["longitude"].values
    steps = [int(np.round(float(s) / 3600e9)) for s in ds["forecast_period"].values] \
        if "forecast_period" in ds else list(range(var.shape[0]))
    return var.values * KG_M3_TO_UG_M3, lats, lons, steps


class Resampler:
    """CAMS is a regular lat/lon grid, so this is bilinear index math — no
    projection library, unlike HRRR's Lambert conformal source."""

    def __init__(self, src_lats, src_lons):
        # CAMS ships 0..360 longitudes descending in latitude; normalise both so
        # the interpolation below is a straight monotonic lookup.
        self.lons = np.where(src_lons > 180, src_lons - 360, src_lons)
        self.lon_order = np.argsort(self.lons)
        self.lons = self.lons[self.lon_order]

        self.lat_desc = src_lats[0] > src_lats[-1]
        self.lats = src_lats[::-1] if self.lat_desc else src_lats

        lats, lons, self.height = target_grid(LAT_S, LAT_N, LON_W, LON_E, WIDTH)
        self.ty = np.interp(lats, self.lats, np.arange(len(self.lats)))
        self.tx = np.interp(lons, self.lons, np.arange(len(self.lons)))

    def image(self, field):
        f = field[:, self.lon_order]
        if self.lat_desc:
            f = f[::-1, :]

        y0 = np.clip(np.floor(self.ty).astype(int), 0, f.shape[0] - 1)
        y1 = np.clip(y0 + 1, 0, f.shape[0] - 1)
        x0 = np.clip(np.floor(self.tx).astype(int), 0, f.shape[1] - 1)
        x1 = np.clip(x0 + 1, 0, f.shape[1] - 1)
        wy = (self.ty - y0)[:, None]
        wx = (self.tx - x0)[None, :]

        top = f[np.ix_(y0, x0)] * (1 - wx) + f[np.ix_(y0, x1)] * wx
        bot = f[np.ix_(y1, x0)] * (1 - wx) + f[np.ix_(y1, x1)] * wx
        return top * (1 - wy) + bot * wy


def main():
    os.makedirs(OUT, exist_ok=True)
    run = latest_cycle()
    print(f"CAMS run: {run:%Y-%m-%d %HZ}")

    # Past hours come from the previous cycle's later steps, so the scrubber's
    # -12h end is a real field rather than a gap.
    prev = run - timedelta(hours=12)
    jobs = [(prev, list(range(12 - PAST_HOURS + 12, 12))), (run, list(range(0, FORECAST_HOURS + 1)))]

    resampler = None
    frames = []
    total_bytes = 0

    for run_dt, steps in jobs:
        if not steps:
            continue
        try:
            values, lats, lons, got = open_run(fetch(run_dt, steps))
        except Exception as e:
            # A missing cycle must not take the run down: the frames that did
            # render still publish, and the client falls back per hour.
            print(f"  skip cycle {run_dt:%Y-%m-%d %HZ}: {type(e).__name__}: {e}")
            continue
        if resampler is None:
            resampler = Resampler(lats, lons)

        for i, step in enumerate(got):
            valid = run_dt + timedelta(hours=step)
            stamp = valid.strftime("%Y%m%dT%H")
            time_key = valid.strftime("%Y-%m-%dT%H:00")
            if any(f["time"] == time_key for f in frames):
                continue  # the newer cycle already covered this hour
            nbytes = save_frame(resampler.image(values[i]), f"{OUT}/frame-{stamp}.png")
            total_bytes += nbytes
            frames.append({"time": time_key, "file": f"frame-{stamp}.png"})
            print(f"  wrote {time_key}  ({nbytes / 1024:.0f} KB)")

    if not frames:
        raise SystemExit("no frames rendered — aborting so the data branch keeps the last good run")

    frames.sort(key=lambda f: f["time"])
    manifest = {
        "v": 2,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "run": run.strftime("%Y-%m-%dT%H:00"),
        "bounds": {"latS": LAT_S, "latN": LAT_N, "lonW": LON_W, "lonE": LON_E},
        "width": WIDTH,
        "height": resampler.height,
        "frames": frames,
        **DOMAIN,
    }
    with open(f"{OUT}/manifest.json", "w") as f:
        json.dump(manifest, f)

    print(f"done: {len(frames)} frames, {total_bytes / 1048576:.1f} MB total")


if __name__ == "__main__":
    main()
