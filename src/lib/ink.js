// The ink system: which foreground colours the app uses on top of the live
// sky, and how much scrim it takes to keep them legible.
//
// The demo (public/ifhghs/demo/index.html:805) makes one decision — perceptual
// luminance of the mid-sky < 0.42 → cream text, else ink text — and stops
// there. Measured against WCAG, that single threshold leaves a band of skies
// where NEITHER ink passes AA:
//
//   ink  #26221B needs a background of relative luminance >= 0.2486 for 4.5:1
//   cream #F4E9D6 needs a background of relative luminance <= 0.1441 for 4.5:1
//
// Any sky landing between those two numbers is unreadable in both directions —
// and the demo's crossover sits right inside it (a sky at the 0.42 threshold
// has relative luminance ~0.147, giving 2.98:1 for ink and 4.43:1 for cream).
// So the flip alone cannot be the whole answer. This module keeps the demo's
// flip and adds the minimum scrim — a veil of the *opposite* ink, per gradient
// stop — that pulls the background back out of the dead band. It resolves to
// zero alpha whenever the raw sky already clears AA, which is most of the time.
//
// scripts/contrast-audit.mjs measures the result across all five rating levels
// and the full 24-hour cycle.

// ---------------------------------------------------------------- WCAG maths

// sRGB channel (0-255) -> linear light. Table, not pow(): inkPlan runs on
// every scrub frame and this is its inner loop.
const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  LINEAR[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

// WCAG 2.x relative luminance of an [r,g,b] triple (0-255 each). Distinct from
// sky.js's `lum()`, which is the demo's YIQ luma and drives the *flip*; this
// one drives the *measurement*.
export function relativeLuminance(rgb) {
  return (
    0.2126 * LINEAR[rgb[0] | 0] + 0.7152 * LINEAR[rgb[1] | 0] + 0.0722 * LINEAR[rgb[2] | 0]
  );
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return la > lb ? (la + 0.05) / (lb + 0.05) : (lb + 0.05) / (la + 0.05);
}

// Alpha-blend `fg` over `bg` in sRGB space — the same non-linear blend the
// browser does when it composites a translucent layer or translucent text.
export function composite(fg, bg, alpha) {
  return [
    Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
    Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
    Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
  ];
}

export function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbaCss = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

// ------------------------------------------------------------- the ink pair

export const INK_ON_LIGHT_AIR = '#26221B'; // demo:72
export const INK_ON_DARK_AIR = '#F4E9D6'; // demo:73
export const ACCENT_ON_LIGHT_AIR = '#8C3E10'; // demo:83  (.clearline)
export const ACCENT_ON_DARK_AIR = '#F0A468'; // demo:84  (.dark-air .clearline)

const INK_LIGHT_RGB = hexToRgb(INK_ON_LIGHT_AIR);
const INK_DARK_RGB = hexToRgb(INK_ON_DARK_AIR);

// Secondary type (`--text-dim`) is the ink at this alpha, and it — not full
// ink — is what sizes the scrim. The demo dims secondary type to 0.72-0.78;
// measured over the 24h x 5-level sweep, that costs a peak scrim of 0.74 and
// 0.60 alpha respectively, which stops reading as haze and starts reading as
// a modal overlay. 0.84 still reads as clearly secondary and drops the peak
// to 0.52. (Even fully opaque ink needs 0.38 somewhere, so some scrim is not
// optional — see scripts/contrast-audit.mjs.)
export const DIM_ALPHA = 0.84;

export const AA_BODY = 4.5; // WCAG 2.2 1.4.3, text under 18.66px bold / 24px

// Ceiling on the veil. The sweep peaks at 0.52 (dusk and dawn, where a bright
// horizon sits under a dark zenith), so this leaves headroom without letting
// an unforeseen sky wash the page out entirely.
export const SCRIM_MAX = 0.58;
const SCRIM_STEP = 0.02;

// Gradient sample positions: the CSS gradient is `zen 0% / mid 52% / hor 100%`
// (demo:789), so a sample is a straight lerp between the bracketing stops.
const MID_STOP = 0.52;
const SAMPLES = 41;

function skyAt(zen, mid, hor, y) {
  const [a, b, t] =
    y <= MID_STOP ? [zen, mid, y / MID_STOP] : [mid, hor, (y - MID_STOP) / (1 - MID_STOP)];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t));
}

function stopLerp(a0, a1, a2, y) {
  return y <= MID_STOP
    ? a0 + (a1 - a0) * (y / MID_STOP)
    : a1 + (a2 - a1) * ((y - MID_STOP) / (1 - MID_STOP));
}

