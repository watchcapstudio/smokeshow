// Experience scale, thresholds in PM2.5 µg/m³ (EPA breakpoints), visibility
// anchors calibrated against the published "5-3-1" wildfire-smoke visibility
// index used by Oregon/Utah/Nevada health agencies.
// Experience language rules: describe what MOST people notice, never what the
// reader WILL feel. Noses vary wildly, and fine particles can irritate with
// no campfire smell at all (dust, exhaust, aged smoke). Visibility is the one
// objective anchor everyone can check, so each level leads them to the window.
export const LEVELS = [
  {
    index: 0,
    key: 'all-clear',
    name: 'All clear',
    max: 12,
    visibility: '10+ miles',
    notice: 'No smoke to notice. Sky looks normal. You can see 10+ miles.',
  },
  {
    index: 1,
    key: 'something',
    name: 'In the air',
    max: 35,
    visibility: '5–10 miles',
    notice:
      'A faint campfire whiff for sensitive noses. Most people just see distant treelines go soft, roughly 5 to 10 miles of visibility.',
  },
  {
    index: 2,
    key: 'smells',
    name: 'Smells like fire',
    max: 55,
    visibility: '3–5 miles',
    notice:
      'Most people smell smoke outdoors, though not everyone. The sun can look orange at the edges, and visibility drops to roughly 3 to 5 miles. Long stretches outside may leave a scratchy throat.',
  },
  {
    index: 3,
    key: 'tastes',
    name: 'Tastes like fire',
    max: 150,
    visibility: '1.5–3 miles',
    notice:
      'Smoke often reaches indoors near windows. Eyes can sting. Visibility runs roughly 1.5 to 3 miles. A full day breathing this is on the order of smoking a few cigarettes.',
  },
  {
    index: 4,
    key: 'smokeshow',
    name: 'Smokeshow',
    max: Infinity,
    visibility: 'under 1.5 miles',
    notice:
      'Visibility under about 1.5 miles. Everything smells like a doused campfire, and fine ash is possible. Everyone inside, windows closed, run filtration if you have it.',
  },
];

// Shown at the lower smoke levels, where a reader's nose is most likely to
// disagree with the number. Turns a potential mismatch into a check they can
// run themselves instead of an argument.
export const NOSE_CAVEAT =
  'Noses differ, and fine particles can irritate without any smell. The honest test is visibility: how far can you see?';

// Explain-sheet ladder ranges, derived from LEVELS so the printed numbers
// can't drift from the thresholds that actually gate each level.
export const RANGES = LEVELS.map((l, i) => {
  const min = i === 0 ? 0 : LEVELS[i - 1].max;
  if (l.max === Infinity) return `${min}+`;
  return i === 0 ? `< ${l.max}` : `${min} – ${l.max}`;
});

// "What this is not" — one reassurance line per level, read in the explain
// sheet under the ladder. FLAG FOR HUMAN REVIEW: the "tastes" and
// "smokeshow" lines lean on cigarette-equivalent framing (backed by
// cigaretteEquivalent() below) to reassure a reader the air isn't as bad as
// it sounds — that's still a dose-response claim and may run afoul of the
// "no invented health dose-response claims" rule even though the ratio
// itself traces to a published rule of thumb.
export const NOT_LINES = [
  'No smoke story today. This is normal, clean air.',
  'A full day outside in this is nowhere near a cigarette. A faint whiff is the whole event for most people.',
  'Still well short of one cigarette over a full day outside. Most people notice it, and most plans can carry on.',
  "Now it adds up: a full day breathing this is on the order of a few cigarettes. Worth moving the run indoors.",
  'The heaviest level we track. Everyone inside, windows closed, filtration on if you have it.',
];

// EPA's Air Quality Index exertion guidance, one line per level — general
// population.
export const EPA_LINES = [
  "it's a great day to be active outside.",
  'unusually sensitive people should consider easing off long, hard exertion. Everyone else, carry on as usual.',
  'sensitive groups should cut back on long or heavy exertion. Everyone else, your usual outdoor plans are okay.',
  'sensitive groups should avoid prolonged exertion; everyone else, cut back on it.',
  'everyone should avoid outdoor exertion.',
];

// Same guidance, sensitive-household variant: asthma, young kids, older
// adults, pregnancy, heart or lung conditions — one level earlier than the
// general population line above.
export const EPA_SENS = [
  "it's a great day to be active outside.",
  'consider easing off long or hard exertion, and watch for symptoms.',
  'cut back on long or heavy exertion. Move the workout indoors if there is any wheeze.',
  'avoid prolonged exertion. Keep inhalers close; indoors with filtration is the good call.',
  'stay inside, windows closed, filtration on. This level is for no one.',
];

export const ARRIVAL_THRESHOLD = 35; // "Smells like fire" — the forecast-text anchor point
export const OLFACTORY_FATIGUE_LEVEL_INDEX = 3; // show the nose-fatigue caveat at "Tastes like fire" and above

export function levelForPM25(pm25) {
  if (pm25 == null || Number.isNaN(pm25)) return null;
  return LEVELS.find((l) => pm25 < l.max) ?? LEVELS[LEVELS.length - 1];
}

// Berkeley Earth rule of thumb: ~22 µg/m³ sustained over 24h ≈ one cigarette.
// Only meaningful — and only surfaced in the UI — at "Tastes like fire" and above.
export function cigaretteEquivalent(pm25Over24h) {
  return pm25Over24h / 22;
}

