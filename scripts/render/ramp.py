"""The smoke ramp, in Python. THE one Python copy — do not add another.

`src/lib/rating.js` SMOKE_STOPS is the JS copy; these four arrays are its
hand-mirror. `npm run ramp` (scripts/smoke-ramp-audit.mjs) parses THIS file
and fails if the two disagree, so both renderers import from here rather than
each carrying their own transcription.

Pale on dark, intensity riding brightness, because the basemap is CARTO
dark_nolabels. See CLAUDE.md build order §4 for why the ramp inverted.
"""

import numpy as np

STOPS = np.array([0, 3, 8, 12, 20, 35, 55, 150, 300], dtype=float)
RAMP_R = np.array([186, 180, 176, 172, 166, 155, 126, 64, 20], dtype=float)
RAMP_G = np.array([188, 182, 174, 166, 155, 136, 100, 50, 16], dtype=float)
RAMP_B = np.array([192, 186, 172, 156, 136, 110, 78, 42, 15], dtype=float)
RAMP_A = np.array([0, 0.07, 0.18, 0.27, 0.38, 0.5, 0.62, 0.78, 0.9], dtype=float) * 255

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


def ramp_rgba(v):
    """µg/m³ -> (r, g, b, a) float arrays, straight from the four ramp arrays."""
    v = np.clip(np.nan_to_num(np.asarray(v, dtype=float), nan=0.0), 0, None)
    return (
        np.interp(v, STOPS, RAMP_R),
        np.interp(v, STOPS, RAMP_G),
        np.interp(v, STOPS, RAMP_B),
        np.interp(v, STOPS, RAMP_A),
    )


def palette():
    """(768-byte RGB palette, 256-byte alpha table) for PNG-8 + tRNS."""
    pm = index_to_pm25(np.arange(PALETTE_N))
    r, g, b, a = ramp_rgba(pm)
    rgb = np.rint(np.stack([r, g, b], axis=1)).astype(np.uint8)
    alpha = np.rint(a).astype(np.uint8)
    alpha[0] = 0  # index 0 is exactly clean air, and must be exactly invisible
    return bytes(rgb.reshape(-1)), bytes(alpha)
