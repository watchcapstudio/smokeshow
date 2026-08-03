"""The smoke ramp, the Mercator target grid, and the frame encoder.

Shared by every renderer that writes frames to the `data` branch — HRRR over
CONUS (scripts/hrrr/render_frames.py) and CAMS globally
(scripts/cams/render_global.py). It exists so there is exactly ONE Python copy
of the ramp, mirroring `SMOKE_STOPS` in src/lib/rating.js. `npm run ramp`
parses the four arrays below and fails if they drift from the JS.

Do not copy these arrays into a renderer. Two copies of a ramp is the rule;
three is how the map ends up painting two different smokes.
"""

import numpy as np
from PIL import Image

# Keep in sync with SMOKE_STOPS in src/lib/rating.js — `npm run ramp` proves it
# and also proves the composite over the CARTO dark basemap stays monotonic.
STOPS = np.array([0, 5, 12, 20, 35, 55, 150, 300], dtype=float)
RAMP_R = np.array([180, 190, 205, 218, 230, 240, 250, 255], dtype=float)
RAMP_G = np.array([186, 194, 206, 216, 226, 234, 244, 251], dtype=float)
RAMP_B = np.array([196, 200, 208, 212, 216, 220, 228, 240], dtype=float)
RAMP_A = np.array([0, 0.10, 0.24, 0.38, 0.52, 0.66, 0.82, 0.92], dtype=float) * 255

# --- frame encoding -----------------------------------------------------------
#
# Frames ship as paletted PNG-8 rather than RGBA, which is worth roughly 4.5x on
# real data (a live 1200x680 CONUS frame: 413 KB RGBA -> 92 KB paletted) at a
# maximum channel error of 2/255 — below the threshold of visibility on a ramp
# this shallow.
#
# It works because the wash is a strict 1-D function of PM2.5: the ash-grain
# stipple is applied CLIENT-side in screen space, so nothing in the image varies
# except position along the ramp. A palette sampled along that ramp is therefore
# near-exact, where an ADAPTIVE quantiser — which does not know the image is
# 1-D — spends its entries badly and lands at 23/255, visible as banding.
#
# Entries are spaced uniformly in ALPHA, not in PM2.5. Alpha is what the eye
# reads on a dark basemap, and the ramp is deliberately non-linear in PM2.5
# (most of its travel is spent below 55 µg/m³, where most days live).
PALETTE_ENTRIES = 64

# Below this, the wash is under 5% opaque: invisible on the map, but expensive
# to encode, because a faint noisy background occupies many distinct indices and
# destroys the compressor's run lengths. Snapping it to fully transparent is
# both cheaper and more honest — "no smoke to notice" starts at 12 µg/m³.
# Do not raise this past 2: at 3 µg/m³ the error jumps to 15/255 because real
# visible values start getting flattened.
TRANSPARENT_BELOW_UG = 2.0


def colorize(ug_m3):
    """RGBA float field -> uint8 image. The reference rendering, unquantised."""
    v = np.clip(np.nan_to_num(ug_m3, nan=0.0), 0, None)
    return np.dstack([
        np.interp(v, STOPS, RAMP_R),
        np.interp(v, STOPS, RAMP_G),
        np.interp(v, STOPS, RAMP_B),
        np.interp(v, STOPS, RAMP_A),
    ]).astype(np.uint8)


def palette():
    """(rgb[N,3] uint8, alpha[N] uint8) sampled uniformly in alpha along the ramp."""
    pm = np.interp(np.linspace(RAMP_A[0], RAMP_A[-1], PALETTE_ENTRIES), RAMP_A, STOPS)
    rgb = np.stack([
        np.interp(pm, STOPS, RAMP_R),
        np.interp(pm, STOPS, RAMP_G),
        np.interp(pm, STOPS, RAMP_B),
    ], axis=1).astype(np.uint8)
    return rgb, np.interp(pm, STOPS, RAMP_A).astype(np.uint8)


def to_indices(ug_m3):
    """PM2.5 field -> palette indices, quantising in alpha space."""
    v = np.clip(np.nan_to_num(ug_m3, nan=0.0), 0, STOPS[-1])
    v = np.where(v < TRANSPARENT_BELOW_UG, 0.0, v)
    alpha = np.interp(v, STOPS, RAMP_A)
    span = RAMP_A[-1] - RAMP_A[0]
    return np.round((alpha - RAMP_A[0]) / span * (PALETTE_ENTRIES - 1)).astype(np.uint8)


def save_frame(ug_m3, path):
    """Write one paletted frame. Returns bytes written, for the run's log."""
    rgb, alpha = palette()
    img = Image.fromarray(to_indices(ug_m3), "P")
    img.putpalette(rgb.flatten().tolist())
    # PNG-8 carries per-entry alpha in tRNS, so a paletted frame is still fully
    # translucent over the basemap.
    img.save(path, "PNG", optimize=True, transparency=bytes(alpha.tolist()))
    import os

    return os.path.getsize(path)


# --- target grid --------------------------------------------------------------


def merc_y(lat_deg):
    return np.log(np.tan(np.pi / 4 + np.radians(lat_deg) / 2))


def target_grid(lat_s, lat_n, lon_w, lon_e, width):
    """Rows spaced linearly in Web-Mercator y so a Leaflet ImageOverlay lines
    up with the tiles underneath it. Returns (lats, lons, height)."""
    y_s, y_n = merc_y(lat_s), merc_y(lat_n)
    height = int(round(width * (y_n - y_s) / np.radians(lon_e - lon_w)))
    y_rows = np.linspace(y_n, y_s, height)  # top row = north
    lats = np.degrees(2 * np.arctan(np.exp(y_rows)) - np.pi / 2)
    return lats, np.linspace(lon_w, lon_e, width), height
