#!/usr/bin/env python3
"""Render HRRR-Smoke near-surface smoke (MASSDEN) to web-map PNG frames.

This is the SHARP domain: 3 km, CONUS only. scripts/cams/render_frames.py
renders the global domain that covers everywhere else, on the same plumbing in
scripts/render/. Both publish to the `data` branch and the client picks the
sharpest domain that contains the map centre (src/lib/frames.js).

Pulls byte-range subsets of NOAA HRRR surface GRIB2 from AWS via Herbie,
regrids the 3km Lambert-conformal field onto a lat/lon image whose rows are
spaced linearly in Web-Mercator y (so it lines up with map tiles), colors it
with SMOKESHOW's smoke ramp, and writes:

  out/hrrr/frame-<YYYYMMDDTHH>.png   one per valid hour, -12h .. +48h
  out/hrrr/domain.json               this domain's manifest block
  out/hrrr/series.json               1-degree HRRR point series (agreement band)

Runs in GitHub Actions (see .github/workflows/hrrr.yml); output is merged into
the `data` branch and served via raw.githubusercontent.com.
"""

import json
import os
import sys
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np
from pyproj import Transformer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from render.frames import domain_block, save_frame, target_grid, write_domain  # noqa: E402

warnings.filterwarnings("ignore")

OUT = os.environ.get("OUT_DIR", "out")
SEARCH = ":MASSDEN:8 m above ground:"
KG_M3_TO_UG_M3 = 1e9

# CONUS extent; rows spaced in Mercator y for tile alignment.
LON_W, LON_E, LAT_S, LAT_N = -125.0, -66.5, 24.0, 50.0
WIDTH = 1200

DOMAIN = "hrrr"
# Higher than the global domain's, so HRRR keeps winning inside CONUS.
PRIORITY = 100

# HRRR's Lambert conformal projection (fixed for the operational CONUS grid).
HRRR_PROJ = (
    "+proj=lcc +lat_0=38.5 +lon_0=-97.5 +lat_1=38.5 +lat_2=38.5 "
    "+x_0=0 +y_0=0 +R=6371229 +units=m +no_defs"
)
HRRR_DX = 3000.0


