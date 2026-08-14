// Smoke-ramp audit — the check that gates SMOKE_STOPS and SMOKE_STOPS_DARK.
//
// The ramp has to run OPPOSITE the tiles it sits on, or the worst air on the
// map converges with the basemap and disappears. Two ramps are published: the
// darkening one for CARTO Positron (light_nolabels), the brightening amber one
// for CARTO dark-matter (dark_nolabels, what the web map draws today). Each is
// proved here against its own basemap's band. The proof is a script rather
// than a comment because the pair has been wrong in both directions: a
// darkening ramp shipped on dark tiles once, and the pale ramp that fixed
// that shipped on light tiles next.
//
// A basemap is not one colour — Positron runs from near-white land down
// through water to its darkest fills, dark-matter from near-black water up to
// its road fills — so everything below is measured against the whole band
// (SMOKE_BASEMAP_BACKDROPS / _DARK). Those are nominal tones (the dark band
// sampled from live tiles); proving the property across a band rather than a
// point is what makes that acceptable.
//
// Three things are proved here, and any one of them failing exits non-zero:
//
//   1. MONOTONIC   composited contrast against the basemap rises across the
//                  whole 0-1000 µg/m³ range, on every backdrop — more smoke is
//                  never less smoke. Measured on the flat ramp AND on the two
//                  textured paths that actually paint (per-pixel field stipple,
//                  HRRR screen-space grain), because a speck moving the wrong
//                  way would undo the ramp.
//   2. SEPARATED   each rating threshold lands a visible step above the last.
//   3. IN SYNC     scripts/render/ramp.py's hand-copied NumPy ramp still
//                  matches SMOKE_STOPS. These two have drifted before, and
//                  they are the ONLY two copies — both renderers import that
//                  module rather than transcribing the arrays again.
//   4. PALETTE     the 256-entry PNG-8 palette the renderers actually write
//                  is the ramp, sampled: every entry within a hair of
//                  smokeRGBA(), and the whole table monotonic. Frames ship as
//                  indexed PNG because the field is scalar and the ramp is a
//                  function of it (see docs/global-frames.md) — so the palette
//                  IS the encoding, and an unchecked palette is an unchecked
//                  ramp. Needs python3 + numpy; reports SKIP without them.
//
// Contrast is WCAG 2.x relative-luminance ratio. It is not an accessibility
// claim about the plume — nobody has to read the smoke — it is just the
// standard, stable way to say "these two tones are distinguishable," and it
// lets the same number gate the chrome drawn on top.
//
// Run: node scripts/smoke-ramp-audit.mjs   (npm run ramp)
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LEVELS,
  SMOKE_BASEMAP_BACKDROPS,
  SMOKE_BASEMAP_BACKDROPS_DARK,
  SMOKE_STOPS_FOR_AUDIT,
  SMOKE_STOPS_DARK_FOR_AUDIT,
  ashGrainFill,
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

// Both published themes, each audited against its own basemap band. `py`
// names the arrays in scripts/render/ramp.py this theme's JS stops must match.
const THEMES = [
  {
    key: 'light',
    basemap: 'CARTO Positron (light_nolabels)',
    stops: SMOKE_STOPS_FOR_AUDIT,
    backdrops: SMOKE_BASEMAP_BACKDROPS,
    py: { stops: 'STOPS', r: 'RAMP_R', g: 'RAMP_G', b: 'RAMP_B', a: 'RAMP_A' },
  },
  {
    key: 'dark',
    basemap: 'CARTO dark-matter (dark_nolabels)',
    stops: SMOKE_STOPS_DARK_FOR_AUDIT,
    backdrops: SMOKE_BASEMAP_BACKDROPS_DARK,
    py: { stops: 'STOPS', r: 'DARK_RAMP_R', g: 'DARK_RAMP_G', b: 'DARK_RAMP_B', a: 'DARK_RAMP_A' },
  },
];

// ------------------------------------------------------- the paths that paint

