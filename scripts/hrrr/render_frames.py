#!/usr/bin/env python3
"""Render HRRR-Smoke near-surface smoke (MASSDEN) to web-map PNG frames.

Pulls byte-range subsets of NOAA HRRR surface GRIB2 from AWS via Herbie,
regrids the 3km Lambert-conformal field onto a lat/lon image whose rows are
spaced linearly in Web-Mercator y (so a Leaflet ImageOverlay lines up with
map tiles), colors it with SMOKESHOW's smoke ramp, and writes:

  out/hrrr/frame-<YYYYMMDDTHH>.png   one per valid hour, -12h .. +48h
  out/hrrr/manifest.json             frame index + run metadata
  out/hrrr/series.json               1-degree HRRR point series (agreement band)

Runs in GitHub Actions (see .github/workflows/hrrr.yml); output is force-
pushed to the `data` branch and served via raw.githubusercontent.com.
"""

import json
import os
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np
from PIL import Image
from pyproj import Transformer

warnings.filterwarnings("ignore")

OUT = os.environ.get("OUT_DIR", "out/hrrr")
SEARCH = ":MASSDEN:8 m above ground:"
KG_M3_TO_UG_M3 = 1e9

# CONUS extent; rows spaced in Mercator y for tile alignment.
LON_W, LON_E, LAT_S, LAT_N = -125.0, -66.5, 24.0, 50.0
WIDTH = 1200

# HRRR's Lambert conformal projection (fixed for the operational CONUS grid).
HRRR_PROJ = (
    "+proj=lcc +lat_0=38.5 +lon_0=-97.5 +lat_1=38.5 +lat_2=38.5 "
    "+x_0=0 +y_0=0 +R=6371229 +units=m +no_defs"
)
HRRR_DX = 3000.0

# Same perceptually-weighted smoke ramp as src/lib/rating.js SMOKE_STOPS —
# gray to brown to near-black, intensity riding darkness because the basemap is
# CARTO Positron (light_nolabels). Keep in sync: `npm run ramp` parses these
# four arrays and fails if they disagree with the JS.
STOPS = np.array([0, 3, 8, 12, 20, 35, 55, 150, 300], dtype=float)
RAMP_R = np.array([186, 180, 176, 172, 166, 155, 126, 64, 20], dtype=float)
RAMP_G = np.array([188, 182, 174, 166, 155, 136, 100, 50, 16], dtype=float)
RAMP_B = np.array([192, 186, 172, 156, 136, 110, 78, 42, 15], dtype=float)
RAMP_A = np.array([0, 0.07, 0.18, 0.27, 0.38, 0.50, 0.62, 0.78, 0.90], dtype=float) * 255


def merc_y(lat_deg):
    return np.log(np.tan(np.pi / 4 + np.radians(lat_deg) / 2))


def target_grid():
    y_s, y_n = merc_y(LAT_S), merc_y(LAT_N)
    height = int(round(WIDTH * (y_n - y_s) / np.radians(LON_E - LON_W)))
    y_rows = np.linspace(y_n, y_s, height)  # top row = north
    lats = np.degrees(2 * np.arctan(np.exp(y_rows)) - np.pi / 2)
    lons = np.linspace(LON_W, LON_E, WIDTH)
    return lats, lons, height


def colorize(ug_m3):
    # Smooth wash only. The ash-grain stipple is applied CLIENT-side in
    # screen space (see SmokeCanvasLayer): texture baked into a CONUS-wide
    # image turns into smudges after 10-20x map upscaling.
    v = np.clip(np.nan_to_num(ug_m3, nan=0.0), 0, None)
    r = np.interp(v, STOPS, RAMP_R)
    g = np.interp(v, STOPS, RAMP_G)
    b = np.interp(v, STOPS, RAMP_B)
    a = np.interp(v, STOPS, RAMP_A)
    return np.dstack([r, g, b, a]).astype(np.uint8)


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

        lats, lons, height = target_grid()
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
    os.makedirs(OUT, exist_ok=True)
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

        img = colorize(regridder.image(field))
        stamp = valid.strftime("%Y%m%dT%H")
        Image.fromarray(img, "RGBA").save(f"{OUT}/frame-{stamp}.png", optimize=True)

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

    manifest = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": "HRRR-Smoke near-surface (MASSDEN, 8m AGL)",
        "run": run.strftime("%Y-%m-%dT%H:00"),
        "bounds": {"latS": LAT_S, "latN": LAT_N, "lonW": LON_W, "lonE": LON_E},
        "width": WIDTH,
        "height": regridder.height,
        "frames": frames,
    }
    with open(f"{OUT}/manifest.json", "w") as f:
        json.dump(manifest, f)

    series = {
        "run": manifest["run"],
        "generated": manifest["generated"],
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
    with open(f"{OUT}/series.json", "w") as f:
        json.dump(series, f)

    print(f"done: {len(frames)} frames, {len(series_times)} series hours")


if __name__ == "__main__":
    main()
