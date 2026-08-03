// Smoke-ramp audit — the check that gates SMOKE_STOPS.
//
// The map's basemap is CARTO dark_nolabels. On a dark basemap a ramp that
// DARKENS with concentration hides the worst air on the map: the smoke and the
// tiles converge, contrast peaks somewhere in the middle of the scale and then
// collapses. That is exactly what the previous ramp did, and it is why this
// script exists rather than a comment.
//
// Three things are proved here, and any one of them failing exits non-zero:
//
//   1. MONOTONIC   composited contrast against the basemap rises across the
//                  whole 0-1000 µg/m³ range — more smoke is never less smoke.
//                  Measured on the flat ramp AND on the two textured paths
//                  that actually paint (per-pixel field stipple, HRRR
//                  screen-space grain), because a speck moving the wrong way
//                  would undo the ramp.
//   2. SEPARATED   each rating threshold lands a visible step above the last.
//   3. IN SYNC     scripts/smokefield/ramp.py's hand-copied NumPy ramp
//                  still matches SMOKE_STOPS. These two have drifted before.
//
// Contrast is WCAG 2.x relative-luminance ratio. It is not an accessibility
// claim about the plume — nobody has to read the smoke — it is just the
// standard, stable way to say "these two tones are distinguishable," and it
// lets the same number gate the chrome drawn on top.
//
// Run: node scripts/smoke-ramp-audit.mjs   (npm run ramp)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ASH_GRAIN_FILL,
  LEVELS,
  SMOKE_BASEMAP_RGB,
  SMOKE_STOPS_FOR_AUDIT as STOPS,
  ashSpeckFraction,
  smokeRGBA,
  smokeSpeckRGBA,
} from '../src/lib/rating.js';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- colour math

const toLinear = (c) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const ratioOfLum = (a, b) => {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};
const contrast = (fg, bg) => ratioOfLum(luminance(fg), luminance(bg));
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));

const BASE = SMOKE_BASEMAP_RGB;
const BASE_LUM = luminance(BASE);

// ------------------------------------------------------- the paths that paint

// 1. Flat: the ramp alone, which is what the HRRR PNGs carry and what the
//    field renders between specks.
function flatLum(pm) {
  const [r, g, b, a] = smokeRGBA(pm);
  return luminance(over([r, g, b], BASE, a / 255));
}

// 2. Field stipple (SmokeCanvasLayer._redraw): a fraction of block samples are
//    replaced wholesale by the speck colour+alpha. Mean luminance over a patch
//    is what the eye integrates at this scale.
function fieldLum(pm) {
  const [, , , a] = smokeRGBA(pm);
  const f = ashSpeckFraction(a / 255);
  const [sr, sg, sb, sa] = smokeSpeckRGBA(pm);
  const speck = luminance(over([sr, sg, sb], BASE, sa / 255));
  return (1 - f) * flatLum(pm) + f * speck;
}

// 3. HRRR screen-space grain (SmokeCanvasLayer._redrawImage): a repeating
//    pattern painted 'source-atop' over the composited plume. source-atop
//    keeps the destination's alpha and blends colour by the SOURCE alpha, so a
//    speck is the plume colour pulled toward the grain fill — at the plume's
//    own opacity. Coverage is 14% of 3x3 cells, each filled 2x2.
const GRAIN = (() => {
  const m = ASH_GRAIN_FILL.match(/rgba\(([^)]+)\)/);
  const [r, g, b, a] = m[1].split(',').map(Number);
  return { rgb: [r, g, b], alpha: a };
})();
const GRAIN_COVERAGE = 0.14 * (4 / 9);

function grainLum(pm) {
  const [r, g, b, a] = smokeRGBA(pm);
  const blended = [r, g, b].map((c, i) => c * (1 - GRAIN.alpha) + GRAIN.rgb[i] * GRAIN.alpha);
  const speck = luminance(over(blended, BASE, a / 255));
  return (1 - GRAIN_COVERAGE) * flatLum(pm) + GRAIN_COVERAGE * speck;
}

const PATHS = [
  { key: 'flat ramp', lum: flatLum, note: 'HRRR PNG frames, field between specks' },
  { key: 'field + stipple', lum: fieldLum, note: 'SmokeCanvasLayer per-pixel path' },
  { key: 'HRRR + grain', lum: grainLum, note: 'SmokeCanvasLayer screen-space path' },
];

// --------------------------------------------------- reference ramps, for why

