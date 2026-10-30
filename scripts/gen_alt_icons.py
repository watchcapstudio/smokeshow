"""Supporter alternate app icons: the same mark under four other skies.

Same ridge, same sun geometry as the shipped icon (scripts/gen_icon_hills.py,
whose helpers this imports), with the sky and sun recoloured from the app's own
sky palette in src/lib/sky.js: clear day, golden hour, night, and the heaviest
smoke. One sky per icon, nothing invented, so a supporter's home screen still
reads as Smokeshow.

Writes 1024px masters straight into the app's asset catalog, plus a small
`IconPreview-*` image set of each (and of the shipped icon) for the in-app
picker, since an app icon set cannot be loaded as an image:

    python3 scripts/gen_alt_icons.py

Icon names here must match SupporterIcon in
apple/Sources/SmokeshowKit/Support/Supporter.swift and the
ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES list in apple/project.yml.
"""
import json
import os

from PIL import Image

import gen_icon_hills as base
from gen_icon_hills import (
    INK, S, SMK_DK, lerp, radial_sun, ridge_layer, smooth_ridge, vgrad,
)

ASSETS = os.path.join(
    os.path.dirname(__file__), "..",
    "apple", "Sources", "SmokeshowApp", "Assets.xcassets",
)

# src/lib/sky.js
DAY_ZEN, DAY_HOR = (139, 169, 196), (226, 222, 206)
GOLD_ZEN, GOLD_HOR = (126, 138, 168), (228, 172, 116)
NIGHT_ZEN, NIGHT_HOR = (14, 18, 28), (42, 48, 62)
SMK_HOR, SMK_DKH = (168, 116, 64), (80, 56, 34)
# SkyScene.swift moon fill
MOON = (240, 242, 230)

# Shipped-icon geometry, so only the light changes between icons.
SUN_AT = (0.62, 0.40)
SUN_R = (0.088, 0.165, 0.42)

ICONS = {
    # No smoke: the sky the app paints on an All clear afternoon.
    "AppIcon-Clear": dict(
        sky=[(0.0, DAY_ZEN), (0.7, lerp(DAY_ZEN, DAY_HOR, 0.8)), (1.0, DAY_HOR)],
        sun=((255, 252, 240), (250, 236, 200), (236, 222, 196)),
        sun_r=(0.07, 0.11, 0.30),
        far=(0.45, lerp(INK, (70, 86, 104), 0.5)), near=(0.9, lerp(INK, (40, 50, 60), 0.3)),
    ),
    # Clean golden hour, no haze in it: the sun low on the ridge, the sky
    # still blue overhead where the smoke icons are brown.
    "AppIcon-Golden": dict(
        sky=[(0.0, lerp(GOLD_ZEN, DAY_ZEN, 0.4)), (0.55, lerp(GOLD_ZEN, GOLD_HOR, 0.7)), (1.0, GOLD_HOR)],
        sun=((255, 246, 222), (250, 196, 120), (236, 150, 86)),
        sun_at=(0.5, 0.56), sun_r=(0.10, 0.15, 0.36),
        far=(0.6, lerp(INK, (96, 84, 104), 0.4)), near=(1.0, INK),
    ),
    # Night: a pale moon in place of the sun.
    "AppIcon-Night": dict(
        sky=[(0.0, NIGHT_ZEN), (0.7, lerp(NIGHT_ZEN, NIGHT_HOR, 0.8)), (1.0, NIGHT_HOR)],
        sun=(MOON, lerp(MOON, NIGHT_HOR, 0.25), NIGHT_HOR),
        sun_r=(0.075, 0.09, 0.22),
        far=(0.9, lerp((4, 5, 9), NIGHT_HOR, 0.2)), near=(1.0, (2, 3, 6)),
    ),
    # The top level: sky gone to smoke, the sun a dim red disc.
    "AppIcon-Smokeshow": dict(
        sky=[(0.0, SMK_DK), (0.5, lerp(SMK_DK, SMK_DKH, 0.7)), (1.0, SMK_DKH)],
        sun=((236, 120, 64), (196, 78, 38), (120, 52, 30)),
        sun_r=(0.06, 0.12, 0.34),
        far=(0.75, lerp((14, 10, 6), SMK_DK, 0.4)), near=(1.0, (12, 9, 6)),
    ),
}


def render(spec):
    far = smooth_ridge(base.FAR_RAW, 6)
    near = smooth_ridge(base.NEAR_RAW, 6)
    img = vgrad(spec["sky"]).convert("RGBA")
    core, mid, edge = spec["sun"]
    r = spec["sun_r"]
    at = spec.get("sun_at", SUN_AT)
    img.alpha_composite(radial_sun(at[0] * S, at[1] * S, r[0] * S, r[1] * S, r[2] * S,
                                   core=core, mid=mid, edge=edge))
    far_a, far_ink = spec["far"]
    near_a, near_ink = spec["near"]
    img.alpha_composite(ridge_layer(far, far_ink, far_a, 12, 0.33))
    img.alpha_composite(ridge_layer(near, near_ink, near_a, 8, 0.33))
    return img.convert("RGB").resize((1024, 1024), Image.LANCZOS)


def write_iconset(name, img):
    folder = os.path.join(ASSETS, f"{name}.appiconset")
    os.makedirs(folder, exist_ok=True)
    img.save(os.path.join(folder, "icon-1024.png"), optimize=True)
    with open(os.path.join(folder, "Contents.json"), "w") as f:
        json.dump({
            "images": [{
                "filename": "icon-1024.png",
                "idiom": "universal",
                "platform": "ios",
                "size": "1024x1024",
            }],
            "info": {"author": "xcode", "version": 1},
        }, f, indent=2)
        f.write("\n")
    print("wrote", name)


def write_preview(name, img):
    folder = os.path.join(ASSETS, f"IconPreview-{name}.imageset")
    os.makedirs(folder, exist_ok=True)
    img.resize((180, 180), Image.LANCZOS).save(os.path.join(folder, "preview.png"), optimize=True)
    with open(os.path.join(folder, "Contents.json"), "w") as f:
        json.dump({
            "images": [{"filename": "preview.png", "idiom": "universal", "scale": "3x"}],
            "info": {"author": "xcode", "version": 1},
        }, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    for name, spec in ICONS.items():
        img = render(spec)
        write_iconset(name, img)
        # SupporterIcon.previewAssetName: "AppIcon-Clear" -> "IconPreview-Clear"
        write_preview(name.removeprefix("AppIcon-"), img)
    shipped = Image.open(os.path.join(ASSETS, "AppIcon.appiconset", "icon-1024.png")).convert("RGB")
    write_preview("Standard", shipped)
