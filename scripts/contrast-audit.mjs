// Contrast audit for the sky/ink system (branch B2).
//
// Sweeps every rating level against the full 24-hour solar cycle at a spread
// of latitudes and seasons, and measures — not assumes — the WCAG 2.x ratio of
// every foreground token against the actual gradient the CSS paints, at 41
// vertical samples of that gradient.
//
// Two passes:
//   demo   the demo's system as-is: flip ink at YIQ luma 0.42, no scrim
//   ship   what this branch ships: same flip, plus lib/ink.js's minimum scrim
//
// Run: node scripts/contrast-audit.mjs [--verbose]
import { skyFor } from '../src/lib/sky.js';
import {
  AA_BODY,
  DIM_ALPHA,
  SCRIM_MAX,
  composite,
  contrastRatio,
  hexToRgb,
  inkPlan,
  _internals,
} from '../src/lib/ink.js';

const { skyAt, stopLerp, SAMPLES } = _internals;
const verbose = process.argv.includes('--verbose');

// ---------------------------------------------------------------- the sweep

// One PM2.5 value per rating level (band midpoint) plus every band edge, where
// the sky changes fastest.
const LEVELS = [
  { name: 'All clear', pm: 6 },
  { name: 'In the air', pm: 23 },
  { name: 'Smells like fire', pm: 45 },
  { name: 'Tastes like fire', pm: 100 },
  { name: 'Smokeshow', pm: 220 },
];
const EDGES = [12, 35, 55, 150];

// Latitude/season pairs chosen to cover the altitude extremes the solar
// calculation can produce: tropical noon, mid-latitude both solstices, and a
// high-latitude summer where the demo's fixed 6am-9pm day is flat wrong.
const PLACES = [
  { name: 'Miami · Jun', lat: 25.8, lon: -80.2, date: '2026-06-21' },
  { name: 'Minneapolis · Jun', lat: 44.98, lon: -93.27, date: '2026-06-21' },
  { name: 'Minneapolis · Dec', lat: 44.98, lon: -93.27, date: '2026-12-21' },
  { name: 'Seattle · Sep', lat: 47.6, lon: -122.3, date: '2026-09-21' },
  { name: 'Fairbanks · Jun', lat: 64.84, lon: -147.72, date: '2026-06-21' },
  { name: 'Fairbanks · Dec', lat: 64.84, lon: -147.72, date: '2026-12-21' },
];

const STEP_MIN = 10; // sample the 24h cycle every 10 minutes

function* sweep() {
  const pms = [...LEVELS.map((l) => ({ ...l })), ...EDGES.map((pm) => ({ name: `edge ${pm}`, pm }))];
  for (const place of PLACES) {
    for (const level of pms) {
      for (let m = 0; m < 1440; m += STEP_MIN) {
        // Local wall clock -> UTC via the place's longitude (solar time is what
        // the sky actually keys off; a zone table would add nothing here).
        const utcMs =
          Date.parse(`${place.date}T00:00:00Z`) + m * 60_000 - (place.lon / 15) * 3_600_000;
        yield { place, level, minute: m, sky: skyFor(level.pm, new Date(utcMs), place.lat, place.lon) };
      }
    }
  }
}

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ------------------------------------------------------------- the surfaces

// Panels (`--bg-panel`) are the demo's cream sheet on light air and its ink
// counterpart on dark air. 0.72 is the lowest alpha at which card-borne type
// clears AA *without* the scrim's help (see the demo column): cards stay
// readable even if the scrim is ever suppressed, and the sky still tints
// through them.
const PANEL_LIGHT = hexToRgb('#FBF7EE');
const PANEL_DARK = hexToRgb('#1C1813');
const PANEL_ALPHA = 0.72;

// The static SEO block is a fixed cream sheet with its own scoped tokens — it
// does not flip with the air, so it is measured once, not swept.
const SHEET_BG = hexToRgb('#FBF7EE');
const SHEET_INK = hexToRgb('#26221B');
const SHEET = {
  bg: SHEET_BG,
  text: SHEET_INK,
  dim: composite(SHEET_INK, SHEET_BG, DIM_ALPHA),
  border: composite(SHEET_INK, SHEET_BG, 0.7),
  accent: hexToRgb('#8C3E10'),
};

function veiledSky(sky, scrim, inverseRGB, y) {
  const bg = skyAt(sky.zenithRGB, sky.midRGB, sky.horizonRGB, y);
  const a = scrim ? stopLerp(scrim[0], scrim[1], scrim[2], y) : 0;
  return a > 0 ? composite(inverseRGB, bg, a) : bg;
}

