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

// Translucent gray -> brown -> near-black ramp, opacity rising with concentration.
// Not an AQI rainbow: this is meant to look like smoke, not a legend.
// Perceptually weighted: most of the visible ramp is spent below 55 µg/m³,
// because that's where most days actually live — a linear ramp made light
// haze invisible and the map looked frozen. Keep in sync with
// scripts/hrrr/render_frames.py.
const SMOKE_STOPS = [
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
