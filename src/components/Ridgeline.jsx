import { useId, useLayoutEffect, useRef } from 'react';
import './Ridgeline.css';

// Smoothed from the demo's ridgeline (public/ifhghs/demo/index.html ~line 1051).
// The demo chained quadratics whose control points did not share a tangent at
// the joins, so a couple of hills grew a visible corner — a little peak poking
// off a smooth slope. These are cubics between the same peaks and valleys with a
// horizontal tangent at every knot, so each hill is a clean arch and the joins
// are C1-smooth: same landscape, no cusps.
const RIDGE_FAR =
  'M0,40 L0,25 C7,25 7,16 14,16 C22,16 22,22 30,22 C41,22 41,6 52,6 C65.5,6 65.5,22 79,22 C85.5,22 85.5,15 92,15 C96,15 96,19 100,19 L100,40 Z';
const RIDGE_NEAR =
  'M0,40 L0,33 C8,33 8,27 16,27 C30,27 30,32 44,32 C59,32 59,22 74,22 C84.5,22 84.5,31 95,31 C97.5,31 97.5,30 100,30 L100,40 Z';
// The demo hardcodes this haze tint (#1E1A14) because it always sits on a
// rendered sky gradient. Production's shell is flat until SkyBackdrop lands
// (branch B2), so the silhouette reads in --ink instead — dark on the cream
// shell, cream on the dark one — and still holds up once the live sky and
// its ink inversion are in place.
const HAZE_COLOR = 'var(--ink, var(--text))';

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// Haze pools in the valleys: solid at the peaks, dissolving toward the base.
// Far ridge is gone by ~32 µg/m³; the near one is swallowed gradually to 130.
// The web canvas is far bigger than the phone's, so the hills carry more weight
// here than iOS's 0.55 — enough to read as a landscape ("how far can you see"),
// not a faint distant line.
const STRENGTH = 0.72;
function farOpacity(pm25) {
  return clamp01(1 - (pm25 - 6) / 26) * 0.42 * STRENGTH;
}
function nearOpacity(pm25) {
  return clamp01(1 - (pm25 - 20) / 110) * 0.58 * STRENGTH;
}

// "How far can you see" — the objective anchor src/lib/rating.js already
// writes its notice copy around. Renders once; scrubbing only mutates the
// two gradient stops' stop-opacity, never the path data or DOM structure.
export default function Ridgeline({ pm25 }) {
  const uid = useId();
  const farStopRef = useRef(null);
  const farBaseStopRef = useRef(null);
  const nearPathRef = useRef(null);

  useLayoutEffect(() => {
    const pm = pm25 ?? 0;
    const far = farOpacity(pm);
    // The far ridge is the distance gauge: it fades top-to-base, and thins
    // whole as smoke swallows it. The near ridge is the foreground you're
    // standing in — a solid landmass that only goes as the air goes.
    farStopRef.current?.setAttribute('stop-opacity', far.toFixed(3));
    farBaseStopRef.current?.setAttribute('stop-opacity', (far * 0.35).toFixed(3));
    nearPathRef.current?.setAttribute('fill-opacity', nearOpacity(pm).toFixed(3));
  }, [pm25]);

  const farGradId = `ridgeFar${uid}`;

  return (
    <div className="ridgeline" aria-hidden="true">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none">
        <defs>
          <linearGradient id={farGradId} x1="0" y1="0" x2="0" y2="1">
            <stop ref={farStopRef} offset="0" style={{ stopColor: HAZE_COLOR }} stopOpacity="0" />
            <stop ref={farBaseStopRef} offset="1" style={{ stopColor: HAZE_COLOR }} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="ridgeline__far" d={RIDGE_FAR} fill={`url(#${farGradId})`} />
        <path
          ref={nearPathRef}
          className="ridgeline__near"
          d={RIDGE_NEAR}
          fill={HAZE_COLOR}
          fillOpacity="0"
        />
      </svg>
    </div>
  );
}
