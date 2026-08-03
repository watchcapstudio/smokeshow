#!/usr/bin/env python3
"""Geometry self-test for the CAMS global resampler.

The render job talks to ECMWF, so it cannot run in CI on every commit — but the
part most likely to be wrong is pure index math, and that CAN be proved offline:
longitude wrapping (CAMS ships 0..360), latitude ordering (CAMS ships north
first), and Mercator row placement (a frame one row out is a plume in the wrong
country).

Run before the real render:  python3 scripts/cams/selftest.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from smokefield.ramp import PALETTE_ENTRIES, TRANSPARENT_BELOW_UG, merc_y, save_frame  # noqa: E402
from render_global import LAT_N, LAT_S, LON_E, LON_W, WIDTH, Resampler  # noqa: E402

failures = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


def cams_axes(step=0.4):
    """CAMS as ECMWF ships it: longitudes 0..360 ascending, latitudes north first."""
    lons = np.arange(0.0, 360.0, step)
    lats = np.arange(90.0, -90.0 - step / 2, -step)
    return lats, lons


def source_with_spike(lats, lons, lat0, lon0, value=500.0):
    field = np.zeros((len(lats), len(lons)))
    li = int(np.argmin(np.abs(lats - lat0)))
    lon_360 = lon0 % 360
    oi = int(np.argmin(np.abs(lons - lon_360)))
    field[li, oi] = value
    return field


def expected_pixel(lat0, lon0):
    """Where the target image should put that spike."""
    y_s, y_n = merc_y(LAT_S), merc_y(LAT_N)
    height = int(round(WIDTH * (y_n - y_s) / np.radians(LON_E - LON_W)))
    row = (y_n - merc_y(lat0)) / (y_n - y_s) * (height - 1)
    col = (lon0 - LON_W) / (LON_E - LON_W) * (WIDTH - 1)
    return row, col, height


print("CAMS resampler geometry\n")

lats, lons = cams_axes()
r = Resampler(lats, lons)

# 1. Image shape matches the declared Mercator grid.
_, _, height = expected_pixel(0, 0)
img = r.image(np.zeros((len(lats), len(lons))))
check("image shape matches target grid", img.shape == (height, WIDTH), f"{img.shape}")

# 2. Places land where they belong — including a negative longitude, which is
#    the case CAMS's 0..360 axis gets wrong if the wrap is missed.
PLACES = [
    ("Edmonton", 53.5, -113.5),   # the city B11 exists for
    ("Missoula", 46.9, -114.0),
    ("Madrid", 40.4, -3.7),       # small negative lon: wraps to 356 in CAMS
    ("Sydney", -33.9, 151.2),     # southern hemisphere, eastern lon
    ("Anchorage", 61.2, -149.9),  # far west
]
for name, lat0, lon0 in PLACES:
    out = r.image(source_with_spike(lats, lons, lat0, lon0))
    got = np.unravel_index(int(np.argmax(out)), out.shape)
    want_row, want_col, _ = expected_pixel(lat0, lon0)
    # Bilinear spreads a single source cell over neighbouring pixels; the peak
    # must still land within one source cell (0.4° ~ 2 px at 0.2°/px).
    ok = abs(got[0] - want_row) <= 3 and abs(got[1] - want_col) <= 3
    check(f"{name} lands at the right pixel", ok,
          f"got ({got[0]}, {got[1]}) want ({want_row:.0f}, {want_col:.0f})")

# 3. Nothing leaks across the antimeridian: a spike at 179°E must not appear at
#    the western edge.
out = r.image(source_with_spike(lats, lons, 0.0, 179.0))
check("no antimeridian bleed", out[:, :20].max() < 1.0, f"west edge max {out[:, :20].max():.2f}")

# 4. North is up. A northern spike must sit above a southern one.
north = np.unravel_index(int(np.argmax(r.image(source_with_spike(lats, lons, 60.0, 0.0)))), img.shape)
south = np.unravel_index(int(np.argmax(r.image(source_with_spike(lats, lons, -40.0, 0.0)))), img.shape)
check("north is up", north[0] < south[0], f"rows {north[0]} vs {south[0]}")

# 5. Ascending-latitude input (some ADS responses come south-first) resamples
#    identically — the flip must be driven by the axis, not assumed.
r_asc = Resampler(lats[::-1], lons)
a = r.image(source_with_spike(lats, lons, 53.5, -113.5))
b = r_asc.image(source_with_spike(lats[::-1], lons, 53.5, -113.5))
check("latitude order handled either way", np.allclose(a, b), f"max diff {np.abs(a - b).max():.3f}")

# 6. The encoder round-trips through a real PNG.
print("\nframe encoder\n")
field = np.zeros((height, WIDTH))
field[100:140, 200:260] = 80.0
field[200:210, 400:420] = 1.0  # below the transparency floor
tmp = "/tmp/_selftest_frame.png"
nbytes = save_frame(field, tmp)
from PIL import Image  # noqa: E402

decoded = np.asarray(Image.open(tmp).convert("RGBA"), dtype=int)
check("paletted PNG decodes with alpha", Image.open(tmp).mode == "P")
check("plume is opaque", decoded[120, 230, 3] > 100, f"alpha {decoded[120, 230, 3]}")
check(f"below {TRANSPARENT_BELOW_UG} µg/m³ is fully transparent", decoded[205, 410, 3] == 0)
check("empty sky is fully transparent", decoded[0, 0, 3] == 0)
check("palette size as configured", len(Image.open(tmp).getpalette()) // 3 >= PALETTE_ENTRIES)
print(f"  ....  world frame {WIDTH}x{height} = {nbytes / 1024:.0f} KB")
os.remove(tmp)

print(f"\n{'FAIL: ' + ', '.join(failures) if failures else 'PASS: resampler geometry and encoder are sound'}")
sys.exit(1 if failures else 0)
