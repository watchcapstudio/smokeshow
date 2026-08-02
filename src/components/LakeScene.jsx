import './LakeScene.css';

// The five-state rating illustration as ONE parametric SVG (per the project
// CLAUDE.md: no static-file swaps). Geometry is lifted verbatim from
// assets/gen_smokeshow_art.py output; the STATES table below is that
// script's table, and props interpolate between rows so the scene hazes
// over continuously — including live while scrubbing the timeline.
const INK = '#2B2620';
const BG = '#F5F1E8';

// [hillsOp, haze1, treesOp, haze2, waterOp, haze3, dockOp, haze4, tint, sunFill, sunFillOp]
const STATES = [
  [1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, '#C9C5BD', '#E8DFC9', 0.0],
  [0.5, 0.16, 0.9, 0.1, 1.0, 0.0, 1.0, 0.0, '#C9C5BD', '#E8DFC9', 0.9],
  [0.15, 0.34, 0.5, 0.22, 0.9, 0.1, 1.0, 0.0, '#C4B8A6', '#DFC49A', 0.8],
  // h4 (the veil over the dock) strengthened at the top stages so the
  // foreground visibly participates in the progression too.
  [0.0, 0.55, 0.18, 0.45, 0.5, 0.26, 1.0, 0.12, '#B3A48F', '#CBAB84', 0.55],
  [0.0, 0.75, 0.0, 0.68, 0.15, 0.55, 0.8, 0.34, '#A79A88', '#BFA284', 0.3],
];
// PM2.5 anchor per state row (band midpoints; ramps saturate by 175).
const ANCHORS = [6, 23, 45, 100, 175];

const lerp = (a, b, t) => a + (b - a) * t;

function hexLerp(h1, h2, t) {
  const c1 = parseInt(h1.slice(1), 16);
  const c2 = parseInt(h2.slice(1), 16);
  const ch = (shift) =>
    Math.round(lerp((c1 >> shift) & 255, (c2 >> shift) & 255, t))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function paramsFor(pm25) {
  const v = Math.max(0, pm25 ?? 0);
  let i = 0;
  while (i < ANCHORS.length - 1 && v > ANCHORS[i + 1]) i++;
  const t =
    v <= ANCHORS[0]
      ? 0
      : Math.min(1, (v - ANCHORS[i]) / (ANCHORS[i + 1] - ANCHORS[i] || 1));
  const a = STATES[i];
  const b = STATES[Math.min(i + 1, STATES.length - 1)];
  return {
    hillsOp: lerp(a[0], b[0], t),
    h1: lerp(a[1], b[1], t),
    treesOp: lerp(a[2], b[2], t),
    h2: lerp(a[3], b[3], t),
    waterOp: lerp(a[4], b[4], t),
    h3: lerp(a[5], b[5], t),
    dockOp: lerp(a[6], b[6], t),
    h4: lerp(a[7], b[7], t),
    tint: hexLerp(a[8], b[8], t),
    sunFill: hexLerp(a[9], b[9], t),
    sunFillOp: lerp(a[10], b[10], t),
    sunStrokeOp: lerp(i === 0 ? 1 : 0, 0, t),
  };
}

const TREELINE_PATH =
  'M 0 292 L 8 262 L 16 292 L 23 270 L 29 292 L 38 256 L 48 292 L 53 274 L 58 292 L 63 276 L 67 292 L 72 276 L 76 292 L 83 266 L 90 292 L 95 276 L 99 292 L 107 262 L 116 292 L 123 266 L 130 292 L 134 276 L 139 292 L 146 266 L 153 292 L 159 270 L 165 292 L 169 276 L 174 292 L 178 276 L 183 292 L 193 256 L 202 292 L 212 256 L 222 292 L 227 276 L 231 292 L 237 270 L 243 292 L 248 276 L 252 292 L 259 266 L 266 292 L 276 256 L 286 292 L 290 276 L 295 292 L 302 266 L 309 292 L 314 276 L 318 292 L 324 270 L 330 292 L 335 274 L 340 292 L 345 274 L 350 292 L 357 266 L 364 292 L 369 276 L 373 292 L 380 266 L 387 292 L 394 266 L 402 292 L 411 256 L 421 292 L 426 276 L 430 292 L 436 270 L 442 292 L 447 276 L 451 292 L 458 266 L 465 292 L 471 270 L 477 292 L 486 262 L 494 292 L 504 256 L 514 292 L 520 270 L 526 292 L 533 266 L 540 292 L 545 276 L 549 292 L 556 266 L 563 292 L 571 262 L 580 292 L 587 266 L 594 292 L 599 274 L 604 292 L 610 270 L 616 292 L 620 276 L 625 292 L 632 266 L 639 292 L 646 266 L 653 292 L 658 274 L 663 292 L 669 270 L 675 292 L 684 262 L 692 292 L 696 276 L 701 292 L 708 266 L 715 292 L 720 274 L 725 292 L 729 276 L 734 292 L 741 266 L 748 292 L 752 276 L 757 292 L 764 266 L 771 292 L 777 270 L 783 292 L 793 256 L 803 292';

const RIPPLES = [
  [70, 330, 130], [200, 352, 240], [330, 372, 404], [520, 340, 572],
  [640, 366, 684], [150, 400, 206], [430, 412, 496], [600, 430, 650],
  [90, 452, 134], [300, 448, 358], [700, 396, 740], [500, 470, 564],
];

const PLANKS = [
  [92, 479, 268], [130, 454, 289], [168, 429, 310], [206, 404, 331],
  [244, 379, 352], [281, 354, 373], [314, 333, 391],
];

function Haze({ id, opacity, tint }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tint} stopOpacity="0.55" />
          <stop offset="0.45" stopColor={tint} stopOpacity="1" />
          <stop offset="1" stopColor={tint} stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <rect className="lake-scene__layer" x="0" y="0" width="800" height="500" fill={`url(#${id})`} opacity={opacity} />
    </>
  );
}

