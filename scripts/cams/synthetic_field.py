"""A synthetic stand-in for the CAMS global field. NOT A DATA SOURCE.

`render_frames.py --source synthetic` uses this so the whole pipeline —
regrid, palette, PNG size, manifest, client — can be exercised and measured
without ADS credentials, and so the capture rig produces the same kind of
picture every time instead of whatever the world happened to be burning.

It is the same bargain scripts/verify-map.mjs strikes with map tiles: the
arithmetic downstream is real (the frames really are this pipeline's output at
this resolution, and their byte sizes are real PNG bytes), the meteorology is
invented. Anything rendered from here is labelled synthetic in the capture
notes and must never be published to the `data` branch.

Grid matches the CAMS global product: 0.4 deg, lats 90 -> -90, lons 0 -> 359.6.
"""

import numpy as np

DLAT = DLON = 0.4
LATS = np.arange(90.0, -90.0 - DLAT / 2, -DLAT)
LONS = np.arange(0.0, 360.0, DLON)

# Each source: (name, lat, lon, drift lat/h, drift lon/h, peak ug/m3,
#               cross-wind sigma deg, along-wind sigma deg)
# Placed where the world's smoke actually is in a northern-hemisphere August,
# which is also where the captures need to look.
SOURCES = [
    ("nw-canada", 57.5, -116.0, -0.10, 0.35, 320.0, 2.4, 7.0),
    ("bc-interior", 52.5, -122.0, -0.05, 0.30, 210.0, 2.0, 5.5),
    ("nw-us", 45.5, -115.5, 0.04, 0.28, 180.0, 1.8, 5.0),
    ("california", 40.0, -122.5, 0.06, 0.22, 150.0, 1.6, 4.0),
    ("iberia", 42.8, -8.8, -0.06, 0.24, 190.0, 1.7, 5.0),
    ("mediterranean", 37.5, 15.0, 0.05, 0.20, 120.0, 2.0, 4.5),
    ("siberia", 62.0, 105.0, -0.04, 0.30, 260.0, 3.0, 9.0),
    ("central-africa", -6.0, 20.0, 0.03, 0.18, 200.0, 3.5, 8.0),
    ("indo-gangetic", 27.5, 79.0, 0.00, -0.10, 170.0, 2.5, 6.0),
    ("se-asia", 15.0, 101.0, 0.02, 0.14, 110.0, 2.2, 5.0),
]

# A thin global background so the map is never a black void — CAMS never
# reports a clean planet either.
BACKGROUND = 1.5


def _blob(lat2d, dlon2d, lat, lon_delta, sig_cross, sig_along):
    return np.exp(-0.5 * (((lat2d - lat) / sig_cross) ** 2 + ((dlon2d - lon_delta) / sig_along) ** 2))


def synthetic_run(run_dt, leadtimes):
    """(values[t, lat, lon] ug/m3, lats, lons, steps) for one pseudo-run."""
    lon2d, lat2d = np.meshgrid(LONS, LATS)
    out = np.empty((len(leadtimes), len(LATS), len(LONS)), dtype=float)

    for k, step in enumerate(leadtimes):
        hours = run_dt.timetuple().tm_yday * 24 + run_dt.hour + step
        field = np.full(lat2d.shape, BACKGROUND)
        for _, lat, lon, dlat_h, dlon_h, peak, sc, sa in SOURCES:
            # Plumes drift, then recirculate, so a 60-hour window shows motion
            # without any source wandering off its own continent.
            phase = np.sin(hours / 29.0)
            clat = lat + dlat_h * 18.0 * phase
            clon = lon + dlon_h * 18.0 * phase
            # Signed minimal longitude difference — the seam is not a wall.
            dlon2d = (lon2d - clon + 180.0) % 360.0 - 180.0
            amp = peak * (0.55 + 0.45 * np.sin(hours / 11.0 + lat))
            field += amp * _blob(lat2d, dlon2d, clat, 0.0, sc, sa)
        out[k] = field

    return out, LATS, LONS, list(leadtimes)