// The demo's ramp and the ramp this branch replaces, both evaluated on the
// dark basemap. Kept here because the argument for the change is a
// measurement, and a measurement nobody can re-run is a rumour.
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function demoRamp(pm) {
  let c = lerp([150, 146, 138], [104, 74, 46], clamp01(pm / 55));
  c = lerp(c, [28, 20, 12], clamp01((pm - 55) / 150));
  const a =
    0.4 * clamp01((pm - 4) / 30) + 0.25 * clamp01((pm - 35) / 70) + 0.15 * clamp01((pm - 105) / 145);
  return { rgb: c, alpha: Math.min(0.85, a) };
}

const PREVIOUS_STOPS = [
  { pm25: 0, rgb: [205, 207, 210], alpha: 0 },
  { pm25: 3, rgb: [198, 200, 204], alpha: 0.07 },
  { pm25: 8, rgb: [192, 190, 188], alpha: 0.18 },
  { pm25: 12, rgb: [186, 180, 170], alpha: 0.27 },
  { pm25: 20, rgb: [176, 165, 146], alpha: 0.38 },
  { pm25: 35, rgb: [160, 140, 114], alpha: 0.5 },
  { pm25: 55, rgb: [126, 100, 78], alpha: 0.62 },
  { pm25: 150, rgb: [64, 50, 42], alpha: 0.78 },
  { pm25: 300, rgb: [20, 16, 15], alpha: 0.9 },
];

