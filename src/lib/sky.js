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
    const cosAz = clampUnit((Math.sin(declRad) - Math.sin(latRad) * Math.cos(zenithRad)) / (Math.cos(latRad) * sinZenith));
    azimuthDeg = rad2deg(Math.acos(cosAz));
    if (hourAngleDeg > 0) azimuthDeg = 360 - azimuthDeg;
  }

  return { altitudeDeg, azimuthDeg };
}

function clampUnit(v) {
  return Math.max(-1, Math.min(1, v));
}

// Low-precision lunar position (Schlyter), the JS twin of the Swift that used
// to run on the phone (SkyScene.moonPosition). The moon belongs in the payload
// next to the sun (contract §4) so a phone and a browser paint the identical
// moon instead of each computing its own. Returns altitude° (negative below the
// horizon) and azimuth° clockwise from north (0 N, 90 E, 180 S, 270 W) — the
// same azimuth convention solarPosition() returns.
export function lunarPosition(date, latDeg, lonDeg) {
  const rev = (x) => {
    const r = x % 360;
    return r < 0 ? r + 360 : r;
  };

  // Days since the epoch 2000 Jan 0.0 UT (JD 2451543.5).
  const d = date.getTime() / 86400000 + 2440587.5 - 2451543.5;

  // The moon's orbital elements.
  const N = deg2rad(rev(125.1228 - 0.0529538083 * d));
  const i = deg2rad(5.1454);
  const w = deg2rad(rev(318.0634 + 0.1643573223 * d));
  const a = 60.2666;
  const e = 0.0549;
  const M = deg2rad(rev(115.3654 + 13.0649929509 * d));

  let E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
  E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));

  const xv = a * (Math.cos(E) - e);
  const yv = a * (Math.sqrt(1 - e * e) * Math.sin(E));
  const v = Math.atan2(yv, xv);
  const r = Math.sqrt(xv * xv + yv * yv);

  const xh = r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i));
  const yh = r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i));
  const zh = r * (Math.sin(v + w) * Math.sin(i));

  const lonEcl = Math.atan2(yh, xh);
  const latEcl = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh));
  const ecl = deg2rad(23.4393 - 3.563e-7 * d);

  // Ecliptic -> equatorial.
  const xe = Math.cos(lonEcl) * Math.cos(latEcl);
  const ye = Math.sin(lonEcl) * Math.cos(latEcl) * Math.cos(ecl) - Math.sin(latEcl) * Math.sin(ecl);
  const ze = Math.sin(lonEcl) * Math.cos(latEcl) * Math.sin(ecl) + Math.sin(latEcl) * Math.cos(ecl);
  const ra = Math.atan2(ye, xe);
  const dec = Math.atan2(ze, Math.sqrt(xe * xe + ye * ye));

  // Local sidereal time.
  const ws = rev(282.9404 + 4.70935e-5 * d);
  const Ms = rev(356.047 + 0.9856002585 * d);
  const gmst0 = rev(ws + Ms + 180);
  const utHours = (date.getTime() / 3600000) % 24;
  const lst = deg2rad(rev(gmst0 + utHours * 15 + lonDeg));
  const ha = lst - ra;

  const lat = deg2rad(latDeg);
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const altitudeDeg = rad2deg(Math.asin(clampUnit(sinAlt)));
  const azimuthDeg = rev(
    rad2deg(Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat))) + 180,
  );

  return { altitudeDeg, azimuthDeg };
}

// Days since a known new moon, as a 0…1 fraction of the synodic month.
// 0 = new, 0.5 = full. The phase MoonShape draws from.
export function moonPhaseFraction(date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const synodic = 29.530588853;
  let age = (jd - 2451550.1) % synodic;
  if (age < 0) age += synodic;
  return age / synodic;
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
  // Height off true altitude, not a boosted-then-clamped one: the old
  // `altSin * 1.4` saturated near noon, pinning any sun past ~46 deg to the top
  // rail so the path read as a flat line across the sky instead of an arc. A
  // gentle gamma keeps the horizon reads low while letting midday dome.
  const yFrac = (1 - clamp01(altSin) ** 0.85) * 0.46 + 0.1;

  // The moon rides the same band the sun does, mapped the same way, so the
  // renderer can place it with the shared azimuth/altitude math. Below the
  // horizon it is still emitted (altitude negative) — the client fades it in as
  // it rises rather than switching it on at exactly 0°.
  const moonPos = lunarPosition(date, lat, lon);
  const moonAltSin = Math.sin(deg2rad(moonPos.altitudeDeg));

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
    moon: {
      altitudeDeg: moonPos.altitudeDeg,
      azimuthDeg: moonPos.azimuthDeg,
      visible: moonPos.altitudeDeg > -2, // the fade-in window opens just under the horizon
      xFrac: clamp01((moonPos.azimuthDeg - 90) / 180),
      yFrac: (1 - clamp01(moonAltSin) ** 0.85) * 0.46 + 0.1,
      phaseFraction: moonPhaseFraction(date), // 0 new, 0.5 full
    },
    starOpacity: (1 - day) * (1 - s1) * 0.9,
    isDark: lum(mid) < 0.42,
    smoke: { s1, s2 },
  };
}
