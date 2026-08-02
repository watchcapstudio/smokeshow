import { useId, useMemo } from 'react';
import { formatLocalTime } from '../lib/time.js';
import './Scrubber.css';

const CHART_W = 600;
const CHART_H = 64;
const CHART_PAD = 4;
const THRESHOLD_PM25 = 35; // "Smells like fire" — the line worth marking on the curve

function isNightHour(timeUTCStr, tz) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(
      new Date(timeUTCStr + 'Z'),
    ),
  );
  return hour >= 20 || hour < 6;
}

// Ports buildCurve() (demo ~line 996): a 60-hour PM2.5 area chart with a
// dashed 35 µg/m³ threshold and a "now" mark. Built once per data change —
// scrubbing never touches this, only the native range input's thumb moves.
function buildCurve(pm25, windowStart, windowEnd, nowIndex) {
  const length = windowEnd - windowStart;
  const vals = [];
  for (let i = windowStart; i <= windowEnd; i++) vals.push(pm25?.[i] ?? 0);
  const maxV = Math.max(55, Math.max(...vals) * 1.18);
  const x = (i) => (i / Math.max(1, length)) * CHART_W;
  const y = (v) => CHART_H - CHART_PAD - (Math.min(v, maxV) / maxV) * (CHART_H - CHART_PAD * 2);
  const pts = vals.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`);
  const nowK = nowIndex - windowStart;
  return {
    areaD: `M0,${CHART_H} L${pts.join(' L')} L${CHART_W},${CHART_H} Z`,
    lineD: `M${pts.join(' L')}`,
    thresholdY: y(THRESHOLD_PM25).toFixed(1),
    nowX: x(nowK).toFixed(1),
    nowY: y(vals[nowK] ?? 0).toFixed(1),
  };
}

export default function Scrubber({
  timesUTC,
  pm25,
  windowStart,
  windowEnd,
  selectedIndex,
  nowIndex,
  onScrub,
  playing,
  onTogglePlay,
  timezone,
}) {
  const gradId = useId();
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const length = windowEnd - windowStart || 1;
  const label = formatLocalTime(timesUTC[selectedIndex], tz);
  const isModelEstimate = selectedIndex < nowIndex;

  const curve = useMemo(
    () => buildCurve(pm25, windowStart, windowEnd, nowIndex),
    [pm25, windowStart, windowEnd, nowIndex],
  );

  return (
    <div className="scrubber">
      <div className="scrubber__label">
        <span className="scrubber__time">{label}</span>
        {isModelEstimate && <span className="scrubber__tag">model estimate</span>}
        {selectedIndex === nowIndex && <span className="scrubber__tag scrubber__tag--now">Now</span>}
      </div>
      <div className="scrubber__track-wrap">
        <div className="scrubber__night-bands">
          {Array.from({ length: length + 1 }, (_, k) => windowStart + k).map((idx) => (
            <div
              key={idx}
              className={
                'scrubber__band' + (isNightHour(timesUTC[idx], tz) ? ' scrubber__band--night' : '')
              }
            />
          ))}
        </div>
        <svg
          className="scrubber__curve"
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--ink, var(--text))' }} stopOpacity="0.32" />
              <stop offset="1" style={{ stopColor: 'var(--ink, var(--text))' }} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path className="scrubber__curve-area" d={curve.areaD} fill={`url(#${gradId})`} />
          <line
            className="scrubber__threshold"
            x1="0"
            x2={CHART_W}
            y1={curve.thresholdY}
            y2={curve.thresholdY}
          />
          <path className="scrubber__curve-line" d={curve.lineD} fill="none" />
          <line
            className="scrubber__now-line"
            x1={curve.nowX}
            x2={curve.nowX}
            y1={CHART_PAD}
            y2={CHART_H - CHART_PAD}
          />
          <circle className="scrubber__now-dot" cx={curve.nowX} cy={curve.nowY} r="2.6" />
        </svg>
        <input
          type="range"
          min={windowStart}
          max={windowEnd}
          step={1}
          value={selectedIndex}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="scrubber__range"
          aria-label="Scrub forecast time"
        />
      </div>
      <button type="button" className="scrubber__play" onClick={onTogglePlay}>
        {playing ? '⏸ Pause' : '▶ Play'}
      </button>
    </div>
  );
}
