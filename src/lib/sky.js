// Ports the demo's "sky concept B" gradient math (public/ifhghs/demo/index.html
// ~line 571: skyB(), mix(), lerp(), clamp01(), lum()) into a reusable module.
// The demo faked sun altitude with a fixed 6 AM–9 PM sinusoid
// (`sin(pi*(t-6)/15)`), which is visibly wrong at high latitude in summer
// (real sunrise/sunset can sit outside that window entirely). This version
// replaces the fake schedule with a real NOAA/Meeus low-precision solar
// position calculation (~0.01° accuracy), keyed off actual date/lat/lon.

export function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function mix(a, b, t) {
  return [0, 1, 2].map((k) => Math.round(lerp(a[k], b[k], t)));
}

// Perceptual luminance (0-1) of an [r,g,b] triple (0-255 each).
export function lum(c) {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

const deg2rad = (d) => (d * Math.PI) / 180;
const rad2deg = (r) => (r * 180) / Math.PI;
const normalizeDeg = (d) => ((d % 360) + 360) % 360;

// NOAA Solar Calculator algorithm (low-precision variant, after Meeus).
// Returns the sun's altitude (degrees above horizon, negative below) and
// azimuth (degrees clockwise from north) for a given instant and location.
export function solarPosition(date, latDeg, lonDeg) {
  const JD = date.getTime() / 86400000 + 2440587.5;
  const T = (JD - 2451545.0) / 36525;

  const L0 = normalizeDeg(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = normalizeDeg(357.52911 + T * (35999.05029 - 0.0001537 * T));
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mrad = deg2rad(M);

  const C =
    Math.sin(Mrad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mrad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mrad) * 0.000289;

  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(deg2rad(omega));

  const epsilon0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const epsilon = epsilon0 + 0.00256 * Math.cos(deg2rad(omega));

  const declRad = Math.asin(Math.sin(deg2rad(epsilon)) * Math.sin(deg2rad(lambda)));

  const y = Math.tan(deg2rad(epsilon / 2)) ** 2;
  const eqTimeMinutes =
    4 *
    rad2deg(
      y * Math.sin(2 * deg2rad(L0)) -
        2 * e * Math.sin(Mrad) +
        4 * e * y * Math.sin(Mrad) * Math.cos(2 * deg2rad(L0)) -
        0.5 * y * y * Math.sin(4 * deg2rad(L0)) -
        1.25 * e * e * Math.sin(2 * Mrad),
    );

  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let trueSolarTime = (utcMinutes + eqTimeMinutes + 4 * lonDeg) % 1440;
  if (trueSolarTime < 0) trueSolarTime += 1440;

  const hourAngleDeg = trueSolarTime / 4 - 180; // degrees; negative = morning

  const latRad = deg2rad(latDeg);
  const haRad = deg2rad(hourAngleDeg);
  const cosZenith = clampUnit(
    Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad),
  );
  const zenithRad = Math.acos(cosZenith);
  const altitudeDeg = 90 - rad2deg(zenithRad);

  const sinZenith = Math.sin(zenithRad);
  let azimuthDeg;
  if (Math.abs(sinZenith) < 1e-6 || Math.abs(Math.cos(latRad)) < 1e-6) {
    azimuthDeg = 180; // sun (near) directly overhead, or observer at a pole — direction is undefined
  } else {
    const cosAz = clampUnit((Math.sin(latRad) * Math.cos(zenithRad) - Math.sin(declRad)) / (Math.cos(latRad) * sinZenith));
    azimuthDeg = rad2deg(Math.acos(cosAz));
    if (hourAngleDeg > 0) azimuthDeg = 360 - azimuthDeg;
  }

  return { altitudeDeg, azimuthDeg };
}

function clampUnit(v) {
  return Math.max(-1, Math.min(1, v));
}

const DAY_ZEN = [139, 169, 196],
  DAY_HOR = [226, 222, 206];
const GOLD_ZEN = [126, 138, 168],
  GOLD_HOR = [228, 172, 116];
const NIGHT_ZEN = [14, 18, 28],
  NIGHT_HOR = [42, 48, 62];
const SMK_MID = [124, 88, 52],
  SMK_HOR = [168, 116, 64],
  SMK_DK = [52, 37, 24],
  SMK_DKH = [80, 56, 34];

// Same colour-mixing pipeline as the demo's skyB(pm, t), but taking a real
// sine-of-altitude in place of the demo's fixed-schedule proxy.
function colorsForAltitude(pm25, altSin) {
  const day = clamp01(altSin * 1.6);
  const gold = clamp01(1 - Math.abs(altSin - 0.18) / 0.26) * (altSin > 0 ? 1 : 0);
  let zen = mix(NIGHT_ZEN, DAY_ZEN, day);
  let hor = mix(NIGHT_HOR, DAY_HOR, day);
  zen = mix(zen, GOLD_ZEN, gold * 0.6);
  hor = mix(hor, GOLD_HOR, gold * 0.75);

  const s1 = clamp01(pm25 / 150);
  const s2 = clamp01((pm25 - 150) / 130);
  const night = 1 - day;
  zen = mix(zen, mix(SMK_MID, SMK_DK, night), s1 * 0.8);
  hor = mix(hor, mix(SMK_HOR, SMK_DKH, night), s1 * 0.9);
  zen = mix(zen, SMK_DK, s2 * 0.75);
  hor = mix(hor, SMK_DKH, s2 * 0.7);

  return { zen, hor, mid: mix(zen, hor, 0.55), day, s1, s2 };
}

const rgbCss = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

// Full sky state for a location/moment/PM2.5 reading: gradient colours, sun
// placement + dimming, star opacity, and whether the scene reads as "dark"
// (for switching foreground text/ink colour, à la the demo's `.dark-air`).
export function skyFor(pm25, date, lat, lon) {
  const { altitudeDeg, azimuthDeg } = solarPosition(date, lat, lon);
  const altSin = Math.sin(deg2rad(altitudeDeg));
  const { zen, hor, mid, day, s1, s2 } = colorsForAltitude(pm25 ?? 0, altSin);

  const visible = altitudeDeg > 1.1; // ~ demo's `alt > 0.02` threshold, in real degrees
  // Screen-space placement, assuming the horizon spans sunrise (east, left
  // edge) to sunset (west, right edge) through due south — the same
  // simplification the demo made by driving position off elapsed daytime
  // hours, just keyed off true azimuth instead of a fixed schedule.
  const xFrac = clamp01((azimuthDeg - 90) / 180);
  const yFrac = clamp01(1 - clamp01(altSin * 1.4)) * 0.4 + 0.12;

  return {
    zenith: rgbCss(zen),
    zenithRGB: zen,
    mid: rgbCss(mid),
    midRGB: mid,
    horizon: rgbCss(hor),
    horizonRGB: hor,
    sun: {
      altitudeDeg,
      azimuthDeg,
      visible,
      xFrac,
      yFrac,
      dim: s1, // 0 (clear) -> 1 (smoke-dimmed), same driver as the haze tint
    },
    starOpacity: (1 - day) * (1 - s1) * 0.9,
    isDark: lum(mid) < 0.42,
    smoke: { s1, s2 },
  };
}