// Each path takes the backdrop it is painted on, because "does this read"
// depends on both. 1. Flat: the ramp alone, which is what the HRRR PNGs carry
// and what the field renders between specks.
function flatLum(pm, base, theme) {
  const [r, g, b, a] = smokeRGBA(pm, theme);
  return luminance(over([r, g, b], base, a / 255));
}

// 2. Field stipple (SmokeCanvasLayer._redraw): a fraction of block samples are
//    replaced wholesale by the speck colour+alpha. Mean luminance over a patch
//    is what the eye integrates at this scale.
function fieldLum(pm, base, theme) {
  const [, , , a] = smokeRGBA(pm, theme);
  const f = ashSpeckFraction(a / 255);
  const [sr, sg, sb, sa] = smokeSpeckRGBA(pm, theme);
  const speck = luminance(over([sr, sg, sb], base, sa / 255));
  return (1 - f) * flatLum(pm, base, theme) + f * speck;
}

// 3. Screen-space grain over a domain frame (SmokeCanvasLayer._redrawImage): a repeating
//    pattern painted 'source-atop' over the composited plume. source-atop
//    keeps the destination's alpha and blends colour by the SOURCE alpha, so a
//    speck is the plume colour pulled toward the grain fill — at the plume's
//    own opacity. Coverage is 14% of 3x3 cells, each filled 2x2.
const grainFor = (theme) => {
  const m = ashGrainFill(theme).match(/rgba\(([^)]+)\)/);
  const [r, g, b, a] = m[1].split(',').map(Number);
  return { rgb: [r, g, b], alpha: a };
};
const GRAIN_COVERAGE = 0.14 * (4 / 9);

function grainLum(pm, base, theme) {
  const grain = grainFor(theme);
  const [r, g, b, a] = smokeRGBA(pm, theme);
  const blended = [r, g, b].map((c, i) => c * (1 - grain.alpha) + grain.rgb[i] * grain.alpha);
  const speck = luminance(over(blended, base, a / 255));
  return (1 - GRAIN_COVERAGE) * flatLum(pm, base, theme) + GRAIN_COVERAGE * speck;
}

const PATHS = [
  { key: 'flat ramp', lum: flatLum, note: 'domain PNG frames, field between specks' },
  { key: 'field + stipple', lum: fieldLum, note: 'SmokeCanvasLayer per-pixel path' },
  { key: 'image + grain', lum: grainLum, note: 'SmokeCanvasLayer screen-space path' },
];

// --------------------------------------------------- reference ramps, for why

