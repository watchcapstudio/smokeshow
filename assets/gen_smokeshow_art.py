#!/usr/bin/env python3
"""SMOKESHOW rating illustrations.
One Upper Midwest lake scene, five visibility states.
Painter's algorithm with interleaved haze layers = real atmospheric depth.
Layers back-to-front: sun, far hills, haze1, treeline, haze2, water+loon, haze3, dock+reeds, haze4.
"""
import random

W, H = 800, 500
INK = "#2B2620"
BG = "#F5F1E8"
SW = 3  # stroke width

random.seed(7)

# ---------- scene pieces (drawn once, reused across states) ----------

def sun(mode):
    # mode: crisp | soft | dim | faint | smudge
    cx, cy, r = 600, 105, 40
    if mode == "crisp":
        return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{INK}" stroke-width="{SW}"/>'
    fills = {"soft": ("#E8DFC9", 0.9), "dim": ("#DFC49A", 0.8),
             "faint": ("#CBAB84", 0.55), "smudge": ("#BFA284", 0.3)}
    f, op = fills[mode]
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{f}" fill-opacity="{op}" stroke="none"/>'

def far_hills():
    return (f'<path d="M 0 238 C 90 218, 170 226, 260 234 S 430 214, 540 228 '
            f'S 720 220, 800 232" fill="none" stroke="{INK}" stroke-width="{SW}" '
            f'stroke-linecap="round"/>')

def treeline():
    # jagged pine ridge along the far shore
    pts = []
    x = 0
    base = 292
    while x < W:
        h = random.choice([16, 22, 30, 36, 26, 18])
        w = h * 0.55
        pts.append(f"L {x + w/2:.0f} {base - h}")
        pts.append(f"L {x + w:.0f} {base}")
        x += w
    path = "M 0 " + str(base) + " " + " ".join(pts)
    trunks = ""
    for tx in (140, 470, 660):
        trunks += (f'<line x1="{tx}" y1="{base}" x2="{tx}" y2="{base-44}" '
                   f'stroke="{INK}" stroke-width="{SW-1}" stroke-linecap="round"/>'
                   f'<line x1="{tx}" y1="{base-30}" x2="{tx+12}" y2="{base-40}" '
                   f'stroke="{INK}" stroke-width="{SW-1}" stroke-linecap="round"/>')
    return (f'<path d="{path}" fill="none" stroke="{INK}" stroke-width="{SW-0.5}" '
            f'stroke-linejoin="round"/>' + trunks)

def water_and_loon():
    ripples = ""
    spots = [(70, 330, 60), (200, 352, 40), (330, 372, 74), (520, 340, 52),
             (640, 366, 44), (150, 400, 56), (430, 412, 66), (600, 430, 50),
             (90, 452, 44), (300, 448, 58), (700, 396, 40), (500, 470, 64)]
    for x, y, ln in spots:
        ripples += (f'<line x1="{x}" y1="{y}" x2="{x+ln}" y2="{y}" '
                    f'stroke="{INK}" stroke-width="{SW-1}" stroke-linecap="round"/>')
    # loon: low body, S-neck, dagger beak
    loon = (f'<g stroke="{INK}" stroke-width="{SW-0.5}" fill="none" stroke-linecap="round">'
            f'<path d="M 268 344 Q 292 356 322 344 L 310 338 Q 288 346 272 340 Z" fill="{INK}" stroke="none"/>'
            f'<path d="M 314 340 C 318 328, 314 320, 320 312 C 324 306, 330 306, 332 310"/>'
            f'<circle cx="329" cy="311" r="5" fill="{INK}" stroke="none"/>'
            f'<line x1="333" y1="310" x2="345" y2="308"/>'
            f'<line x1="252" y1="348" x2="268" y2="346"/>'
            f'<line x1="326" y1="348" x2="342" y2="347"/></g>')
    return ripples + loon

