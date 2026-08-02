import { useEffect, useRef, useState } from 'react';
import { OLFACTORY_FATIGUE_LEVEL_INDEX, NOSE_CAVEAT } from '../lib/rating.js';
import { ugm3ToAqi, aqiCategory } from '../lib/aqi.js';
import { getJSON, setJSON } from '../lib/storage.js';
import './RatingChip.css';

const DISAGREE_AQI_GAP = 25;
// Teach the two-source explanation on the first few times a user actually
// sees a disagreement, then collapse it — they can reopen anytime.
const WHY_TWO_TEACH_VIEWS = 3;

export default function RatingChip({
  level,
  pm25,
  isNow,
  timeLabel,
  headline,
  sensor,
  sources,
  aqiSource,
  onSourceChange,
  units,
  onExplain,
}) {
  if (!level) return null;
  const aqi = ugm3ToAqi(pm25);
  const category = aqiCategory(aqi);
  const both = !!(sources?.official && sources?.local);
  const disagree = both && Math.abs(sources.official.aqi - sources.local.aqi) >= DISAGREE_AQI_GAP;
  const primaryValue = units === 'aqi' ? aqi : Math.round(pm25);
  const secondaryValue =
    units === 'aqi' ? `${Math.round(pm25)} µg/m³ PM2.5` : `AQI ${aqi} · ${category?.name}`;

  // Open by default for the first WHY_TWO_TEACH_VIEWS disagreement views, then
  // collapsed; the toggle lets the user reopen it. Sensor data arrives async,
  // so count the first time disagree flips true this mount (not on mount).
  const [whyOpen, setWhyOpen] = useState(false);
  const countedRef = useRef(false);
  useEffect(() => {
    if (!(disagree && isNow) || countedRef.current) return;
    countedRef.current = true;
    const seen = getJSON('whyTwoSeen') || 0;
    setWhyOpen(seen < WHY_TWO_TEACH_VIEWS);
    setJSON('whyTwoSeen', seen + 1);
  }, [disagree, isNow]);

  return (
    <div className={`rating-chip rating-chip--${level.key}`}>
      {both && (
        <div className="rating-chip__sources" role="group" aria-label="Reading source">
          <button
            type="button"
            className={
              'rating-chip__source' + (aqiSource !== 'local' ? ' rating-chip__source--on' : '')
            }
            onClick={() => onSourceChange('official')}
          >
            Official · {sources.official.aqi}
          </button>
          <button
            type="button"
            className={
              'rating-chip__source' + (aqiSource === 'local' ? ' rating-chip__source--on' : '')
            }
            onClick={() => onSourceChange('local')}
          >
            Local · {sources.local.aqi}
          </button>
        </div>
      )}
      <div className="rating-chip__aqi-row">
        <button type="button" className="rating-chip__aqi" onClick={onExplain}>
          {primaryValue}
        </button>
        <span className="rating-chip__aqi-meta">
          <button type="button" className="rating-chip__aqi-label" onClick={onExplain}>
            <span className="rating-chip__aqi-dot" style={{ background: category?.color }} />
            {secondaryValue}
          </button>
          <span className="rating-chip__aqi-sub">
            {sensor
              ? aqiSource === 'local' && sources?.local
                ? `${sensor.count} local sensor${sensor.count === 1 ? '' : 's'}${
                    sensor.medianDistanceMi != null ? `, typically ~${sensor.medianDistanceMi} mi away` : ' nearby'
                  }`
                : `official monitor${sensor.distanceMi != null ? ` ~${sensor.distanceMi} mi away` : ' reading'}`
              : ''}
          </span>
        </span>
        <span className="rating-chip__time">{isNow ? 'Now' : timeLabel}</span>
      </div>
      <button type="button" className="rating-chip__name" onClick={onExplain}>
        {level.name}
      </button>
      {headline && (
        <button type="button" className="rating-chip__clear" onClick={onExplain}>
          {headline}
        </button>
      )}
      <button type="button" className="rating-chip__notice" onClick={onExplain}>
        {level.notice}
      </button>
      <button type="button" className="rating-chip__explain" onClick={onExplain}>
        What this means
      </button>
      {disagree && isNow && (
        <div className="rating-chip__why-two">
          <button
            type="button"
            className="rating-chip__why-toggle"
            onClick={() => setWhyOpen((v) => !v)}
            aria-expanded={whyOpen}
          >
            Why two numbers?
            <span className="rating-chip__why-caret">{whyOpen ? '–' : '+'}</span>
          </button>
          {whyOpen && (
            <p className="rating-chip__why-body">
              Official is the nearest government monitor,{' '}
              {sources.official.distanceMi != null
                ? `about ${sources.official.distanceMi} miles from you`
                : 'which can sit many miles away'}
              . Local is the median of {sources.local.count} PurpleAir sensor
              {sources.local.count === 1 ? '' : 's'}
              {sources.local.medianDistanceMi != null
                ? `, typically about ${sources.local.medianDistanceMi} miles away`
                : ' around you'}
              . Fast-moving smoke makes them disagree, and the reading closer to you is usually
              the better bet.
            </p>
          )}
        </div>
      )}
      {level.index >= OLFACTORY_FATIGUE_LEVEL_INDEX ? (
        <div className="rating-chip__caveat">
          Your nose stops noticing smoke after a while. The smoke doesn't stop.
        </div>
      ) : (
        level.index >= 1 && <div className="rating-chip__caveat">{NOSE_CAVEAT}</div>
      )}
    </div>
  );
}