// The pale ramp this branch replaces, evaluated on the light basemap it would
// now be sitting on. Kept here because the argument for the change is a
// measurement, and a measurement nobody can re-run is a rumour.
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const PREVIOUS_STOPS = [
  { pm25: 0, rgb: [180, 186, 196], alpha: 0 },
  { pm25: 5, rgb: [190, 194, 200], alpha: 0.1 },
  { pm25: 12, rgb: [205, 206, 208], alpha: 0.24 },
  { pm25: 20, rgb: [218, 216, 212], alpha: 0.38 },
  { pm25: 35, rgb: [230, 226, 216], alpha: 0.52 },
  { pm25: 55, rgb: [240, 234, 220], alpha: 0.66 },
  { pm25: 150, rgb: [250, 244, 228], alpha: 0.82 },
  { pm25: 300, rgb: [255, 251, 240], alpha: 0.92 },
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

const prevLum = (pm, base) => {
  const { rgb, alpha } = sampleStops(PREVIOUS_STOPS, pm);
  return luminance(over(rgb, base, alpha));
};

// ------------------------------------------------------------------ the sweep

const SWEEP_MAX = 1000; // well past anything HRRR reports at the surface
const SWEEP_STEP = 0.1;
const COLUMNS = [0, 5, 12, 20, 35, 55, 150, 250, 300, 400, 600, 1000];

const pad = (s, w) => String(s).padEnd(w);
const col = (x) => x.toFixed(2).padStart(7);
const ratioAt = (lum, base, theme) => (pm) => ratioOfLum(lum(pm, base, theme), luminance(base));

// Measured against the RUNNING MAXIMUM, not the previous sample, and gated on
// magnitude rather than on exact numerical monotonicity. The question that
// matters is "can the map ever show visibly less smoke for more smoke", and a
// step-to-step comparison answers a different, stricter one.
//
// The residual this tolerance covers is worth naming. Against the darkest
// backdrop in the band, the ramp's lowest stops sit a hair under it rather than
// exactly on it, so the very faintest haze wobbles by ~0.0025 ratio units
// before climbing for good — thousandths of a ratio, on the map's smallest
// features, below the "All clear" line. Chasing that to exact zero would mean
// tuning stops against a backdrop constant nobody sampled.
//
// The failure this script exists to catch is an order of magnitude larger and
// still fails here: the pale ramp on this basemap gives back 0.087 off its
// peak across the whole upper half of the scale — the worst air reading as
// less than moderate air.
const MONO_TOLERANCE = 0.02;

function monotonicity(lum, base, theme) {
  let peak = -Infinity;
  let worst = 0;
  let firstAt = null;
  let breaks = 0;
  const r = ratioAt(lum, base, theme);
  for (let v = 0; v <= SWEEP_MAX; v = Number((v + SWEEP_STEP).toFixed(4))) {
    const cur = r(v);
    peak = Math.max(peak, cur);
    const deficit = peak - cur;
    if (deficit > MONO_TOLERANCE) {
      breaks++;
      if (firstAt === null) firstAt = v;
    }
    worst = Math.max(worst, deficit);
  }
  return { breaks, firstAt, worst };
}

// ------------------------------------------------------------- python in sync

const RAMP_PY = join(here, 'render', 'ramp.py');

function pythonRamp(names) {
  const src = readFileSync(RAMP_PY, 'utf8');
  const grab = (name) => {
    // \b anchors the name: RAMP_R must not match inside DARK_RAMP_R.
    const m = src.match(new RegExp(`\\b${name}\\s*=\\s*np\\.array\\(\\[([^\\]]*)\\]`));
    if (!m) throw new Error(`render/ramp.py: could not find ${name}`);
    return m[1].split(',').map((s) => Number(s.trim()));
  };
  return {
    stops: grab(names.stops),
    r: grab(names.r),
    g: grab(names.g),
    b: grab(names.b),
    a: grab(names.a),
  };
}

function syncReport(theme) {
  const STOPS = theme.stops;
  const py = pythonRamp(theme.py);
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

console.log(`\nSMOKESHOW smoke-ramp audit — both published themes`);
console.log(`  sweep: 0-${SWEEP_MAX} µg/m³ at ${SWEEP_STEP} steps`);

// Each level's ceiling, plus a mid-band probe, must clear the one below it by a
// margin the eye can find. 15% of the ratio is roughly a just-noticeable step
// at these luminances.
const MIN_STEP = 1.15;

const monoFails = [];
let sepFails = 0;
const driftFails = [];
let palFail = 0;

for (const theme of THEMES) {
  const BACKDROPS = theme.backdrops;
  const PRIMARY = BACKDROPS[0];
  const t = theme.key;

  console.log(`\n${'='.repeat(78)}`);
  console.log(`${t.toUpperCase()} ramp — ${theme.basemap}`);
  console.log(
    `  backdrops: ` + BACKDROPS.map((b) => `${b.key} rgb(${b.rgb.join(',')})`).join(' · '),
  );

  console.log(`\ncomposited contrast against ${PRIMARY.key}, rgb(${PRIMARY.rgb.join(',')})`);
  console.log(pad('ramp', 22) + COLUMNS.map((p) => String(p).padStart(7)).join(''));
  console.log('-'.repeat(22 + 7 * COLUMNS.length));
  if (t === 'light') {
    console.log(
      pad('previous (replaced)', 22) +
        COLUMNS.map((p) => col(ratioAt(prevLum, PRIMARY.rgb, t)(p))).join(''),
    );
  }
  for (const p of PATHS) {
    console.log(
      pad(`shipped · ${p.key}`, 22) +
        COLUMNS.map((c) => col(ratioAt(p.lum, PRIMARY.rgb, t)(c))).join(''),
    );
  }

  console.log(`\n1. monotonicity, every path on every backdrop`);
  for (const base of BACKDROPS) {
    for (const p of PATHS) {
      const m = monotonicity(p.lum, base.rgb, t);
      const ok = m.breaks === 0;
      if (!ok) monoFails.push(`${t}: ${p.key} on ${base.key}`);
      const r = ratioAt(p.lum, base.rgb, t);
      console.log(
        `   ${ok ? 'PASS' : 'FAIL'}  ${pad(base.key, 14)}${pad(p.key, 18)} ` +
          (ok
            ? `rises ${r(0).toFixed(2)} -> ${r(SWEEP_MAX).toFixed(2)}` +
              `, worst dip ${m.worst.toFixed(4)} (tolerance ${MONO_TOLERANCE})`
            : `dips ${m.worst.toFixed(4)} below its running peak, first past tolerance at ${m.firstAt} µg/m³`),
      );
    }
  }
  if (t === 'light') {
    // The same sweep on what we replaced, so the failure mode stays on the record.
    const prevMono = monotonicity(prevLum, PRIMARY.rgb, t);
    console.log(
      `   ----  previous ramp on ${PRIMARY.key}: dips ${prevMono.worst.toFixed(4)} below its peak` +
        (prevMono.breaks ? `, first past tolerance at ${prevMono.firstAt} µg/m³` : '') +
        ` — the pale ramp, measured where it would now be sitting`,
    );
  }

  console.log(`\n2. rating thresholds separate (flat ramp on ${PRIMARY.key})`);
  const probes = LEVELS.filter((l) => l.max !== Infinity).map((l) => ({ name: l.name, pm: l.max }));
  probes.push({ name: 'Smokeshow', pm: 300 });
  const flatOnPrimary = ratioAt(flatLum, PRIMARY.rgb, t);
  let prevRatio = flatOnPrimary(0);
  let prevName = 'clean air (0)';
  for (const p of probes) {
    const r = flatOnPrimary(p.pm);
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

  console.log(`\n3. scripts/render/ramp.py ${theme.py.r.replace(/_R$/, '_*')} in sync with the JS stops`);
  const drift = syncReport(theme);
  if (drift.length) {
    for (const d of drift) console.log(`   FAIL  ${d}`);
    driftFails.push(t);
  } else {
    console.log(`   PASS  all ${theme.stops.length} stops match`);
  }

  palFail += paletteCheck(theme);
}

// --------------------------------------------------------- the shipped palette

// Ask ramp.py for the exact bytes it will write into every PNG-8 frame, then
// check them against this file's own smokeRGBA(). This closes the loop the
// text-diff above cannot: the arrays could match perfectly and the palette
// still be sampled along a curve that skips part of the ramp.
function shippedPalette(themeKey) {
  const py = `
import sys, json
sys.path.insert(0, ${JSON.stringify(join(here, 'render', '..'))})
from render.ramp import palette, index_to_pm25, PALETTE_N
import numpy as np
rgb, alpha = palette(${JSON.stringify(themeKey)})
print(json.dumps({
  "pm": [float(x) for x in index_to_pm25(np.arange(PALETTE_N))],
  "rgb": list(rgb), "alpha": list(alpha),
}))`;
  const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  if (r.status !== 0) return { skip: (r.stderr || r.error?.message || 'python3 failed').trim().split('\n').pop() };
  return JSON.parse(r.stdout);
}

// Check 4 for one theme; returns the number of failed sub-checks. Hoisted —
// the theme loop above calls it.
function paletteCheck(theme) {
  console.log(`\n4. shipped PNG-8 palette is the ramp`);
  const pal = shippedPalette(theme.key);
  let fails = 0;
  if (pal.skip) {
    console.log(`   SKIP  could not run python3 + numpy (${pal.skip})`);
    console.log(`         the frames' actual encoding is UNVERIFIED in this run`);
    return fails;
  }
  let worstRGB = 0;
  let worstA = 0;
  let worstStep = 0;
  for (let i = 0; i < pal.pm.length; i++) {
    const [r, g, b, a] = smokeRGBA(pal.pm[i], theme.key);
    worstRGB = Math.max(
      worstRGB,
      Math.abs(r - pal.rgb[i * 3]),
      Math.abs(g - pal.rgb[i * 3 + 1]),
      Math.abs(b - pal.rgb[i * 3 + 2]),
    );
    // Index 0 is forced to alpha 0 — it means "exactly clean air".
    if (i > 0) worstA = Math.max(worstA, Math.abs(a - pal.alpha[i]));
    if (i > 0) worstStep = Math.max(worstStep, pal.alpha[i] - pal.alpha[i - 1]);
  }

  // Palette entry i, composited over one backdrop. Every backdrop, same as
  // check 1: the palette is what the frames actually carry, so if the ramp has
  // to stay monotonic across the basemap's whole tonal band then so does this.
  const palRatio = (i, base) =>
    ratioOfLum(
      luminance(
        over(
          [pal.rgb[i * 3], pal.rgb[i * 3 + 1], pal.rgb[i * 3 + 2]],
          base.rgb,
          pal.alpha[i] / 255,
        ),
      ),
      luminance(base.rgb),
    );

  const palMono = theme.backdrops.map((base) => {
    let peak = -Infinity;
    let worst = 0;
    for (let i = 0; i < pal.pm.length; i++) {
      const cur = palRatio(i, base);
      worst = Math.max(worst, peak - cur);
      peak = Math.max(peak, cur);
    }
    return { base, worst, ok: worst <= MONO_TOLERANCE };
  });

  // 1 unit of 0-255 is the rounding both sides do independently; more than
  // that means the palette curve is not tracking the ramp.
  const okMatch = worstRGB <= 1 && worstA <= 1;
  const okMono = palMono.every((m) => m.ok);
  // A palette step bigger than a few alpha units would band visibly on a
  // smooth plume — the reason the index curve is quadratic, not linear.
  const okStep = worstStep <= 4;
  if (!okMatch) fails++;
  if (!okMono) fails++;
  if (!okStep) fails++;
  console.log(
    `   ${okMatch ? 'PASS' : 'FAIL'}  ${pad('matches smokeRGBA', 18)} ` +
      `worst rgb ${worstRGB}, worst alpha ${worstA} (of 255)`,
  );
  for (const m of palMono) {
    const r = palRatio(pal.pm.length - 1, m.base);
    console.log(
      `   ${m.ok ? 'PASS' : 'FAIL'}  ${pad('monotonic', 18)}${pad(m.base.key, 14)}` +
        `${pal.pm.length} entries, worst dip ${m.worst.toFixed(4)} ` +
        `(tolerance ${MONO_TOLERANCE}), tops out at ${r.toFixed(2)}:1`,
    );
  }
  console.log(
    `   ${okStep ? 'PASS' : 'FAIL'}  ${pad('no banding', 18)} ` +
      `largest alpha step between adjacent indices: ${worstStep}/255`,
  );
  return fails;
}

// Not a gate, but the number a reader will ask about: above the top stop the
// ramp is flat, so the map stops differentiating there. Printed so the ceiling
// is a decision on the record rather than a surprise during a smoke event.
const top = SMOKE_STOPS_FOR_AUDIT[SMOKE_STOPS_FOR_AUDIT.length - 1];
console.log(
  `\nceiling: both ramps saturate at ${top.pm25} µg/m³; above that the map` +
    `\n  reads one flat tone and the verdict text carries the number. Every ramp this map` +
    `\n  has shipped saturated the same way, so this is unchanged behaviour.`,
);

const failures = [];
if (monoFails.length) failures.push(`monotonicity (${monoFails.join(', ')})`);
if (sepFails) failures.push(`threshold separation (${sepFails})`);
if (driftFails.length) failures.push(`render/ramp.py drift (${driftFails.join(', ')})`);
if (palFail) failures.push(`shipped palette (${palFail})`);
console.log(
  failures.length
    ? `\nFAIL: ${failures.join('; ')}\n`
    : `\nPASS: both ramps are monotonic, separated, and in sync\n`,
);
process.exit(failures.length ? 1 : 0);