// The tone the ramp is validated against: CARTO dark_nolabels' land fill, the
// basemap SmokeMap paints under this layer. Every contrast number in
// scripts/smoke-ramp-audit.mjs is measured against it.
export const SMOKE_BASEMAP_RGB = [20, 23, 26];

// Translucent cool-gray -> warm ivory ramp, opacity rising with concentration.
// Not an AQI rainbow: this is meant to look like smoke, not a legend.
//
// Intensity rides BRIGHTNESS, because the basemap is dark. The earlier ramp
// darkened toward near-black as concentration rose, which on dark tiles peaked
// in contrast around 35 µg/m³ and then collapsed — the worst air on the map
// composited to rgb(26,21,15) against rgb(20,23,26) and became invisible.
// Pale-on-dark is also how smoke reads in GOES/VIIRS imagery and NOAA's own
// HRRR smoke products, so it still looks like smoke rather than a legend.
//
// Perceptually weighted: most of the visible ramp is spent below 55 µg/m³,
// because that's where most days actually live — a linear ramp made light
// haze invisible and the map looked frozen.
//
// Keep in sync with scripts/hrrr/render_frames.py; `npm run ramp` fails if the
// two drift, and proves the composite stays monotonic across the full range.
const SMOKE_STOPS = [
  { pm25: 0, rgb: [180, 186, 196], alpha: 0 },
  { pm25: 5, rgb: [190, 194, 200], alpha: 0.1 },
  { pm25: 12, rgb: [205, 206, 208], alpha: 0.24 },
  { pm25: 20, rgb: [218, 216, 212], alpha: 0.38 },
  { pm25: 35, rgb: [230, 226, 216], alpha: 0.52 },
  { pm25: 55, rgb: [240, 234, 220], alpha: 0.66 },
  { pm25: 150, rgb: [250, 244, 228], alpha: 0.82 },
  { pm25: 300, rgb: [255, 251, 240], alpha: 0.92 },
];

export const SMOKE_STOPS_FOR_AUDIT = SMOKE_STOPS;

// Numeric variant for per-pixel field rendering: [r, g, b, alpha 0-255].
export function smokeRGBA(pm25) {
  const v = Math.max(0, pm25 ?? 0);
  let lo = SMOKE_STOPS[0];
  let hi = SMOKE_STOPS[SMOKE_STOPS.length - 1];
  for (let i = 0; i < SMOKE_STOPS.length - 1; i++) {
    if (v >= SMOKE_STOPS[i].pm25 && v <= SMOKE_STOPS[i + 1].pm25) {
      lo = SMOKE_STOPS[i];
      hi = SMOKE_STOPS[i + 1];
      break;
    }
  }
  if (v >= SMOKE_STOPS[SMOKE_STOPS.length - 1].pm25) {
    lo = SMOKE_STOPS[SMOKE_STOPS.length - 2];
    hi = SMOKE_STOPS[SMOKE_STOPS.length - 1];
  }
  const span = hi.pm25 - lo.pm25 || 1;
  const t = Math.min(1, Math.max(0, (v - lo.pm25) / span));
  return [
    Math.round(lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * t),
    Math.round(lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * t),
    Math.round(lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * t),
    Math.round((lo.alpha + (hi.alpha - lo.alpha) * t) * 255),
  ];
}

export function smokeColorForPM25(pm25) {
  const [r, g, b, a] = smokeRGBA(pm25);
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

// Ash-grain speck: the stipple SmokeCanvasLayer sprinkles through the field so
// density changes read as texture rather than as a flat tint shift. It lives
// here, next to the ramp, because a speck is only "denser smoke" if it moves
// the SAME direction the ramp does — the old dark ramp got a darker speck, and
// under a pale ramp that same speck would read as a hole in the plume.
const ASH_SPECK_RGB = [255, 252, 246]; // the ramp's own bright end, pushed one notch
const ASH_SPECK_MIX = 0.22; // how far toward it a speck travels
const ASH_SPECK_ALPHA_GAIN = 1.3;
const ASH_SPECK_ALPHA_FLOOR = 18; // keeps a speck visible in thin haze

export function smokeSpeckRGBA(pm25) {
  const [r, g, b, a] = smokeRGBA(pm25);
  const lift = (c, i) => Math.round(c + (ASH_SPECK_RGB[i] - c) * ASH_SPECK_MIX);
  return [
    lift(r, 0),
    lift(g, 1),
    lift(b, 2),
    Math.min(255, Math.round(a * ASH_SPECK_ALPHA_GAIN + ASH_SPECK_ALPHA_FLOOR)),
  ];
}

// Screen-space grain colour for the HRRR image path, where the specks are a
// repeating pattern painted over an already-composited plume rather than
// per-pixel ramp samples. Same direction as smokeSpeckRGBA: toward the ramp's
// bright end, never back toward the basemap.
export const ASH_GRAIN_FILL = `rgba(${ASH_SPECK_RGB.join(', ')}, 0.5)`;

// Fraction of stipple cells that become specks at a given field opacity
// (0-1). Shared with the audit so the monotonicity proof measures the mix
// that actually paints, not the ramp in isolation.
export function ashSpeckFraction(alpha01) {
  return Math.min(0.16, alpha01 * 0.24);
}
