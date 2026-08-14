import { useId, useMemo } from 'react';
import { formatLocalTime } from '../lib/time.js';
import './ScrubberBar.css';

// The one scrubber, pinned to the foot of the canvas and identical on both the
// sky and the map — the web twin of the iOS unified scrubber (SmokeCurve.swift).
// The smoke curve is the track. A faint "now" mark sits on the curve always; a
// heavier mark rides the curve where you scrub. The readout carries the actual
// reading, the way iOS does — no invented threshold line.

const CHART_W = 600;
const CHART_H = 60;
const PAD = 6;

function buildCurve(pm25, windowStart, windowEnd, nowIndex, selectedIndex) {
  const length = Math.max(1, windowEnd - windowStart);
  const vals = [];
  for (let i = windowStart; i <= windowEnd; i++) vals.push(pm25?.[i] ?? 0);
  const maxV = Math.max(55, Math.max(...vals) * 1.18);
  const xPct = (i) => (i / length) * 100;
  const yPct = (v) => ((CHART_H - PAD - (Math.min(v, maxV) / maxV) * (CHART_H - PAD * 2)) / CHART_H) * 100;
  const px = (i) => (i / length) * CHART_W;
  const py = (v) => CHART_H - PAD - (Math.min(v, maxV) / maxV) * (CHART_H - PAD * 2);
  const pts = vals.map((v, k) => `${px(k).toFixed(1)},${py(v).toFixed(1)}`);
  const nowK = nowIndex - windowStart;
  const selK = selectedIndex - windowStart;
  return {
    areaD: `M0,${CHART_H} L${pts.join(' L')} L${CHART_W},${CHART_H} Z`,
    lineD: `M${pts.join(' L')}`,
    nowXPct: xPct(nowK),
    nowYPct: yPct(pm25?.[nowIndex] ?? 0),
    selXPct: xPct(selK),
    selYPct: yPct(pm25?.[selectedIndex] ?? 0),
  };
}

export default function ScrubberBar({
  canvas,
  onCanvas,
  onZoomIn,
  onZoomOut,
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
  const reading = pm25?.[selectedIndex];
  const readingLabel = Number.isFinite(reading) ? `${Math.round(reading)} µg/m³` : null;
  const timeLabel = atNow ? 'Now' : formatLocalTime(timesUTC[selectedIndex], tz);

  const curve = useMemo(
    () => buildCurve(pm25, windowStart, windowEnd, nowIndex, selectedIndex),
    [pm25, windowStart, windowEnd, nowIndex, selectedIndex],
  );

  return (
    <div className="sbar">
      {/* Map zoom, riding just outside the card's left edge. Pointer-fine
          screens only (see CSS): touch has pinch, and the iOS app has no
          buttons either. */}
      {canvas === 'map' && (
        <div className="sbar__zoom" role="group" aria-label="Map zoom">
          <button type="button" className="sbar__zoom-btn" aria-label="Zoom in" onClick={onZoomIn}>
            +
          </button>
          <button type="button" className="sbar__zoom-btn" aria-label="Zoom out" onClick={onZoomOut}>
            −
          </button>
        </div>
      )}
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
              <span key={place.id} className={'sbar__chip' + (isCurrent ? ' is-current' : '')}>
                <button type="button" className="sbar__chip-label" onClick={() => onSelectPlace(place)}>
                  {place.isCurrentLocation && (
                    <span className="sbar__chip-loc" aria-hidden="true">◎</span>
                  )}
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
        <span className="sbar__time">{timeLabel}</span>
        {readingLabel && <span className="sbar__reading">· {readingLabel}</span>}
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
          <path className="sbar__line" d={curve.lineD} fill="none" />
        </svg>

        {/* Now: a faint rule and a small dot on the curve — always present, so
            you can see where the present is even after scrubbing away. */}
        <span className="sbar__nowline" style={{ left: `${curve.nowXPct}%` }} aria-hidden="true" />
        <span
          className="sbar__nowdot"
          style={{ left: `${curve.nowXPct}%`, top: `${curve.nowYPct}%` }}
          aria-hidden="true"
        />

        {/* Scrub: the heavier mark you are holding, only once off now. */}
        {!atNow && (
          <>
            <span className="sbar__scrubline" style={{ left: `${curve.selXPct}%` }} aria-hidden="true" />
            <span
              className="sbar__scrubdot"
              style={{ left: `${curve.selXPct}%`, top: `${curve.selYPct}%` }}
              aria-hidden="true"
            />
          </>
        )}

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
