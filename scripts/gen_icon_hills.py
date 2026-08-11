"""Smokeshow icon: smoky orange sun cresting the app's real ridgeline.

Hills are the exact far/near RidgeShape paths from
apple/Sources/SmokeshowKit/Design/RidgeShape.swift, feathered the same way
(dense at the crest, dissolving downward; far ridge more haze-eaten than near).
Sky + sun colors come from SkyScene.swift / sky.js.
"""
import math
from PIL import Image, ImageDraw, ImageFilter

S = 2048

# --- palette (app) ---
GOLD_ZEN = (126, 138, 168)
GOLD_HOR = (228, 172, 116)
SMK_HOR = (168, 116, 64)
SMK_MID = (124, 88, 52)
SMK_DK = (52, 37, 24)
INK = (30, 26, 20)            # RidgeShape inkTop
SUN_CORE = (255, 236, 196)    # hazy bright core
SUN_MID = (240, 150, 74)      # smoky orange body
SUN_EDGE = (206, 110, 48)     # dimmed red rim (sunDisc dim=1)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(stops, w=S, h=S):
    img = Image.new("RGB", (w, h))
    px = img.load()
    stops = sorted(stops)
    row = []
    for y in range(h):
        t = y / (h - 1)
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                row.append(lerp(c0, c1, (t - p0) / (p1 - p0)))
                break
        else:
            row.append(stops[-1][1])
    for y in range(h):
        c = row[y]
        for x in range(w):
            px[x, y] = c
    return img


def radial_sun(cx, cy, r_core, r_body, r_halo):
    """Smoky sun: bright core -> orange body -> soft red halo -> clear."""
    g = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    px = g.load()
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - cx, y - cy)
            if d >= r_halo:
                continue
            if d <= r_core:
                px[x, y] = SUN_CORE + (255,)
            elif d <= r_body:
                t = (d - r_core) / (r_body - r_core)
                px[x, y] = lerp(SUN_CORE, SUN_MID, t) + (255,)
            else:
                t = (d - r_body) / (r_halo - r_body)
                rgb = lerp(SUN_MID, SUN_EDGE, min(1, t * 1.3))
                a = round(255 * (1 - t) ** 1.6)
                px[x, y] = rgb + (a,)
    return g


# --- exact RidgeShape paths, 100x40 space ---
def qbez(p0, c, p1, n=24):
    pts = []
    for i in range(1, n + 1):
        t = i / n
        mt = 1 - t
        x = mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p1[0]
        y = mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p1[1]
        pts.append((x, y))
    return pts


FAR = [(0, 40), (0, 26)]
FAR += qbez((0, 26), (12, 13), (22, 20))
FAR += qbez((22, 20), (32, 27), (44, 11))
FAR += qbez((44, 11), (56, 1), (68, 16))
FAR += qbez((68, 16), (79, 27), (88, 17))
FAR += qbez((88, 17), (95, 12), (100, 20))
FAR += [(100, 40)]

NEAR = [(0, 40), (0, 33)]
NEAR += qbez((0, 33), (18, 24), (34, 30))
NEAR += qbez((34, 30), (48, 36), (62, 26))
NEAR += qbez((62, 26), (76, 17), (88, 28))
NEAR += qbez((88, 28), (95, 34), (100, 30))
NEAR += [(100, 40)]


def chaikin(top, iters):
    """Corner-cut the crest polyline to round sharp peaks."""
    for _ in range(iters):
        out = [top[0]]
        for i in range(len(top) - 1):
            p, q = top[i], top[i + 1]
            out.append((0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]))
            out.append((0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]))
        out.append(top[-1])
        top = out
    return top


def smooth_ridge(pts, iters):
    """Smooth only the top crest; keep the vertical sides + flat base."""
    top = chaikin(pts[1:-1], iters)
    return [pts[0]] + top + [pts[-1]]


FAR_RAW, NEAR_RAW = FAR, NEAR

# Map the 100x40 ridge box into the icon. Extend past the bottom so the
# ridges fill to the icon's lower edge; crest lands mid-lower.
BOX_TOP = 0.07 * S      # y=0 of ridge space
UNIT = 0.0245 * S       # px per ridge-space unit (40 units -> just past bottom)


def ridge_layer(pts, ink, base_alpha, blur, amp=1.0):
    # amp < 1 compresses each peak toward the base (y=40): gentler, rounder
    # hills instead of steep spikes.
    poly = [(x / 100 * S, BOX_TOP + (40 - (40 - y) * amp) * UNIT) for (x, y) in pts]
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    # feather: densest at crest (top of box), fades to nothing downward
    ramp = Image.new("L", (S, S), 0)
    rpx = ramp.load()
    top = BOX_TOP
    span = 40 * UNIT
    for y in range(S):
        t = (y - top) / span
        a = max(0.0, 1 - t) * base_alpha
        v = int(255 * min(1, max(0, a)))
        if v:
            for x in range(S):
                rpx[x, y] = v
    layer = Image.new("RGBA", (S, S), ink + (0,))
    # alpha = mask AND ramp
    from PIL import ImageChops
    alpha = ImageChops.multiply(mask, ramp)
    solid = Image.new("RGBA", (S, S), ink + (255,))
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    layer.paste(solid, (0, 0), alpha)
    if blur:
        layer = layer.filter(ImageFilter.GaussianBlur(blur))
    return layer


def build(name, sun_center, sun_r, sky_stops, far_a, near_a, far_ink, near_ink,
          smooth=3, far_blur=8, near_blur=5, amp=1.0):
    far = smooth_ridge(FAR_RAW, smooth)
    near = smooth_ridge(NEAR_RAW, smooth)
    sky = vgrad(sky_stops).convert("RGBA")
    sun = radial_sun(sun_center[0] * S, sun_center[1] * S,
                     sun_r[0] * S, sun_r[1] * S, sun_r[2] * S)
    sky.alpha_composite(sun)
    sky.alpha_composite(ridge_layer(far, far_ink, far_a, far_blur, amp))
    sky.alpha_composite(ridge_layer(near, near_ink, near_a, near_blur, amp))
    out = sky.convert("RGB").resize((1024, 1024), Image.LANCZOS)
    out.save(f"hills_{name}.png")
    print("wrote hills_%s.png" % name)


SKY = [
    (0.0, lerp(GOLD_ZEN, SMK_MID, 0.22)),
    (0.42, lerp(GOLD_HOR, SMK_HOR, 0.35)),
    (0.66, GOLD_HOR),
    (1.0, SMK_HOR),
]

SKY2 = [
    (0.0, lerp(GOLD_ZEN, SMK_MID, 0.3)),
    (0.45, lerp(GOLD_HOR, SMK_HOR, 0.5)),
    (0.7, lerp(GOLD_HOR, SMK_HOR, 0.2)),
    (1.0, lerp(SMK_HOR, SMK_DK, 0.25)),
]

# flat: low distant hills, sun well above
build("v2", (0.62, 0.40), (0.088, 0.165, 0.42), SKY2,
      far_a=0.55, near_a=0.95, far_ink=lerp(INK, SMK_DK, 0.4), near_ink=INK,
      smooth=6, far_blur=12, near_blur=8, amp=0.33)

# flatter still
build("v2soft", (0.62, 0.40), (0.088, 0.165, 0.42), SKY2,
      far_a=0.52, near_a=0.92, far_ink=lerp(INK, SMK_DK, 0.4), near_ink=INK,
      smooth=6, far_blur=14, near_blur=9, amp=0.24)
