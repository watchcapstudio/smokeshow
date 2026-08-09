// The curve, promoted to a control.
//
// Suggestion #2 in the parity review: on the live site the only draggable
// timeline lives inside the map section, several hundred pixels below the
// verdict it drives — so scrubbing changes a rating chip, a trend chip, a
// ridgeline and the whole sky, all of them off-screen. This is Kelly's
// `CurveView` on the web: the drag sits directly under the words it moves.
//
// Two rules carried over from SmokeCurve.swift, both of them honesty rules:
//   - a null hour is a gap, not a zero. Each run of real values is its own
//     subpath and the missing span gets a hatch, so it reads as "we don't
//     know" rather than as a rendering bug.
//   - the vertical scale floors at 55 µg/m³, so a clear day is a flat line
//     near the bottom instead of being amplified into drama.

import { useCallback, useEffect, useMemo, useRef } from 'react';

const VIEW_W = 600;
const VIEW_H = 150;
const PAD_Y = 6;
// "Smells like fire" — the one line on the chart worth marking, and the same
// threshold the headline's clear-time is computed against.
const THRESHOLD_PM25 = 35;

function isNightHour(timeUTCStr, tz) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(
      new Date(timeUTCStr + 'Z'),
    ),
  );
  return hour >= 20 || hour < 6;
}

// Each contiguous run of non-null values becomes one line subpath and one
// filled-area subpath. Gaps break both.
function buildGeometry(values) {
  const peak = values.reduce((m, v) => (v == null ? m : Math.max(m, v)), 0);
  const maxValue = Math.max(55, peak * 1.18);
  const step = VIEW_W / Math.max(1, values.length - 1);
  const x = (i) => i * step;
  const y = (v) => VIEW_H - PAD_Y - (Math.min(v, maxValue) / maxValue) * (VIEW_H - PAD_Y * 2);

  const lines = [];
  const areas = [];
  const gaps = [];
  let run = [];

  const flush = () => {
    if (run.length > 1) {
      const pts = run.map(({ i, v }) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      lines.push(`M${pts.join(' L')}`);
      areas.push(
        `M${x(run[0].i).toFixed(1)},${VIEW_H} L${pts.join(' L')} L${x(run[run.length - 1].i).toFixed(1)},${VIEW_H} Z`,
      );
    }
    run = [];
  };

  values.forEach((v, i) => {
    if (v == null) {
      flush();
      gaps.push({ x: x(i) - step / 2, w: step });
      return;
    }
    run.push({ i, v });
  });
  flush();

  return { lines, areas, gaps, maxValue, x, y };
}

export default function Curve({
  timesUTC,
  pm25,
  windowStart,
  windowEnd,
  nowIndex,
  selectedIndex,
  onScrub,
  timezone,
}) {
  const ref = useRef(null);
  const count = windowEnd - windowStart + 1;

  const values = useMemo(
    () => Array.from({ length: count }, (_, k) => pm25[windowStart + k] ?? null),
    [pm25, windowStart, count],
  );

  const geo = useMemo(() => buildGeometry(values), [values]);

  const nights = useMemo(
    () =>
      Array.from({ length: count }, (_, k) => isNightHour(timesUTC[windowStart + k], timezone)),
    [timesUTC, windowStart, count, timezone],
  );

  // Pointer position -> hour index. Clamped, because a drag that leaves the
  // element still means "the first hour" or "the last one", not "stop".
  const indexAt = useCallback(
    (clientX) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box || box.width === 0) return null;
      const frac = (clientX - box.left) / box.width;
      const k = Math.round(frac * (count - 1));
      return windowStart + Math.min(Math.max(k, 0), count - 1);
    },
    [count, windowStart],
  );

  const dragging = useRef(false);

  useEffect(() => {
    const move = (e) => {
      if (!dragging.current) return;
      // The drag owns the gesture once it starts: without this a scrub that
      // wanders vertically turns into a page scroll halfway through.
      e.preventDefault();
      const idx = indexAt(e.clientX);
      if (idx != null) onScrub(idx);
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [indexAt, onScrub]);

  function onPointerDown(e) {
    dragging.current = true;
    const idx = indexAt(e.clientX);
    if (idx != null) onScrub(idx);
  }

  function onKeyDown(e) {
    const jump = e.shiftKey ? 6 : 1;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onScrub(Math.max(windowStart, selectedIndex - jump));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onScrub(Math.min(windowEnd, selectedIndex + jump));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onScrub(nowIndex);
    }
  }

  const k = selectedIndex - windowStart;
  const nowK = nowIndex - windowStart;
  const selValue = pm25[selectedIndex];

  return (
    <div
      className="proto-curve"
      ref={ref}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      role="slider"
      tabIndex={0}
      aria-label="Scrub the forecast. Left and right arrows move an hour, shift for six."
      aria-valuemin={windowStart}
      aria-valuemax={windowEnd}
      aria-valuenow={selectedIndex}
      aria-valuetext={`${new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        hour: 'numeric',
        hour12: true,
        timeZone: timezone,
      }).format(new Date(timesUTC[selectedIndex] + 'Z'))}, ${
        selValue == null ? 'no data' : `${Math.round(selValue)} micrograms per cubic metre`
      }`}
    >
      <div className="proto-curve__nights" aria-hidden="true">
        {nights.map((night, i) => (
          <div
            key={i}
            className={'proto-curve__night' + (night ? ' proto-curve__night--on' : '')}
          />
        ))}
      </div>

      <svg
        className="proto-curve__svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="protoCurveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--ink)" stopOpacity="0.34" />
            <stop offset="1" stopColor="var(--ink)" stopOpacity="0.02" />
          </linearGradient>
          <pattern
            id="protoCurveGap"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink)" strokeWidth="1.5" opacity="0.18" />
          </pattern>
        </defs>

        {geo.gaps.map((g, i) => (
          <rect
            key={i}
            x={g.x}
            y="0"
            width={g.w}
            height={VIEW_H}
            fill="url(#protoCurveGap)"
          />
        ))}

        {geo.areas.map((d, i) => (
          <path key={i} d={d} fill="url(#protoCurveFill)" />
        ))}

        <line
          className="proto-curve__threshold"
          x1="0"
          x2={VIEW_W}
          y1={geo.y(THRESHOLD_PM25)}
          y2={geo.y(THRESHOLD_PM25)}
        />

        {geo.lines.map((d, i) => (
          <path key={i} className="proto-curve__line" d={d} fill="none" />
        ))}

        <line
          className="proto-curve__now"
          x1={geo.x(nowK)}
          x2={geo.x(nowK)}
          y1="0"
          y2={VIEW_H}
        />

        <line
          className="proto-curve__playhead"
          x1={geo.x(k)}
          x2={geo.x(k)}
          y1="0"
          y2={VIEW_H}
        />
      </svg>

      {/* The dot rides in HTML rather than SVG so a non-uniform viewBox can't
          squash it into an ellipse. */}
      {selValue != null && (
        <span
          className="proto-curve__dot"
          aria-hidden="true"
          style={{
            left: `${(k / Math.max(1, count - 1)) * 100}%`,
            top: `${(geo.y(selValue) / VIEW_H) * 100}%`,
          }}
        />
      )}
    </div>
  );
}
