"""The smoke ramp, in Python. THE one Python copy — do not add another.

`src/lib/rating.js` SMOKE_STOPS is the JS copy; these four arrays are its
hand-mirror. `npm run ramp` (scripts/smoke-ramp-audit.mjs) parses THIS file
and fails if the two disagree, so both renderers import from here rather than
each carrying their own transcription.

The default ramp DARKENS with concentration, because the basemap it sits on is
CARTO Positron (light_nolabels) on the web and MapKit's light standard style in
the app. The rule is in CLAUDE.md build order §4: the ramp always runs opposite
the tiles, or the worst air converges with the basemap and disappears.

A second, INVERTED ramp lives below it for dark basemaps. It is not a copy of
the light one — it is the same field rendered for the opposite backdrop, and it
gets the same audit against a dark band. Both are published; a client picks by
the basemap it is actually drawing.
"""

import numpy as np

STOPS = np.array([0, 3, 8, 12, 20, 35, 55, 150, 300], dtype=float)
RAMP_R = np.array([186, 180, 176, 172, 166, 155, 126, 64, 20], dtype=float)
RAMP_G = np.array([188, 182, 174, 166, 155, 136, 100, 50, 16], dtype=float)
RAMP_B = np.array([192, 186, 172, 156, 136, 110, 78, 42, 15], dtype=float)
RAMP_A = np.array([0, 0.07, 0.18, 0.27, 0.38, 0.5, 0.62, 0.78, 0.9], dtype=float) * 255

# The dark-basemap ramp: pale on dark, intensity riding brightness. Same STOPS,
# opposite direction. Luminance and alpha both rise across the whole range, so
# composited contrast against a dark backdrop rises with concentration — the
# same property the light ramp has against a light one.
# Neutral grey where the air is only slightly off, warming to a light amber as
# it thickens: on black, a warm high end reads as smoke lit from somewhere,
# where a neutral one reads as fog.
DARK_RAMP_R = np.array([96, 122, 150, 172, 196, 216, 232, 244, 252], dtype=float)
DARK_RAMP_G = np.array([98, 122, 148, 166, 182, 196, 206, 220, 234], dtype=float)
DARK_RAMP_B = np.array([102, 124, 144, 152, 152, 148, 140, 150, 176], dtype=float)
DARK_RAMP_A = np.array([0, 0.08, 0.2, 0.3, 0.42, 0.55, 0.68, 0.82, 0.92], dtype=float) * 255

LIGHT = "light"
DARK = "dark"
THEMES = (LIGHT, DARK)


def _arrays(theme):
    if theme == DARK:
        return DARK_RAMP_R, DARK_RAMP_G, DARK_RAMP_B, DARK_RAMP_A
    return RAMP_R, RAMP_G, RAMP_B, RAMP_A

# ---------------------------------------------------------------- palette
#
# Every pixel a frame can hold lies on this one-dimensional curve — the field
# is scalar and the ramp is a function of it — so an RGBA image spends four
# bytes saying what one byte can say. Frames are therefore written as PNG-8
# with a 256-entry palette DERIVED from the ramp above (never re-typed), which
# is what makes a global domain affordable. See docs/global-frames.md.
#
# Index spacing is quadratic in µg/m³ so the fine steps land where the rating
# thresholds are (5/12/20/35/55) and the coarse ones land above 150 where the
# ramp is nearly flat anyway. At every point on the curve one index step moves
# alpha by less than 1/255, so the quantisation is invisible at 8-bit output.
PALETTE_N = 256
PM_MAX = float(STOPS[-1])  # the ramp saturates here; above it the map is flat


def index_to_pm25(i):
    """Palette index (0..255) -> the µg/m³ that index represents."""
    return PM_MAX * (np.asarray(i, dtype=float) / (PALETTE_N - 1)) ** 2


def pm25_to_index(v):
    """µg/m³ -> palette index. Monotonic, saturating at PM_MAX."""
    v = np.clip(np.nan_to_num(np.asarray(v, dtype=float), nan=0.0), 0.0, PM_MAX)
    return np.rint((PALETTE_N - 1) * np.sqrt(v / PM_MAX)).astype(np.uint8)


def ramp_rgba(v, theme=LIGHT):
    """µg/m³ -> (r, g, b, a) float arrays, straight from the four ramp arrays."""
    v = np.clip(np.nan_to_num(np.asarray(v, dtype=float), nan=0.0), 0, None)
    r, g, b, a = _arrays(theme)
    return (
        np.interp(v, STOPS, r),
        np.interp(v, STOPS, g),
        np.interp(v, STOPS, b),
        np.interp(v, STOPS, a),
    )


def palette(theme=LIGHT):
    """(768-byte RGB palette, 256-byte alpha table) for PNG-8 + tRNS."""
    pm = index_to_pm25(np.arange(PALETTE_N))
    r, g, b, a = ramp_rgba(pm, theme)
    rgb = np.rint(np.stack([r, g, b], axis=1)).astype(np.uint8)
    alpha = np.rint(a).astype(np.uint8)
    alpha[0] = 0  # index 0 is exactly clean air, and must be exactly invisible
    return bytes(rgb.reshape(-1)), bytes(alpha)