// Does `ink` — at full strength and at DIM_ALPHA — clear `target` against a
// background of `bg` veiled with `alpha` of `veil`?
function passes(bg, ink, veil, alpha, target) {
  const veiled = alpha > 0 ? composite(veil, bg, alpha) : bg;
  // Full-strength ink is strictly easier than dim ink (dim is ink pulled
  // toward the background), so dim is the binding constraint — but check both
  // rather than relying on that being true for every colour pair.
  return (
    contrastRatio(ink, veiled) >= target &&
    contrastRatio(composite(ink, veiled, DIM_ALPHA), veiled) >= target
  );
}

// Smallest scrim alpha that makes `bg` carry `ink` at AA. Returns SCRIM_MAX if
// even that is not enough (the caller reports rather than silently accepting).
export function scrimAlphaFor(bg, ink, veil, target = AA_BODY) {
  for (let a = 0; a <= SCRIM_MAX + 1e-9; a += SCRIM_STEP) {
    if (passes(bg, ink, veil, a, target)) return Math.round(a * 100) / 100;
  }
  return SCRIM_MAX;
}

/**
 * The full foreground plan for one sky state.
 *
 * @param {object} sky  a `skyFor()` result from lib/sky.js
 * @returns {{
 *   isDark: boolean, ink: string, inkInverse: string, accent: string,
 *   onAccent: string, scrim: [number, number, number], scrimPeak: number,
 *   worstRatio: number
 * }}
 */
export function inkPlan(sky, target = AA_BODY) {
  const isDark = sky.isDark;
  const ink = isDark ? INK_DARK_RGB : INK_LIGHT_RGB;
  const veil = isDark ? INK_LIGHT_RGB : INK_DARK_RGB;
  const { zenithRGB: zen, midRGB: mid, horizonRGB: hor } = sky;

  const need = new Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const y = i / (SAMPLES - 1);
    need[i] = scrimAlphaFor(skyAt(zen, mid, hor, y), ink, veil, target);
  }

  const maxOver = (lo, hi) => {
    let m = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const y = i / (SAMPLES - 1);
      if (y >= lo - 1e-9 && y <= hi + 1e-9 && need[i] > m) m = need[i];
    }
    return m;
  };

  // Three stop alphas rather than one flat veil: a bright horizon under a dark
  // zenith only needs covering where it is bright. Each stop takes the peak
  // demand from the band it dominates.
  let a0 = maxOver(0, 0.3);
  let a1 = maxOver(0.2, 0.85);
  let a2 = maxOver(0.75, 1);

  // The alphas interpolate linearly between stops while the demand does not,
  // so verify the resulting curve covers every sample; fall back to a flat
  // veil at peak demand if it dips below anywhere.
  const covers = need.every((n, i) => stopLerp(a0, a1, a2, i / (SAMPLES - 1)) >= n - 1e-9);
  if (!covers) a0 = a1 = a2 = Math.max(a0, a1, a2, ...need);

  // Report what the plan actually achieves, worst sample.
  let worstRatio = Infinity;
  for (let i = 0; i < SAMPLES; i++) {
    const y = i / (SAMPLES - 1);
    const alpha = stopLerp(a0, a1, a2, y);
    const bg = skyAt(zen, mid, hor, y);
    const veiled = alpha > 0 ? composite(veil, bg, alpha) : bg;
    const dim = contrastRatio(composite(ink, veiled, DIM_ALPHA), veiled);
    const full = contrastRatio(ink, veiled);
    worstRatio = Math.min(worstRatio, dim, full);
  }

  return {
    isDark,
    ink: isDark ? INK_ON_DARK_AIR : INK_ON_LIGHT_AIR,
    inkInverse: isDark ? INK_ON_LIGHT_AIR : INK_ON_DARK_AIR,
    accent: isDark ? ACCENT_ON_DARK_AIR : ACCENT_ON_LIGHT_AIR,
    // Labels printed *on* a solid `--accent` fill. The accent flips with the
    // air, so the label has to flip the other way.
    onAccent: isDark ? INK_ON_LIGHT_AIR : INK_ON_DARK_AIR,
    scrim: [a0, a1, a2],
    scrimPeak: Math.max(a0, a1, a2),
    // The colour the sky IS at its top edge, scrim included — not the colour it
    // was authored as. iOS paints the page canvas into every strip no element
    // can reach: behind the status bar, behind the toolbar, in the rubber band.
    // That canvas has to carry this composited colour. Painted with the raw
    // zenith instead, it sat a full veil away from the sky it was supposed to
    // continue (0.36 of cream is ~60 levels), which is the blue band above and
    // below the sky that kept coming back every time the scrim moved.
    canvasTop: a0 > 0 ? composite(veil, zen, a0) : [...zen],
    worstRatio,
  };
}

// Exposed for the audit script so it measures the same geometry the CSS paints.
export const _internals = { skyAt, stopLerp, MID_STOP, SAMPLES };