export default function LakeScene({ pm25 }) {
  const p = paramsFor(pm25);
  return (
    <div className="lake-scene" role="img" aria-label="Lake scene showing current smoke conditions">
      {/* viewBox trims dead sky above the sun; the container's aspect-ratio
          crops the bottom so the dock runs off-frame — 1/3 shorter without
          squashing the drawing. */}
      <svg viewBox="0 45 800 455" xmlns="http://www.w3.org/2000/svg">
        <rect width="800" height="500" fill={BG} />

        {/* sun: crisp outline crossfades into a hazy disc */}
        <circle className="lake-scene__layer" cx="600" cy="105" r="40" fill="none" stroke={INK} strokeWidth="3" opacity={p.sunStrokeOp} />
        <circle className="lake-scene__layer" cx="600" cy="105" r="40" fill={p.sunFill} opacity={p.sunFillOp} />

        <g className="lake-scene__layer" opacity={p.hillsOp}>
          <path d="M 0 238 C 90 218, 170 226, 260 234 S 430 214, 540 228 S 720 220, 800 232" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        </g>
        <Haze id="lake-hz1" opacity={p.h1} tint={p.tint} />

        <g className="lake-scene__layer" opacity={p.treesOp}>
          <path d={TREELINE_PATH} fill="none" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
          {[140, 470, 660].map((tx) => (
            <g key={tx} stroke={INK} strokeWidth="2" strokeLinecap="round">
              <line x1={tx} y1="292" x2={tx} y2="248" />
              <line x1={tx} y1="262" x2={tx + 12} y2="252" />
            </g>
          ))}
        </g>
        <Haze id="lake-hz2" opacity={p.h2} tint={p.tint} />

        <g className="lake-scene__layer" opacity={p.waterOp}>
          {RIPPLES.map(([x1, y, x2]) => (
            <line key={`${x1}-${y}`} x1={x1} y1={y} x2={x2} y2={y} stroke={INK} strokeWidth="2" strokeLinecap="round" />
          ))}
          <g stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round">
            <path d="M 268 344 Q 292 356 322 344 L 310 338 Q 288 346 272 340 Z" fill={INK} stroke="none" />
            <path d="M 314 340 C 318 328, 314 320, 320 312 C 324 306, 330 306, 332 310" />
            <circle cx="329" cy="311" r="5" fill={INK} stroke="none" />
            <line x1="333" y1="310" x2="345" y2="308" />
            <line x1="252" y1="348" x2="268" y2="346" />
            <line x1="326" y1="348" x2="342" y2="347" />
          </g>
        </g>
        <Haze id="lake-hz3" opacity={p.h3} tint={p.tint} />

        <g className="lake-scene__layer" opacity={p.dockOp}>
          <path d="M 60 500 L 330 322" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <path d="M 250 500 L 400 322" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          {PLANKS.map(([x1, y, x2]) => (
            <line key={y} x1={x1} y1={y} x2={x2} y2={y} stroke={INK} strokeWidth="2" strokeLinecap="round" />
          ))}
          <line x1="332" y1="322" x2="332" y2="352" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <line x1="398" y1="322" x2="398" y2="352" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <ellipse cx="332" cy="356" rx="16" ry="4" fill="none" stroke={INK} strokeWidth="1.5" />
          <ellipse cx="398" cy="356" rx="16" ry="4" fill="none" stroke={INK} strokeWidth="1.5" />
          <g stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round">
            <path d="M 730 500 C 726 452, 734 420, 728 392" />
            <path d="M 756 500 C 760 448, 750 416, 758 380" />
            <path d="M 782 500 C 778 456, 786 430, 780 404" />
            <rect x="723" y="376" width="9" height="22" rx="4" fill={INK} stroke="none" />
            <rect x="753" y="362" width="9" height="24" rx="4" fill={INK} stroke="none" />
          </g>
        </g>
        <Haze id="lake-hz4" opacity={p.h4} tint={p.tint} />
      </svg>
    </div>
  );
}