def latest_cycle(now=None):
    """Most recent 00/06/12/18Z cycle old enough for f48 to exist (~2.5h lag)."""
    now = now or datetime.now(timezone.utc)
    candidate = now - timedelta(hours=2, minutes=30)
    cycle_hour = (candidate.hour // 6) * 6
    return candidate.replace(hour=cycle_hour, minute=0, second=0, microsecond=0)


def open_field(run_dt, fxx):
    from herbie import Herbie

    h = Herbie(run_dt.strftime("%Y-%m-%d %H:00"), model="hrrr", product="sfc", fxx=fxx)
    ds = h.xarray(SEARCH, remove_grib=True)
    var = ds[list(ds.data_vars)[0]]
    return var.values * KG_M3_TO_UG_M3, ds.latitude.values, ds.longitude.values


class Regridder:
    """Exact index-math regrid from HRRR's LCC grid to the target image grid."""

    def __init__(self, hrrr_lat2d, hrrr_lon2d):
        self.shape = hrrr_lat2d.shape
        to_lcc = Transformer.from_crs("EPSG:4326", HRRR_PROJ, always_xy=True)
        lon00 = hrrr_lon2d[0, 0]
        lon00 = lon00 - 360 if lon00 > 180 else lon00
        self.x0, self.y0 = to_lcc.transform(lon00, hrrr_lat2d[0, 0])

        lats, lons, height = target_grid(LON_W, LON_E, LAT_S, LAT_N, WIDTH)
        lon2d, lat2d = np.meshgrid(lons, lats)
        tx, ty = to_lcc.transform(lon2d, lat2d)
        ix = np.round((tx - self.x0) / HRRR_DX).astype(int)
        iy = np.round((ty - self.y0) / HRRR_DX).astype(int)
        self.valid = (
            (ix >= 0) & (ix < self.shape[1]) & (iy >= 0) & (iy < self.shape[0])
        )
        self.ix = np.clip(ix, 0, self.shape[1] - 1)
        self.iy = np.clip(iy, 0, self.shape[0] - 1)
        self.height = height

        # 1-degree series sample points for the agreement band
        self.s_lats = np.arange(25.0, 50.0, 1.0)
        self.s_lons = np.arange(-124.0, -66.0, 1.0)
        s_lon2d, s_lat2d = np.meshgrid(self.s_lons, self.s_lats)
        sx, sy = to_lcc.transform(s_lon2d, s_lat2d)
        six = np.round((sx - self.x0) / HRRR_DX).astype(int)
        siy = np.round((sy - self.y0) / HRRR_DX).astype(int)
        self.s_valid = (
            (six >= 0) & (six < self.shape[1]) & (siy >= 0) & (siy < self.shape[0])
        )
        self.s_ix = np.clip(six, 0, self.shape[1] - 1)
        self.s_iy = np.clip(siy, 0, self.shape[0] - 1)

    def image(self, field):
        out = field[self.iy, self.ix]
        out[~self.valid] = 0.0
        return out

    def samples(self, field):
        out = field[self.s_iy, self.s_ix]
        out[~self.s_valid] = np.nan
        return out


def main():
    out_dir = os.path.join(OUT, DOMAIN)
    os.makedirs(out_dir, exist_ok=True)
    run = latest_cycle()
    print(f"HRRR run: {run:%Y-%m-%d %HZ}")

    # Valid hours: 12 before the cycle (hourly-run analyses) + f00..f48.
    jobs = [(run - timedelta(hours=h), 0) for h in range(12, 0, -1)]
    jobs += [(run, f) for f in range(0, 49)]

    regridder = None
    frames = []
    series_values = []
    series_times = []

    for run_dt, fxx in jobs:
        valid = run_dt + timedelta(hours=fxx)
        try:
            field, lat2d, lon2d = open_field(run_dt, fxx)
        except Exception as e:  # missing run/hour — skip the frame, keep going
            print(f"  skip {valid:%Y-%m-%dT%H} ({run_dt:%H}Z f{fxx:02d}): {type(e).__name__}: {e}")
            continue
        if regridder is None:
            regridder = Regridder(lat2d, lon2d)

        stamp = valid.strftime("%Y%m%dT%H")
        save_frame(f"{out_dir}/frame-{stamp}.png", regridder.image(field))

        time_key = valid.strftime("%Y-%m-%dT%H:00")
        frames.append({"time": time_key, "file": f"frame-{stamp}.png"})
        if fxx > 0 or run_dt == run:  # forecast series from the main cycle only
            sample = regridder.samples(field)
            series_values.append(
                np.where(np.isnan(sample), -1, np.round(sample, 1)).tolist()
            )
            series_times.append(time_key)
        print(f"  wrote {time_key}")

    if not frames:
        raise SystemExit("no frames rendered — aborting so the data branch keeps the last good run")

    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    write_domain(
        OUT,
        domain_block(
            id=DOMAIN,
            label="NOAA HRRR-Smoke",
            model="HRRR-Smoke near-surface (MASSDEN, 8m AGL)",
            source="NOAA HRRR-Smoke",
            resolution_km=3,
            priority=PRIORITY,
            bounds={"latS": LAT_S, "latN": LAT_N, "lonW": LON_W, "lonE": LON_E},
            width=WIDTH,
            height=regridder.height,
            frames=frames,
            run=run.strftime("%Y-%m-%dT%H:00"),
            generated=generated,
            series="series.json",
        ),
    )

    series = {
        "run": run.strftime("%Y-%m-%dT%H:00"),
        "generated": generated,
        "lat0": float(regridder.s_lats[0]),
        "lon0": float(regridder.s_lons[0]),
        "dlat": 1.0,
        "dlon": 1.0,
        "nlat": len(regridder.s_lats),
        "nlon": len(regridder.s_lons),
        "times": series_times,
        # values[t] is a 2D [nlat][nlon] grid, µg/m³, -1 = outside HRRR domain
        "values": series_values,
    }
    with open(f"{out_dir}/series.json", "w") as f:
        json.dump(series, f)

    print(f"done: {len(frames)} frames, {len(series_times)} series hours")


if __name__ == "__main__":
    main()
