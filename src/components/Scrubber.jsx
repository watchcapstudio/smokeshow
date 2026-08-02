import { formatLocalTime } from '../lib/time.js';
import './Scrubber.css';

function isNightHour(timeUTCStr, tz) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(
      new Date(timeUTCStr + 'Z'),
    ),
  );
  return hour >= 20 || hour < 6;
}

export default function Scrubber({
  timesUTC,
  windowStart,
  windowEnd,
  selectedIndex,
  nowIndex,
  onScrub,
  playing,
  onTogglePlay,
  timezone,
}) {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const length = windowEnd - windowStart || 1;
  const label = formatLocalTime(timesUTC[selectedIndex], tz);
  const isModelEstimate = selectedIndex < nowIndex;

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
        <div
          className="scrubber__now-marker"
          style={{ left: `${((nowIndex - windowStart) / length) * 100}%` }}
        />
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
