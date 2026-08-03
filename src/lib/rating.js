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
// sheet under the ladder.
//
// Cigarette framing appears at "Tastes like fire" only, per the rule at
// cigaretteEquivalent() below. It used to appear at levels 1 and 2 as well,
// where it was not just off-policy but arithmetically wrong: against the
// Berkeley Earth ratio a full day at the top of "In the air" is ~1.6
// cigarettes, and the whole of "Smells like fire" runs 1.6–2.5 — so
// "nowhere near a cigarette" and "well short of one cigarette" understated
// the exposure by roughly 2x, in the reassuring direction. Those two lines
// now reassure without quantifying. If you reintroduce a dose number at any
// level, check it against cigaretteEquivalent() at BOTH ends of the band.
export const NOT_LINES = [
  'No smoke story today. This is normal, clean air.',
  'A faint whiff is the whole event for most people. Nothing here needs a change of plan.',
  'Most people notice it outdoors, and most plans can carry on. Long stretches outside are where it starts to add up.',
  'Now it adds up: a full day breathing this is on the order of a few cigarettes. Worth moving the run indoors.',
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

// The tones the ramp is validated against. The basemap is CARTO Positron
// (light_nolabels), so the backdrop under the smoke is not one colour — it is
// a band running from near-white land down through water to the darkest fills
// the style paints. `npm run ramp` proves the ramp holds across all of them.
//
// These are the style's nominal tones, not pixels sampled from live tiles.
// That is deliberate: proving the property across the band is stronger than
// pinning it to one guessed constant, and a darkening ramp that stays
// monotonic against the DARKEST backdrop here is monotonic against every
// lighter one (a lighter backdrop only steepens the drop and raises the
// ratio at every concentration).
export const SMOKE_BASEMAP_BACKDROPS = [
  { key: 'land', rgb: [242, 240, 236] },
  { key: 'water', rgb: [202, 210, 211] },
  { key: 'darkest fill', rgb: [176, 180, 182] },
];

// The headline backdrop — Positron's land fill, what most of the map is.
export const SMOKE_BASEMAP_RGB = SMOKE_BASEMAP_BACKDROPS[0].rgb;

// Translucent gray -> brown -> near-black ramp, opacity rising with
// concentration. Not an AQI rainbow: this is meant to look like smoke, not a
// legend.
//
// Intensity rides DARKNESS, because the basemap is light. A brightening ramp
// is the right call on dark tiles — it is how smoke reads in GOES/VIIRS and
// NOAA's HRRR smoke products — but on Positron it inverts the meaning: pale
// smoke over near-white land converges with the basemap and the worst air on
// the map disappears. The ramp has to run opposite the tiles it sits on, and
// the tiles are light again.
//
// Perceptually weighted: most of the visible ramp is spent below 55 µg/m³,
// because that's where most days actually live — a linear ramp made light
// haze invisible and the map looked frozen.
//
// Keep in sync with scripts/hrrr/render_frames.py; `npm run ramp` fails if the
// two drift, and proves the composite stays monotonic across the full range.
// The low end is pulled a notch darker than the ramp this restores. That ramp
// opened at rgb(205,207,210), a gray LIGHTER than the darkest tone the basemap
// paints — so over those fills, faint haze brightened before the ramp took
// over and darkened, and the composite humped instead of climbing. It was
// invisible on OSM's busier tiles, which is where that low end was tuned.
// Capping every stop at or below the darkest backdrop's luminance removes it,
// and makes light haze read a little more clearly on open land besides.
const SMOKE_STOPS = [
  { pm25: 0, rgb: [186, 188, 192], alpha: 0 },
  { pm25: 3, rgb: [180, 182, 186], alpha: 0.07 },
  { pm25: 8, rgb: [176, 174, 172], alpha: 0.18 },
  { pm25: 12, rgb: [172, 166, 156], alpha: 0.27 },
  { pm25: 20, rgb: [166, 155, 136], alpha: 0.38 },
  { pm25: 35, rgb: [155, 136, 110], alpha: 0.5 },
  { pm25: 55, rgb: [126, 100, 78], alpha: 0.62 },
  { pm25: 150, rgb: [64, 50, 42], alpha: 0.78 },
  { pm25: 300, rgb: [20, 16, 15], alpha: 0.9 },
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
// the SAME direction the ramp does — a speck that runs the other way reads as
// a hole punched in the plume. The ramp darkens, so the speck darkens.
const ASH_SPECK_RGB = [12, 9, 8]; // the ramp's own dark end, pushed one notch
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
// per-pixel ramp samples. Same direction as smokeSpeckRGBA — toward the ramp's
// dark end, never back toward the basemap — but a warm ash brown rather than
// the speck's near-black: 'source-atop' blends this into the plume at the
// plume's own alpha, so it lands on top of thin haze too, where near-black
// would read as dirt rather than texture.
const ASH_GRAIN_RGB = [45, 35, 28];
export const ASH_GRAIN_FILL = `rgba(${ASH_GRAIN_RGB.join(', ')}, 0.5)`;

// Fraction of stipple cells that become specks at a given field opacity
// (0-1). Shared with the audit so the monotonicity proof measures the mix
// that actually paints, not the ramp in isolation.
export function ashSpeckFraction(alpha01) {
  return Math.min(0.16, alpha01 * 0.24);
}
