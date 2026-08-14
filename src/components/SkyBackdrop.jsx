import { useCallback, useEffect, useRef, useState } from 'react';
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

// The afterglow pooled on the horizon as the sun sets — golden high, deepening
// to a burnt orange as it sinks toward and behind the ridge.
const BLOOM_HIGH = [255, 178, 96];
const BLOOM_LOW = [226, 104, 62];

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

export default function SkyBackdrop({ pm25, date, lat, lon, showsSun = true, playing = false, frameMs = 600 }) {
  // Before the user's location resolves, place them by their clock: the UTC
  // offset gives a longitude good to a time zone's width, which is all the sun
  // needs to be in a believable part of the sky on the loading screen.
  const fallbackLon = -new Date().getTimezoneOffset() / 4;
  const useLat = Number.isFinite(lat) ? lat : 40;
  const useLon = Number.isFinite(lon) ? lon : fallbackLon;
  const ms = date instanceof Date ? date.getTime() : Date.now();
  const pm = Number.isFinite(pm25) ? pm25 : 0;

  const moonPathRef = useRef(null);
  // Was the body above the horizon on the previous paint? A false->true flip is
  // a horizon crossing: the body should snap to where it rises, not slide there
  // across the whole sky. null means first paint, which also snaps.
  const prevSunUp = useRef(null);
  const prevMoonUp = useRef(null);
  const nightClearRef = useRef(false);
  const [nightClear, setNightClear] = useState(false);
  const [meteor, setMeteor] = useState(null);
  const meteorId = useRef(0);

  // Paint every sky variable for one instant. animatePos=false snaps the sun and
  // moon into place — the playback loop below calls it every frame, so CSS must
  // not also tween; animatePos=true lets CSS glide between hours (manual scrub
  // and the resting view) and snaps only across a horizon crossing.
  const paint = useCallback(
    (simMs, animatePos) => {
      const sky = skyFor(pm, new Date(simMs), useLat, useLon);
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
      // The canvas colour behind Safari's bars: the sky as painted, scrim and
      // all, so those strips continue the sky instead of banding against it.
      set('--sky-canvas', rgbCss(plan.canvasTop));

      set('--scrim-zen', rgbaCss(veil, plan.scrim[0]));
      set('--scrim-mid', rgbaCss(veil, plan.scrim[1]));
      set('--scrim-hor', rgbaCss(veil, plan.scrim[2]));

      const { visible, xFrac, yFrac, dim, altitudeDeg } = sky.sun;
      // A window can suppress the sun (showsSun=false) and place it itself; by
      // default the backdrop paints it here, low enough that the ridge sets it.
      const sunUp = visible && showsSun;
      if (!animatePos || (sunUp && prevSunUp.current !== true)) set('--sun-move', '0s');
      else if (sunUp) root.style.removeProperty('--sun-move');
      prevSunUp.current = sunUp;

      if (sunUp) {
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

      // Sunset afterglow: a warm glow pooled low at the sun's x, driven by how
      // near the horizon the sun is (peaks a few degrees up, and lingers a little
      // below, so the sun setting behind the ridge reads as a sunset instead of
      // just switching off). Behind the ridge in the stacking order, like iOS.
      const golden = clamp01(1 - Math.abs(altitudeDeg - 3) / 15);
      const bloomOp = showsSun ? golden * (1 - 0.35 * sky.smoke.s2) : 0;
      if (bloomOp > 0.001) {
        const sink = clamp01((10 - altitudeDeg) / 16); // 0 high → 1 at/below horizon
        set('--bloom-x', `${SUN_X_START + xFrac * SUN_X_SPAN}%`);
        set('--bloom-core', rgbCss(mixRGB(BLOOM_HIGH, BLOOM_LOW, sink)));
      }
      set('--bloom-op', String(bloomOp));

      // The moon travels the same sky, placed the same way, and set behind the
      // ridge when it is low. Pale by day, bright at night; faded in as it rises.
      const moon = sky.moon;
      const risen = clamp01((moon.altitudeDeg + 2) / 6);
      const daylight = sky.sun.visible ? 0.5 : 1;
      const moonUp = moon.altitudeDeg > -2;
      if (!animatePos || (moonUp && prevMoonUp.current !== true)) set('--moon-move', '0s');
      else root.style.removeProperty('--moon-move');
      prevMoonUp.current = moonUp;
      set('--moon-x', `${SUN_X_START + moon.xFrac * SUN_X_SPAN}%`);
      set('--moon-y', `${moon.yFrac * 100}%`);
      set('--moon-op', String(risen * daylight));
      moonPathRef.current?.setAttribute('d', moonSliver(moon.phaseFraction));

      set('--star-op', String(sky.starOpacity));

      // Keep the browser chrome in the same weather as the page.
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sky.zenith);

      // A dark, smoke-free sky is where a shooting star belongs; publish the flag
      // for the scheduler, and only re-render when it actually flips.
      const nc = !sky.sun.visible && sky.smoke.s1 < 0.12;
      if (nc !== nightClearRef.current) {
        nightClearRef.current = nc;
        setNightClear(nc);
      }
    },
    [pm, useLat, useLon, showsSun],
  );

  // Resting and manual scrubbing: paint the selected hour and let CSS glide.
  useEffect(() => {
    if (playing) return;
    paint(ms, true);
  }, [playing, ms, paint]);

  // Playback: rather than one CSS step per hour (which changes speed at every
  // hour and reads as jerky), interpolate the whole sky between hours at 60fps.
  // App advances `ms` each hour; this re-bases and glides across that hour, so
  // the end of one hour is the start of the next and the arc never stutters.
  useEffect(() => {
    if (!playing) return;
    let raf;
    const base = performance.now();
    paint(ms, false); // paint the hour immediately, so a throttled rAF still steps
    const tick = (now) => {
      const t = Math.min(1, (now - base) / frameMs);
      paint(ms + t * 3_600_000, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ms, frameMs, paint]);

  // A rare shooting star on a clear night — a small idle delight, never during
  // the day or under smoke, and never for readers who ask for less motion.
  useEffect(() => {
    if (!nightClear) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let timer;
    const schedule = (delay) => {
      timer = setTimeout(() => {
        meteorId.current += 1;
        setMeteor({
          id: meteorId.current,
          top: `${4 + Math.floor(Math.random() * 26)}%`,
          left: `${12 + Math.floor(Math.random() * 62)}%`,
        });
        schedule(8000 + Math.random() * 12000);
      }, delay);
    };
    schedule(2500 + Math.random() * 4000);
    return () => clearTimeout(timer);
  }, [nightClear]);

  return (
    <div className="sky" aria-hidden="true">
      <div className="sky__gradient" />
      <div className="sky__stars">
        {STARS.map(([x, y]) => (
          <i key={`${x}-${y}`} style={{ left: `${x}%`, top: `${y}%` }} />
        ))}
      </div>
      {meteor && (
        <span key={meteor.id} className="sky__meteor" style={{ top: meteor.top, left: meteor.left }} />
      )}
      <div className="sky__bloom" />
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
