import { useEffect, useRef } from 'react';
import { skyFor } from '../lib/sky.js';
import { hexToRgb, inkPlan, rgbaCss } from '../lib/ink.js';
import './SkyBackdrop.css';

// The live sky: a full-bleed gradient driven by (pm25, moment, place), with
// the sun where the sun actually is, smoke-dimming, stars, film grain, and the
// scrim that keeps type legible on top of it (lib/ink.js).
//
// It renders its DOM exactly once. Every update — including every frame of a
// scrub — is a batch of custom-property writes on <html>, never a React tree
// update, so the map underneath keeps its frame budget. The elements below
// contain no interpolated props for that reason: React re-runs this function
// on scrub and produces an identical tree, so it touches nothing.

const STARS = [
  [12, 10],
  [30, 6],
  [52, 13],
  [70, 8],
  [86, 16],
  [22, 22],
  [62, 24],
  [80, 30],
  [40, 17],
  [8, 30],
];

const SUN_CLEAR = [255, 246, 224];
const SUN_SMOKED = [206, 110, 48];

// When the sun is low the demo warms its core even on clean air (demo:797).
const LOW_SUN_SIN = 0.3;
const LOW_SUN_WARMTH = 0.3;

// Sunrise sits at the left edge of the screen and sunset at the right, the
// same 20%-80% sweep the demo used (demo:793) — but driven by true azimuth.
const SUN_X_START = 20;
const SUN_X_SPAN = 60;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mixRGB = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgbCss = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

// The lit region of the moon at `phase` (0 new … 0.5 full … 1 new), in a unit
// circle. Same construction as iOS MoonShape: the limb plus a terminator scaled
// by cos(2π·phase). Both come from the payload's sky.moon, so the browser and
// the phone draw the identical phase.
function moonSliver(phase) {
  const k = Math.cos(2 * Math.PI * phase);
  const s = phase < 0.5 ? 1 : -1;
  const steps = 40;
  const limb = [];
  const term = [];
  for (let i = 0; i <= steps; i++) {
    const u = (i / steps) * 2 - 1;
    const w = Math.sqrt(Math.max(0, 1 - u * u));
    limb.push([s * w, u]);
    term.push([s * k * w, u]);
  }
  const pts = [...limb, ...term.reverse()];
  return 'M' + pts.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' L') + ' Z';
}

export default function SkyBackdrop({ pm25, date, lat, lon, showsSun = true }) {
  // Before the user's location resolves, place them by their clock: the UTC
  // offset gives a longitude good to a time zone's width, which is all the sun
  // needs to be in a believable part of the sky on the loading screen.
  const fallbackLon = -new Date().getTimezoneOffset() / 4;
  const useLat = Number.isFinite(lat) ? lat : 40;
  const useLon = Number.isFinite(lon) ? lon : fallbackLon;
  const ms = date instanceof Date ? date.getTime() : Date.now();
  const pm = Number.isFinite(pm25) ? pm25 : 0;

  const last = useRef('');
  const moonPathRef = useRef(null);

  useEffect(() => {
    const key = `${pm}|${ms}|${useLat}|${useLon}|${showsSun}`;
    if (last.current === key) return;
    last.current = key;

    const sky = skyFor(pm, new Date(ms), useLat, useLon);
    const plan = inkPlan(sky);
    const root = document.documentElement;
    const set = (name, value) => root.style.setProperty(name, value);

    set('--sky-zen', sky.zenith);
    set('--sky-mid', sky.mid);
    set('--sky-hor', sky.horizon);

    set('--ink', plan.ink);
    set('--ink-inverse', plan.inkInverse);
    set('--accent', plan.accent);
    set('--on-accent', plan.onAccent);
    root.classList.toggle('dark-air', plan.isDark);

    const veil = hexToRgb(plan.inkInverse);
    set('--scrim-zen', rgbaCss(veil, plan.scrim[0]));
    set('--scrim-mid', rgbaCss(veil, plan.scrim[1]));
    set('--scrim-hor', rgbaCss(veil, plan.scrim[2]));

    const { visible, xFrac, yFrac, dim, altitudeDeg } = sky.sun;
    // A window can suppress the sun (showsSun=false) and place it itself; by
    // default the backdrop paints it here, low enough that the ridge sets it.
    if (visible && showsSun) {
      const altSin = Math.sin((altitudeDeg * Math.PI) / 180);
      const warmth = altSin < LOW_SUN_SIN ? LOW_SUN_WARMTH : 0;
      const core = mixRGB(SUN_CLEAR, SUN_SMOKED, clamp01(dim * 1.2 + warmth));
      set('--sun-x', `${SUN_X_START + xFrac * SUN_X_SPAN}%`);
      set('--sun-y', `${yFrac * 100}%`);
      set('--sun-core', rgbCss(core));
      set('--sun-r0', `${14 + 8 * (1 - dim)}%`);
      set('--sun-r1', `${46 - 24 * dim}%`);
      set('--sun-op', String(1 - 0.25 * sky.smoke.s2));
    } else {
      set('--sun-op', '0');
    }

    // The moon travels the same sky, placed the same way, and set behind the
    // ridge when it is low. Pale by day, bright at night; faded in as it rises.
    const moon = sky.moon;
    const risen = clamp01((moon.altitudeDeg + 2) / 6);
    const daylight = sky.sun.visible ? 0.5 : 1;
    set('--moon-x', `${SUN_X_START + moon.xFrac * SUN_X_SPAN}%`);
    set('--moon-y', `${moon.yFrac * 100}%`);
    set('--moon-op', String(risen * daylight));
    moonPathRef.current?.setAttribute('d', moonSliver(moon.phaseFraction));

    set('--star-op', String(sky.starOpacity));

    // Keep the browser chrome in the same weather as the page.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sky.zenith);
  }, [pm, ms, useLat, useLon, showsSun]);

  return (
    <div className="sky" aria-hidden="true">
      <div className="sky__gradient" />
      <div className="sky__stars">
        {STARS.map(([x, y]) => (
          <i key={`${x}-${y}`} style={{ left: `${x}%`, top: `${y}%` }} />
        ))}
      </div>
      <div className="sky__sun" />
      <div className="sky__moon">
        <svg viewBox="-1.4 -1.4 2.8 2.8">
          <path ref={moonPathRef} d="" />
        </svg>
      </div>
      <div className="sky__scrim" />
      <div className="sky__grain" />
    </div>
  );
}
