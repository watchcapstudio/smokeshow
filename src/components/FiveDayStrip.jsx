import { useEffect, useRef, useState } from 'react';
import { buildDaySummaries, buildPastDaySummaries, bucketForPM25 } from '../lib/days.js';
import { levelForPM25 } from '../lib/rating.js';
import { ugm3ToAqi, aqiToUgm3 } from '../lib/aqi.js';
import './FiveDayStrip.css';

// Cigarette equivalence only surfaces at "Tastes like fire" and above (brief rule).
const CIG_THRESHOLD = 55;

// Ports glideTo() (demo ~line 1306): 650ms cubic ease-out, straight jump
// under prefers-reduced-motion. Scrolls the tapped day into view instead of
// snapping — the measurement below runs once per tap, never per frame.
function glideScrollTo(container, targetLeft) {
  if (!container) return;
  const from = container.scrollLeft;
  const to = Math.max(0, targetLeft);
  if (Math.abs(to - from) < 1) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    container.scrollLeft = to;
    return;
  }
  const start = performance.now();
  const duration = 650;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    container.scrollLeft = from + (to - from) * easeOutCubic(t);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function glideToElement(container, el) {
  if (!container || !el) return;
  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const target =
    container.scrollLeft + (elRect.left - containerRect.left) - (containerRect.width - elRect.width) / 2;
  glideScrollTo(container, target);
}

function DayBox({ day, measured, selected, onSelect }) {
  return (
    <button
      type="button"
      className={
        `five-day-strip__day five-day-strip__day--${(measured ? levelForPM25(aqiToUgm3(measured.aqi)) : day.level)?.key}` +
        (day.isPast ? ' five-day-strip__day--past' : '') +
        (selected ? ' five-day-strip__day--selected' : '')
      }
      onClick={(e) => onSelect(e.currentTarget)}
      aria-pressed={selected}
    >
      <div className="five-day-strip__weekday">{day.weekday}</div>
      <div className="five-day-strip__level">
        {(measured ? levelForPM25(aqiToUgm3(measured.aqi)) : day.level)?.name}
      </div>
      <div className="five-day-strip__range">
        {measured
          ? `AQI ${measured.aqi}`
          : day.max != null &&
            (() => {
              const lo = ugm3ToAqi(day.min ?? day.max);
              const hi = ugm3ToAqi(day.max);
              return lo === hi ? `AQI ${hi}` : `AQI ${lo}–${hi}`;
            })()}
      </div>
      {day.isPast ? (
        <div className="five-day-strip__tag">{measured ? 'measured' : 'model estimate'}</div>
      ) : (
        day.dayParts && (
          <div
            className="five-day-strip__parts"
            title={day.dayParts
              .filter((p) => p.bucket)
              .map((p) => `${p.label}: ${p.bucket.name}`)
              .join(' · ')}
          >
            {day.dayParts.map((p) => (
              <span
                key={p.key}
                className="five-day-strip__part"
                style={{ background: p.bucket ? p.bucket.color : 'transparent' }}
              />
            ))}
          </div>
        )
      )}
    </button>
  );
}

function DayHours({ hours }) {
  const [pickedIdx, setPickedIdx] = useState(null);
  const scaleMax = Math.max(35, ...hours.map((h) => h.v ?? 0));
  const picked = pickedIdx != null ? hours.find((h) => h.i === pickedIdx) : null;
  return (
    <div className="day-detail__chart">
      <div className="day-detail__readout">
        {picked
          ? `${picked.label}: AQI ${ugm3ToAqi(picked.v) ?? '—'}${picked.v == null ? '' : ` (${Math.round(picked.v)} µg/m³)`}`
          : 'Tap a bar for the hour’s number'}
      </div>
      <div className="day-detail__bars">
        {hours.map((h) => (
          <button
            type="button"
            key={h.i}
            className={
              'day-detail__bar-slot' +
              (pickedIdx === h.i ? ' day-detail__bar-slot--picked' : '')
            }
            onClick={() => setPickedIdx((cur) => (cur === h.i ? null : h.i))}
            aria-label={`${h.label}: ${h.v == null ? 'no data' : Math.round(h.v) + ' µg/m³'}`}
          >
            <div
              className="day-detail__bar"
              style={{
                height: `${Math.max(3, ((h.v ?? 0) / scaleMax) * 48)}px`,
                background: bucketForPM25(h.v)?.color ?? 'transparent',
              }}
            />
          </button>
        ))}
      </div>
      <div className="day-detail__hour-labels">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>11p</span>
      </div>
    </div>
  );
}