// `--border` draws the outline of every interactive control in the app, so it
// is sized to clear 1.4.11 on both the sky and a panel rather than to look
// like a hairline. `--rule` is the decorative divider that has no such job.
const BORDER_ALPHA = 0.7;
const RULE_ALPHA = 0.2;

// Every token, where it sits, and what it has to clear. Text is held to AA
// body (4.5:1). Anything that identifies a control or its state is held to the
// non-text 3:1 of WCAG 1.4.11. Purely decorative marks are measured and
// printed but do not gate — target null.
const TOKENS = [
  { key: 'sky/--text', target: AA_BODY, note: 'header, day strip, bare copy' },
  { key: 'sky/--text-dim', target: AA_BODY, note: 'secondary copy on the sky' },
  { key: 'panel/--text', target: AA_BODY, note: 'rating chip, day boxes, cards' },
  { key: 'panel/--text-dim', target: AA_BODY, note: 'card secondary copy' },
  { key: 'panel/--accent', target: AA_BODY, note: 'clear-line, carets, links' },
  { key: 'sky/--border', target: 3, note: 'control outlines on the sky' },
  { key: 'panel/--border', target: 3, note: 'control outlines on a card' },
  { key: 'sky/--accent', target: null, note: 'decorative on sky — see notes' },
  { key: 'panel vs sky', target: null, note: 'card fill; the outline carries it' },
  { key: 'panel/--rule', target: null, note: 'decorative divider' },
];
const KEYS = TOKENS.map((t) => t.key);
const TARGET = Object.fromEntries(TOKENS.map((t) => [t.key, t.target]));

function measure(sky, plan, scrim) {
  const ink = hexToRgb(plan.ink);
  const inverse = hexToRgb(plan.inkInverse);
  const accent = hexToRgb(plan.accent);
  const panelBase = plan.isDark ? PANEL_DARK : PANEL_LIGHT;

  const out = {};
  const worst = (key, fn) => {
    let m = Infinity;
    let at = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const y = i / (SAMPLES - 1);
      const r = fn(veiledSky(sky, scrim, inverse, y));
      if (r < m) {
        m = r;
        at = y;
      }
    }
    out[key] = { ratio: m, y: at };
  };

  worst('sky/--text', (bg) => contrastRatio(ink, bg));
  worst('sky/--text-dim', (bg) => contrastRatio(composite(ink, bg, DIM_ALPHA), bg));
  worst('sky/--accent', (bg) => contrastRatio(accent, bg));
  worst('sky/--border', (bg) => contrastRatio(composite(ink, bg, BORDER_ALPHA), bg));

  const onPanel = (fn) => (bg) => fn(composite(panelBase, bg, PANEL_ALPHA));
  worst('panel/--text', onPanel((p) => contrastRatio(ink, p)));
  worst('panel/--text-dim', onPanel((p) => contrastRatio(composite(ink, p, DIM_ALPHA), p)));
  worst('panel/--accent', onPanel((p) => contrastRatio(accent, p)));
  worst('panel/--border', onPanel((p) => contrastRatio(composite(ink, p, BORDER_ALPHA), p)));
  worst('panel/--rule', onPanel((p) => contrastRatio(composite(ink, p, RULE_ALPHA), p)));
  worst('panel vs sky', (bg) => contrastRatio(composite(panelBase, bg, PANEL_ALPHA), bg));
  return out;
}

// ----------------------------------------------------------------- the runs

const blank = () =>
  Object.fromEntries(KEYS.map((k) => [k, { ratio: Infinity, where: null, fails: 0 }]));

const demo = blank();
const ship = blank();
let n = 0;
let scrimPeak = 0;
let scrimmedFrames = 0;
const scrimHist = new Map();
const flips = [];
let prevDark = null;

for (const { place, level, minute, sky } of sweep()) {
  n++;
  const plan = inkPlan(sky);
  if (plan.scrimPeak > 0) scrimmedFrames++;
  scrimPeak = Math.max(scrimPeak, plan.scrimPeak);
  const bucket = plan.scrimPeak.toFixed(2);
  scrimHist.set(bucket, (scrimHist.get(bucket) ?? 0) + 1);

  const label = `${place.name} ${hhmm(minute)} · ${level.name}`;
  if (prevDark !== null && prevDark !== plan.isDark) flips.push({ label, plan, sky });
  prevDark = plan.isDark;

  for (const [target, scrim] of [
    [demo, null],
    [ship, plan.scrim],
  ]) {
    const m = measure(sky, plan, scrim);
    for (const k of KEYS) {
      if (m[k].ratio < target[k].ratio) {
        target[k].ratio = m[k].ratio;
        target[k].where = `${label} (y=${m[k].y.toFixed(2)})`;
      }
      if (TARGET[k] && m[k].ratio < TARGET[k]) target[k].fails++;
    }
  }
}