def dock_and_reeds():
    # dock running from bottom-left toward the water, two pilings, converging edges
    left_edge = "M 60 500 L 330 322"
    right_edge = "M 250 500 L 400 322"
    planks = ""
    steps = [(0.12, 0), (0.26, 0), (0.40, 0), (0.54, 0), (0.68, 0), (0.82, 0), (0.94, 0)]
    for t, _ in steps:
        x1 = 60 + (330 - 60) * t
        y1 = 500 + (322 - 500) * t
        x2 = 250 + (400 - 250) * t
        y2 = 500 + (322 - 500) * t
        planks += (f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" '
                   f'stroke="{INK}" stroke-width="{SW-1}" stroke-linecap="round"/>')
    pilings = (f'<line x1="332" y1="322" x2="332" y2="352" stroke="{INK}" stroke-width="{SW}" stroke-linecap="round"/>'
               f'<line x1="398" y1="322" x2="398" y2="352" stroke="{INK}" stroke-width="{SW}" stroke-linecap="round"/>'
               f'<ellipse cx="332" cy="356" rx="16" ry="4" fill="none" stroke="{INK}" stroke-width="{SW-1.5}"/>'
               f'<ellipse cx="398" cy="356" rx="16" ry="4" fill="none" stroke="{INK}" stroke-width="{SW-1.5}"/>')
    dock = (f'<path d="{left_edge}" fill="none" stroke="{INK}" stroke-width="{SW}" stroke-linecap="round"/>'
            f'<path d="{right_edge}" fill="none" stroke="{INK}" stroke-width="{SW}" stroke-linecap="round"/>'
            + planks + pilings)
    reeds = (f'<g stroke="{INK}" stroke-width="{SW-1}" fill="none" stroke-linecap="round">'
             f'<path d="M 730 500 C 726 452, 734 420, 728 392"/>'
             f'<path d="M 756 500 C 760 448, 750 416, 758 380"/>'
             f'<path d="M 782 500 C 778 456, 786 430, 780 404"/>'
             f'<rect x="723" y="376" width="9" height="22" rx="4" fill="{INK}" stroke="none"/>'
             f'<rect x="753" y="362" width="9" height="24" rx="4" fill="{INK}" stroke="none"/></g>')
    return dock + reeds

def haze(idx, opacity, tint):
    if opacity <= 0:
        return ""
    return (f'<defs><linearGradient id="hz{idx}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{tint}" stop-opacity="{opacity*0.55:.2f}"/>'
            f'<stop offset="0.45" stop-color="{tint}" stop-opacity="{opacity:.2f}"/>'
            f'<stop offset="1" stop-color="{tint}" stop-opacity="{opacity*0.7:.2f}"/>'
            f'</linearGradient></defs>'
            f'<rect x="0" y="0" width="{W}" height="{H}" fill="url(#hz{idx})"/>')

# ---------- states ----------
# (name, sun_mode, hills_op, h1, trees_op, h2, water_op, h3, dock_op, h4, tint)
STATES = [
    ("1-all-clear",            "crisp",  1.0, 0.00, 1.0, 0.00, 1.0, 0.00, 1.0, 0.00, "#C9C5BD"),
    ("2-somethings-in-the-air","soft",   0.5, 0.16, 0.9, 0.10, 1.0, 0.00, 1.0, 0.00, "#C9C5BD"),
    ("3-hazy",                 "dim",    0.15,0.34, 0.5, 0.22, 0.9, 0.10, 1.0, 0.00, "#C4B8A6"),
    ("4-heavy-haze",           "faint",  0.0, 0.55, 0.18,0.45, 0.5, 0.26, 1.0, 0.08, "#B3A48F"),
    ("5-smokeshow",            "smudge", 0.0, 0.75, 0.0, 0.68, 0.15,0.55, 0.9, 0.26, "#A79A88"),
]

pieces = {"hills": far_hills(), "trees": treeline(),
          "water": water_and_loon(), "dock": dock_and_reeds()}

for (name, sunmode, hop, h1, top, h2, wop, h3, dop, h4, tint) in STATES:
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">']
    svg.append(f'<rect width="{W}" height="{H}" fill="{BG}"/>')
    svg.append(sun(sunmode))
    svg.append(f'<g opacity="{hop}">{pieces["hills"]}</g>')
    svg.append(haze(1, h1, tint))
    svg.append(f'<g opacity="{top}">{pieces["trees"]}</g>')
    svg.append(haze(2, h2, tint))
    svg.append(f'<g opacity="{wop}">{pieces["water"]}</g>')
    svg.append(haze(3, h3, tint))
    svg.append(f'<g opacity="{dop}">{pieces["dock"]}</g>')
    svg.append(haze(4, h4, tint))
    svg.append('</svg>')
    with open(f'/home/claude/smokeshow-{name}.svg', 'w') as f:
        f.write("".join(svg))
    print(f'wrote smokeshow-{name}.svg')
