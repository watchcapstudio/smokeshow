"""Shared frame-rendering plumbing for every smoke domain.

A "domain" is one rectangular pre-rendered smoke field: a model, an extent, a
pixel size, and a set of hourly PNG frames keyed by absolute valid time. HRRR
is one (3 km, CONUS); CAMS global is another (40 km, most of the populated
world). The client picks the sharpest domain that contains the map centre and
has a frame for the hour — see src/lib/frames.js.

Both renderers write:

  <out>/<domain>/frame-<YYYYMMDDTHH>.png   PNG-8, palette = the smoke ramp
  <out>/<domain>/domain.json               this domain's manifest block

and the publish step merges every domain.json it finds into one root
manifest.json (scripts/render/assemble_manifest.py).
"""

import json
import os

import numpy as np
from PIL import Image

from .ramp import DARK, LIGHT, palette, pm25_to_index



def merc_y(lat_deg):
    return np.log(np.tan(np.pi / 4 + np.radians(lat_deg) / 2))


def target_grid(lon_w, lon_e, lat_s, lat_n, width):
    """Lat/lon of each pixel centre, rows spaced linearly in Web-Mercator y.

    Spacing the rows in Mercator y (rather than in degrees) is what lets the
    client paint the frame as a plain axis-aligned drawImage against Leaflet's
    tiles with no reprojection per pixel.
    """
    y_s, y_n = merc_y(lat_s), merc_y(lat_n)
    height = int(round(width * (y_n - y_s) / np.radians(lon_e - lon_w)))
    y_rows = np.linspace(y_n, y_s, height)  # top row = north
    lats = np.degrees(2 * np.arctan(np.exp(y_rows)) - np.pi / 2)
    lons = np.linspace(lon_w, lon_e, width)
    return lats, lons, height


def save_frame(path, ug_m3, theme=LIGHT):
    """Write one frame as PNG-8 whose palette IS the smoke ramp.

    Smooth wash only. The ash-grain stipple is applied CLIENT-side in screen
    space (see SmokeCanvasLayer): texture baked into a domain-wide image turns
    into smudges after 10-20x map upscaling.
    """
    idx = pm25_to_index(ug_m3)
    rgb, alpha = palette(theme)
    img = Image.fromarray(idx, mode="P")
    img.putpalette(rgb)
    img.save(path, optimize=True, transparency=alpha)


def write_domain(out_root, domain):
    """Write <out>/<id>/domain.json. `domain` is the manifest block itself."""
    d = os.path.join(out_root, domain["id"])
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "domain.json"), "w") as f:
        json.dump(domain, f)
    return d


def domain_block(
    *,
    id,
    label,
    model,
    source,
    resolution_km,
    priority,
    bounds,
    width,
    height,
    frames,
    run,
    generated,
    wraps=False,
    series=None,
    theme=LIGHT,
):
    """One entry in the v2 manifest's `domains` array.

    `priority` breaks ties where domains overlap — higher wins, so HRRR keeps
    winning inside CONUS. `resolution_km` and `label` are not decoration: the
    map prints them, because a user is owed the model's resolution the same
    way they are owed "model estimate, never observed".
    """
    block = {
        "id": id,
        "label": label,
        "model": model,
        "source": source,
        "resolutionKm": resolution_km,
        "priority": priority,
        "bounds": bounds,
        "width": width,
        "height": height,
        "wraps": wraps,
        # Which basemap this domain's palette was rendered for. Clients paint
        # the one matching the tiles they are actually drawing; a client that
        # has never heard of the field gets "light", which is what every
        # already-published domain is.
        "theme": theme,
        "run": run,
        "generated": generated,
        "frames": frames,
    }
    if series:
        block["series"] = series
    return block