function DayDetail({ day, hours, measured }) {
  const peakLevel = levelForPM25(day.max);
  if (!peakLevel) return null;
  const peakHour = hours.reduce(
    (best, h) => (h.v != null && (best == null || h.v > best.v) ? h : best),
    null,
  );
  return (
    <div className="day-detail">
      <p className="day-detail__headline">
        {day.weekday}
        {day.isPast ? (measured ? ' (past)' : ' (past, model estimate)') : ''}:{' '}
        {measured ? `monitors measured a daily AQI of ${measured.aqi}. Model hourly: ` : ''}AQI {ugm3ToAqi(day.min ?? day.max)}–
        {ugm3ToAqi(day.max)}, that's {Math.round(day.min ?? day.max)}–{Math.round(day.max)} µg/m³
        of fine particles, peak{day.isPast ? 'ed' : 'ing'} at <strong>{peakLevel.name}</strong>
        {peakHour ? ` around ${peakHour.label}` : ''}.
      </p>
      <DayHours hours={hours} />
      <p className="day-detail__notice">{peakLevel.notice}</p>
      {day.max >= CIG_THRESHOLD && peakLevel.key === 'smokeshow' && (
        <p className="day-detail__notice">
          A full day breathing the peak level is on the order of smoking a few cigarettes.
        </p>
      )}
      <p className="day-detail__what">
        <strong>What these numbers mean:</strong> AQI is the 0 to 500 scale most weather apps
        lead with. It's a translation, not a measurement. The measurement is µg/m³: micrograms of
        fine particles (PM2.5) in each cubic meter of air, dust so small it slips past your nose
        and settles deep in your lungs. The two map to each other: AQI 50 is 9 µg/m³, AQI 100 is
        35 (about where most noses start noticing smoke), AQI 150 is 55, and past AQI 200
        everyone belongs indoors. Two apps can show different numbers for the same air because
        they average different hours and blend different sensors. The air didn't change. The math
        did.
      </p>
    </div>
  );
}

