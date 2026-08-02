import { useId, useLayoutEffect, useRef } from 'react';
import './Ridgeline.css';

// Ported from public/ifhghs/demo/index.html ~line 1051 (RIDGE_FAR / RIDGE_NEAR / setRidge()).
const RIDGE_FAR =
  'M0,40 L0,26 Q12,13 22,20 Q32,27 44,11 Q56,1 68,16 Q79,27 88,17 Q95,12 100,20 L100,40 Z';
const RIDGE_NEAR =
  'M0,40 L0,33 Q18,24 34,30 Q48,36 62,26 Q76,17 88,28 Q95,34 100,30 L100,40 Z';
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
function farOpacity(pm25) {
  return clamp01(1 - (pm25 - 6) / 26) * 0.42;
}
function nearOpacity(pm25) {
  return clamp01(1 - (pm25 - 20) / 110) * 0.58;
}

// "How far can you see" — the objective anchor src/lib/rating.js already
// writes its notice copy around. Renders once; scrubbing only mutates the
// two gradient stops' stop-opacity, never the path data or DOM structure.
export default function Ridgeline({ pm25 }) {
  const uid = useId();
  const farStopRef = useRef(null);
  const nearStopRef = useRef(null);

  useLayoutEffect(() => {
    const pm = pm25 ?? 0;
    farStopRef.current?.setAttribute('stop-opacity', farOpacity(pm).toFixed(3));
    nearStopRef.current?.setAttribute('stop-opacity', nearOpacity(pm).toFixed(3));
  }, [pm25]);

  const farGradId = `ridgeFar${uid}`;
  const nearGradId = `ridgeNear${uid}`;

  return (
    <div className="ridgeline" aria-hidden="true">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none">
        <defs>
          <linearGradient id={farGradId} x1="0" y1="0" x2="0" y2="1">
            <stop ref={farStopRef} offset="0" style={{ stopColor: HAZE_COLOR }} stopOpacity="0" />
            <stop offset="1" style={{ stopColor: HAZE_COLOR }} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={nearGradId} x1="0" y1="0" x2="0" y2="1">
            <stop ref={nearStopRef} offset="0" style={{ stopColor: HAZE_COLOR }} stopOpacity="0" />
            <stop offset="1" style={{ stopColor: HAZE_COLOR }} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="ridgeline__far" d={RIDGE_FAR} fill={`url(#${farGradId})`} />
        <path className="ridgeline__near" d={RIDGE_NEAR} fill={`url(#${nearGradId})`} />
      </svg>
    </div>
  );
}
