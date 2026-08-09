import { useId, useMemo } from 'react';
import { formatLocalTime } from '../lib/time.js';
import './ScrubberBar.css';

// The one scrubber, pinned to the foot of the canvas and identical on both the
// sky and the map — the web twin of the iOS unified scrubber. The smoke curve
// is the track; a row of saved-place chips sits beside the Sky/Map toggle; a
// play button sweeps −12h…+48h; "Now" jumps back to the present.

const CHART_W = 600;
const CHART_H = 72;
const PAD = 6;
const THRESHOLD_PM25 = 35;

function buildCurve(pm25, windowStart, windowEnd, nowIndex) {
  const length = Math.max(1, windowEnd - windowStart);
  const vals = [];
  for (let i = windowStart; i <= windowEnd; i++) vals.push(pm25?.[i] ?? 0);
  const maxV = Math.max(55, Math.max(...vals) * 1.18);
  const x = (i) => (i / length) * CHART_W;
  const y = (v) => CHART_H - PAD - (Math.min(v, maxV) / maxV) * (CHART_H - PAD * 2);
  const pts = vals.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`);
  const nowK = nowIndex - windowStart;
  return {
    areaD: `M0,${CHART_H} L${pts.join(' L')} L${CHART_W},${CHART_H} Z`,
    lineD: `M${pts.join(' L')}`,
    thresholdY: y(THRESHOLD_PM25).toFixed(1),
    nowX: x(nowK).toFixed(1),
  };
}

export default function ScrubberBar({
  canvas,
  onCanvas,
  places,
  currentPlaceId,
  onSelectPlace,
  onRemovePlace,
  onAddPlace,
  timesUTC,
  pm25,
  windowStart,
  windowEnd,
  selectedIndex,
  nowIndex,
  onScrub,
  onNow,
  playing,
  onTogglePlay,
  onShare,
  timezone,
}) {
  const gradId = useId();
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const atNow = selectedIndex === nowIndex;
  const whenLabel = atNow ? 'Now' : formatLocalTime(timesUTC[selectedIndex], tz);
  const curve = useMemo(
    () => buildCurve(pm25, windowStart, windowEnd, nowIndex),
    [pm25, windowStart, windowEnd, nowIndex],
  );

  const dotFrac = (selectedIndex - windowStart) / Math.max(1, windowEnd - windowStart);

  return (
    <div className="sbar">
      <div className="sbar__top">
        <div className="sbar__toggle" role="tablist" aria-label="Sky or map">
          <button
            type="button"
            role="tab"
            aria-selected={canvas === 'sky'}
            className={'sbar__seg' + (canvas === 'sky' ? ' is-on' : '')}
            onClick={() => onCanvas('sky')}
          >
            Sky
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={canvas === 'map'}
            className={'sbar__seg' + (canvas === 'map' ? ' is-on' : '')}
            onClick={() => onCanvas('map')}
          >
            Map
          </button>
        </div>

        <div className="sbar__chips">
          {places.map((place) => {
            const isCurrent = place.id === currentPlaceId;
            return (
              <span
                key={place.id}
                className={'sbar__chip' + (isCurrent ? ' is-current' : '')}
              >
                <button
                  type="button"
                  className="sbar__chip-label"
                  onClick={() => onSelectPlace(place)}
                >
                  {place.isCurrentLocation && <span className="sbar__chip-loc" aria-hidden="true">◎</span>}
                  {place.shortName}
                </button>
                <button
                  type="button"
                  className="sbar__chip-x"
                  aria-label={`Remove ${place.shortName}`}
                  onClick={() => onRemovePlace(place)}
                >
                  ×
                </button>
              </span>
            );
          })}
          <button type="button" className="sbar__chip-add" aria-label="Add a place" onClick={onAddPlace}>
            +
          </button>
        </div>

        <button type="button" className="sbar__share" aria-label="Share this air" onClick={onShare}>
          <span aria-hidden="true">⌁</span> Share
        </button>
      </div>

      <div className="sbar__when">
        <span className="sbar__time">{whenLabel}</span>
        {selectedIndex < nowIndex && <span className="sbar__tag">model estimate</span>}
        {!atNow && (
          <button type="button" className="sbar__now" onClick={onNow}>
            Now
          </button>
        )}
      </div>

      <div className="sbar__track">
        <svg
          className="sbar__curve"
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--ink)' }} stopOpacity="0.30" />
              <stop offset="1" style={{ stopColor: 'var(--ink)' }} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={curve.areaD} fill={`url(#${gradId})`} />
          <line
            className="sbar__threshold"
            x1="0"
            x2={CHART_W}
            y1={curve.thresholdY}
            y2={curve.thresholdY}
          />
          <path className="sbar__line" d={curve.lineD} fill="none" />
        </svg>
        <span className="sbar__thumb" style={{ left: `${dotFrac * 100}%` }} aria-hidden="true" />
        <input
          type="range"
          min={windowStart}
          max={windowEnd}
          step={1}
          value={selectedIndex}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="sbar__range"
          aria-label="Scrub forecast time"
        />
      </div>

      <div className="sbar__foot">
        <span className="sbar__edge">−12h</span>
        <button
          type="button"
          className="sbar__play"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={onTogglePlay}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="sbar__edge">+48h</span>
      </div>
    </div>
  );
}