// -------------------------------------------------------------- the report

const pct = (x) => `${((100 * x) / n).toFixed(1)}%`;
const pad = (s, w) => String(s).padEnd(w);
const num = (x) => (x === Infinity ? '—' : x.toFixed(2));

console.log(`\nSMOKESHOW contrast audit — ${n.toLocaleString()} sky states`);
console.log(`  ${PLACES.length} lat/season pairs x ${LEVELS.length + EDGES.length} PM2.5 values`);
console.log(`  x 24h at ${STEP_MIN}-minute steps x ${SAMPLES} vertical gradient samples`);
console.log(`  target ${AA_BODY}:1 (WCAG 2.2 AA body text), --text-dim = ink at ${DIM_ALPHA} alpha\n`);

console.log(
  pad('token / surface', 20) + pad('need', 6) + pad('demo (no scrim)', 24) + pad('shipped (scrim)', 24) + 'used by',
);
console.log('-'.repeat(104));
for (const t of TOKENS) {
  const cell = (c) =>
    `${num(c.ratio)}:1  ${t.target ? (c.fails ? `fails ${pct(c.fails)}` : 'passes always') : ''}`;
  console.log(
    pad(t.key, 20) +
      pad(t.target ? `${t.target}:1` : '—', 6) +
      pad(cell(demo[t.key]), 24) +
      pad(cell(ship[t.key]), 24) +
      t.note,
  );
}

console.log(`\nworst cases (shipped):`);
for (const k of KEYS) {
  if (ship[k].where) console.log(`  ${pad(k, 20)} ${num(ship[k].ratio)}:1 @ ${ship[k].where}`);
}

// Fixed pairs — label colour printed on a solid --accent fill.
console.log(`\nlabels on a solid --accent fill:`);
for (const [air, accent, onAccent] of [
  ['light air', '#8C3E10', '#F4E9D6'],
  ['dark air', '#F0A468', '#26221B'],
]) {
  const legacy = contrastRatio(hexToRgb('#16130f'), hexToRgb(accent));
  const shipped = contrastRatio(hexToRgb(onAccent), hexToRgb(accent));
  console.log(
    `  ${pad(air, 12)} --on-accent ${onAccent} ${shipped.toFixed(2)}:1` +
      `   (legacy hard-coded #16130f: ${legacy.toFixed(2)}:1)`,
  );
}

console.log(`\nscrim: raised on ${pct(scrimmedFrames)} of states, peak alpha ${scrimPeak.toFixed(2)} (cap ${SCRIM_MAX})`);
const hist = [...scrimHist.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
for (const [a, c] of hist) console.log(`  alpha ${a}  ${pad(pct(c), 8)} ${'#'.repeat(Math.max(1, Math.round((60 * c) / n)))}`);

console.log(`\nink flips observed: ${flips.length}`);
if (verbose) for (const f of flips) console.log(`  ${f.label} -> ${f.plan.isDark ? 'cream' : 'ink'} scrim ${f.plan.scrim.map((x) => x.toFixed(2)).join('/')}`);

// The static SEO sheet: fixed colours, measured once.
console.log(`\nstatic SEO sheet (fixed cream #FBF7EE, does not flip):`);
for (const [name, c] of [
  ['--text', SHEET.text],
  ['--text-dim', SHEET.dim],
  ['--border', SHEET.border],
  ['--accent', SHEET.accent],
]) {
  console.log(`  ${pad(name, 20)} ${contrastRatio(c, SHEET.bg).toFixed(2)}:1`);
}

console.log(`
notes:
  --accent on the raw sky cannot reach AA at any scrim a sky would survive
  (it needs a background luminance of 0.583+, i.e. a near-opaque wash), so it
  is decorative there and every accent-coloured *string* sits on a panel:
  #map-slot is a sheet, which is what carries Scrubber's play control.
`);

const failed = TOKENS.filter((t) => t.target && ship[t.key].fails > 0);
console.log(
  failed.length
    ? `FAIL: ${failed.map((t) => `${t.key} (< ${t.target}:1)`).join(', ')} somewhere in the sweep\n`
    : `PASS: every token clears its target across the whole sweep\n`,
);
process.exit(failed.length ? 1 : 0);