export default function FiveDayStrip({
  timesUTC,
  pm25,
  nowIndex,
  timezone,
  measuredDays,
  // Stage mode: pills only, no inline detail. Tapping a day drives the shared
  // scrubber (onPickDay) and the highlight follows the scrubbed hour.
  compact = false,
  activeIndex,
  onPickDay,
}) {
  const [showPast, setShowPast] = useState(false);
  const stripRef = useRef(null);

  // The past panel slides open (max-width transition), pushing the newest past
  // day — the rightmost box, adjacent to today — toward the right fold. On a
  // narrow phone that box clips at the strip's right edge. Chrome/Firefox mask
  // this with scroll anchoring; iOS Safari has none (and ignores overflow-anchor),
  // so on iPhone the newest day just hides. Once the panel finishes expanding,
  // scroll the strip the minimum needed to bring that box fully into view.
  // scrollBy on the strip keeps it horizontal-only (no page jump) and no-ops
  // when the row already fits.
  useEffect(() => {
    const strip = stripRef.current;
    if (!showPast || !strip) return;
    const panel = strip.querySelector('.five-day-strip__past');
    const newest = panel?.lastElementChild;
    if (!newest) return;
    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      const s = strip.getBoundingClientRect();
      const n = newest.getBoundingClientRect();
      let delta = 0;
      if (n.right > s.right) delta = n.right - s.right; // clipped at the right fold
      else if (n.left < s.left) delta = n.left - s.left; // clipped at the left edge
      if (delta) strip.scrollBy({ left: delta, behavior: 'smooth' });
    };
    const onEnd = (e) => {
      if (e.propertyName === 'max-width') reveal();
    };
    panel.addEventListener('transitionend', onEnd);
    const fallback = setTimeout(reveal, 450); // reduced-motion / no transitionend
    return () => {
      panel.removeEventListener('transitionend', onEnd);
      clearTimeout(fallback);
    };
  }, [showPast]);
  // undefined = untouched (default to today's panel open); null = user closed it
  const [selectedKey, setSelectedKey] = useState(undefined);

  const days = buildDaySummaries({ timesUTC, pm25, nowIndex, timezone });
  const pastDays = buildPastDaySummaries({ timesUTC, pm25, nowIndex, timezone });

  // Local-day key for a series index, and the midday index for a day key — the
  // two directions the compact strip needs to sync with the scrubber.
  const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
  const keyOfIndex = (i) => dayKeyFmt.format(new Date(timesUTC[i] + 'Z'));
  const middayIndexOf = (key) => {
    let best = null;
    let bestGap = Infinity;
    for (let i = 0; i < timesUTC.length; i++) {
      if (keyOfIndex(i) !== key) continue;
      const hour = new Date(timesUTC[i] + 'Z').getUTCHours();
      const gap = Math.abs(hour - 18); // ~local midday for US zones; good enough to land in-day
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    return best;
  };

  // In compact mode the highlight tracks the scrubbed hour instead of an
  // internal selection, so the strip and the curve always agree.
  const compactKey =
    compact && activeIndex != null && timesUTC[activeIndex] ? keyOfIndex(activeIndex) : null;
  const effectiveKey = compact
    ? compactKey
    : selectedKey === undefined
      ? days[0]?.key
      : selectedKey;
  const selectedDay = compact
    ? null
    : ([...pastDays, ...days].find((d) => d.key === effectiveKey) ?? null);

  // Hourly series for the selected local day — feeds the bar chart.
  let selectedHours = [];
  if (selectedDay) {
    const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    const labelFmt = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: true,
      timeZone: timezone,
    });
    for (let i = 0; i < timesUTC.length; i++) {
      const d = new Date(timesUTC[i] + 'Z');
      if (keyFmt.format(d) === selectedDay.key) {
        selectedHours.push({ i, label: labelFmt.format(d), v: pm25[i] });
      }
    }
  }

  function toggleSelect(key, el) {
    if (compact) {
      const idx = middayIndexOf(key);
      if (idx != null) onPickDay?.(idx);
      if (el) glideToElement(stripRef.current, el);
      return;
    }
    const next = effectiveKey === key ? null : key;
    setSelectedKey(next);
    if (next && el) glideToElement(stripRef.current, el);
  }

  return (
    <div className="five-day-strip-wrap">
      <div className="five-day-strip" ref={stripRef}>
        {pastDays.length > 0 && (
          <button
            type="button"
            className="five-day-strip__toggle"
            onClick={() => setShowPast((v) => !v)}
            aria-expanded={showPast}
            aria-label={showPast ? 'Hide the last three days' : 'Show the last three days'}
          >
            <span className="five-day-strip__toggle-arrow">{showPast ? '›' : '‹'}</span>
            <span className="five-day-strip__toggle-label">past</span>
          </button>
        )}
        <div className={'five-day-strip__past' + (showPast ? ' five-day-strip__past--open' : '')}>
          {pastDays.map((day) => (
            <DayBox
              key={day.key}
              day={day}
              measured={measuredDays?.get(day.key) ?? null}
              selected={effectiveKey === day.key}
              onSelect={(el) => toggleSelect(day.key, el)}
            />
          ))}
        </div>
        <div className="five-day-strip__days">
          {days.map((day) => (
            <DayBox
              key={day.key}
              day={day}
              selected={effectiveKey === day.key}
              onSelect={(el) => toggleSelect(day.key, el)}
            />
          ))}
        </div>
      </div>
      {selectedDay && (
        <DayDetail
          key={selectedDay.key}
          day={selectedDay}
          hours={selectedHours}
          measured={measuredDays?.get(selectedDay.key) ?? null}
        />
      )}
    </div>
  );
}