function sampleStops(stops, pm) {
  const v = Math.max(0, pm);
  const last = stops.length - 1;
  let lo = stops[0];
  let hi = stops[last];
  for (let i = 0; i < last; i++) {
    if (v >= stops[i].pm25 && v <= stops[i + 1].pm25) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  if (v >= stops[last].pm25) {
    lo = stops[last - 1];
    hi = stops[last];
  }
  const t = clamp01((v - lo.pm25) / (hi.pm25 - lo.pm25 || 1));
  return { rgb: lerp(lo.rgb, hi.rgb, t), alpha: lo.alpha + (hi.alpha - lo.alpha) * t };
}

const refRatio = (f) => (pm) => {
  const { rgb, alpha } = f(pm);
  return contrast(over(rgb, BASE, alpha), BASE);
};

// ------------------------------------------------------------------ the sweep

const SWEEP_MAX = 1000; // well past anything HRRR reports at the surface
const SWEEP_STEP = 0.1;
const COLUMNS = [0, 5, 12, 20, 35, 55, 150, 250, 300, 400, 600, 1000];

const pad = (s, w) => String(s).padEnd(w);
const col = (x) => x.toFixed(2).padStart(7);
const ratioAt = (lum) => (pm) => ratioOfLum(lum(pm), BASE_LUM);

function monotonicity(lum) {
  let prev = -Infinity;
  let worst = 0;
  let firstAt = null;
  let breaks = 0;
  const r = ratioAt(lum);
  for (let v = 0; v <= SWEEP_MAX; v = Number((v + SWEEP_STEP).toFixed(4))) {
    const cur = r(v);
    const drop = prev - cur;
    if (drop > 1e-9) {
      breaks++;
      if (firstAt === null) firstAt = v;
      worst = Math.max(worst, drop);
    }
    prev = cur;
  }
  return { breaks, firstAt, worst };
}

// ------------------------------------------------------------- python in sync

// The ramp used to live in render_frames.py. It now lives in one shared module
// that every renderer imports (HRRR over CONUS, CAMS globally), so there are
// still exactly two copies in the repo — this JS one and that Python one — no
// matter how many domains get rendered.
const PYTHON_RAMP = join(here, 'smokefield', 'ramp.py');

function pythonRamp() {
  const src = readFileSync(PYTHON_RAMP, 'utf8');
  const grab = (name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*np\\.array\\(\\[([^\\]]*)\\]`));
    if (!m) throw new Error(`smokefield/ramp.py: could not find ${name}`);
    return m[1].split(',').map((s) => Number(s.trim()));
  };
  return {
    stops: grab('STOPS'),
    r: grab('RAMP_R'),
    g: grab('RAMP_G'),
    b: grab('RAMP_B'),
    a: grab('RAMP_A'),
  };
}

function syncReport() {
  const py = pythonRamp();
  const problems = [];
  if (py.stops.length !== STOPS.length) {
    problems.push(`stop count: js ${STOPS.length}, py ${py.stops.length}`);
    return problems;
  }
  STOPS.forEach((s, i) => {
    const mismatch = [];
    if (py.stops[i] !== s.pm25) mismatch.push(`pm ${py.stops[i]} != ${s.pm25}`);
    ['r', 'g', 'b'].forEach((k, ch) => {
      if (py[k][i] !== s.rgb[ch]) mismatch.push(`${k} ${py[k][i]} != ${s.rgb[ch]}`);
    });
    // RAMP_A is written in 0-1 and scaled by 255 on the same line.
    if (Math.abs(py.a[i] - s.alpha) > 1e-9) mismatch.push(`a ${py.a[i]} != ${s.alpha}`);
    if (mismatch.length) problems.push(`stop ${i}: ${mismatch.join(', ')}`);
  });
  return problems;
}

// ----------------------------------------------------------------- the report

console.log(`\nSMOKESHOW smoke-ramp audit`);
console.log(`  basemap: CARTO dark_nolabels, rgb(${BASE.join(',')})`);
console.log(`  sweep:   0-${SWEEP_MAX} µg/m³ at ${SWEEP_STEP} steps\n`);

console.log(`composited contrast against the basemap`);
console.log(pad('ramp', 22) + COLUMNS.map((p) => String(p).padStart(7)).join(''));
console.log('-'.repeat(22 + 7 * COLUMNS.length));
console.log(pad('demo (reference)', 22) + COLUMNS.map((p) => col(refRatio(demoRamp)(p))).join(''));
console.log(
  pad('previous (replaced)', 22) +
    COLUMNS.map((p) => col(refRatio((v) => sampleStops(PREVIOUS_STOPS, v))(p))).join(''),
);
for (const p of PATHS) {
  console.log(pad(`shipped · ${p.key}`, 22) + COLUMNS.map((c) => col(ratioAt(p.lum)(c))).join(''));
}

console.log(`\n1. monotonicity`);
const monoFails = [];
for (const p of PATHS) {
  const m = monotonicity(p.lum);
  const ok = m.breaks === 0;
  if (!ok) monoFails.push(p.key);
  console.log(
    `   ${ok ? 'PASS' : 'FAIL'}  ${pad(p.key, 18)} ` +
      (ok
        ? `rises ${ratioAt(p.lum)(0).toFixed(2)} -> ${ratioAt(p.lum)(SWEEP_MAX).toFixed(2)}`
        : `${m.breaks} reversals, first at ${m.firstAt} µg/m³, worst drop ${m.worst.toFixed(3)}`) +
      `   (${p.note})`,
  );
}
// The same sweep on what we replaced, so the failure mode stays on the record.
const prevMono = monotonicity((pm) => {
  const { rgb, alpha } = sampleStops(PREVIOUS_STOPS, pm);
  return luminance(over(rgb, BASE, alpha));
});
console.log(
  `   ----  previous ramp     ${prevMono.breaks} reversals, first at ${prevMono.firstAt} µg/m³` +
    ` — the bug this replaces, kept as the control`,
);

console.log(`\n2. rating thresholds separate`);
// Each level's ceiling, plus a mid-band probe, must clear the one below it by a
// margin the eye can find. 15% of the ratio is roughly a just-noticeable step
// at these luminances.
const MIN_STEP = 1.15;
const probes = LEVELS.filter((l) => l.max !== Infinity).map((l) => ({ name: l.name, pm: l.max }));
probes.push({ name: 'Smokeshow', pm: 300 });
let sepFails = 0;
let prevRatio = ratioAt(flatLum)(0);
let prevName = 'clean air (0)';
for (const p of probes) {
  const r = ratioAt(flatLum)(p.pm);
  const step = r / prevRatio;
  const ok = step >= MIN_STEP;
  if (!ok) sepFails++;
  console.log(
    `   ${ok ? 'PASS' : 'FAIL'}  ${pad(`${p.name} @ ${p.pm}`, 26)} ${r.toFixed(2)}:1` +
      `  (x${step.toFixed(2)} over ${prevName})`,
  );
  prevRatio = r;
  prevName = p.name;
}

console.log(`\n3. smokefield/ramp.py in sync with SMOKE_STOPS`);
const drift = syncReport();
if (drift.length) for (const d of drift) console.log(`   FAIL  ${d}`);
else console.log(`   PASS  all ${STOPS.length} stops match`);

// Not a gate, but the number a reader will ask about: above the top stop the
// ramp is flat, so the map stops differentiating there. Printed so the ceiling
// is a decision on the record rather than a surprise during a smoke event.
const top = STOPS[STOPS.length - 1];
console.log(
  `\nceiling: the ramp saturates at ${top.pm25} µg/m³ (alpha ${top.alpha}); above that the map` +
    `\n  reads one flat tone and the verdict text carries the number. The previous ramp` +
    `\n  saturated the same way, so this is unchanged behaviour, not a regression.`,
);

const failures = [];
if (monoFails.length) failures.push(`monotonicity (${monoFails.join(', ')})`);
if (sepFails) failures.push(`threshold separation (${sepFails})`);
if (drift.length) failures.push('smokefield/ramp.py drift');
console.log(
  failures.length ? `\nFAIL: ${failures.join('; ')}\n` : `\nPASS: ramp is monotonic, separated, and in sync\n`,
);
process.exit(failures.length ? 1 : 0);
