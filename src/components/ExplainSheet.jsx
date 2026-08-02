import { useEffect, useRef } from 'react';
import { LEVELS, NOT_LINES, EPA_LINES, EPA_SENS, RANGES } from '../lib/rating.js';
import { ugm3ToAqi } from '../lib/aqi.js';
import './ExplainSheet.css';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function planLine(level, days) {
  if (level.index === 0) return "It's clear right now. Go.";
  if (!days || !days.length) return 'Check back — the forecast will fill in shortly.';
  // Prefer a day other than today when one exists; "the plan" is about what's next.
  const pool = days.length > 1 ? days.slice(1) : days;
  const best = pool.reduce((a, b) => ((b.max ?? Infinity) < (a.max ?? Infinity) ? b : a));
  return `Cleanest upcoming air is ${best.weekday}. Don't cancel the lake day; move it.`;
}

export default function ExplainSheet({
  open,
  onClose,
  level,
  pm25,
  units,
  sensitive,
  days,
  sensorNow,
  onUnitsChange,
  onSensitiveChange,
}) {
  const sheetRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement;
    const node = sheetRef.current;
    const focusables = node?.querySelectorAll(FOCUSABLE_SELECTOR);
    (focusables?.[0] ?? node)?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = node?.querySelectorAll(FOCUSABLE_SELECTOR);
      if (!items || items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !level || pm25 == null) return null;

  const eyebrowNumber =
    units === 'aqi' ? `AQI ${ugm3ToAqi(pm25)} (approx)` : `${Math.round(pm25)} µg/m³`;
  const measured = sensorNow && (sensorNow.official || sensorNow.local) ? sensorNow : null;

  return (
    <>
      <div className="explain-sheet-backdrop" onClick={onClose} />
      <div
        className="explain-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="What this means"
        tabIndex={-1}
      >
        <button type="button" className="explain-sheet__grab" aria-label="Close" onClick={onClose} />
        <div className="explain-sheet__eyebrow mono">
          Level {level.index + 1} of 5 · {eyebrowNumber} · model estimate
        </div>
        <div className="explain-sheet__ladder">
          {LEVELS.map((l) => (
            <div
              key={l.key}
              className={
                'explain-sheet__rung' +
                (l.index === level.index ? ' explain-sheet__rung--current' : '')
              }
            >
              <span className={`explain-sheet__pip explain-sheet__pip--${l.key}`} />
              <span className="explain-sheet__rung-name">{l.name}</span>
              <span className="explain-sheet__rung-range mono">{RANGES[l.index]}</span>
            </div>
          ))}
        </div>
        <p className="explain-sheet__p">{NOT_LINES[level.index]}</p>
        <p className="explain-sheet__p">
          <span className="explain-sheet__lead">
            {sensitive ? 'For your household (EPA sensitive-groups guidance):' : "EPA's guidance at this level:"}
          </span>{' '}
          {sensitive ? EPA_SENS[level.index] : EPA_LINES[level.index]}
        </p>
        <p className="explain-sheet__p">
          <span className="explain-sheet__lead">The plan:</span> {planLine(level, days)}
        </p>
        {measured && (
          <div className="explain-sheet__measured">
            <div className="explain-sheet__eyebrow mono">Measured right now</div>
            {measured.official && (
              <div className="explain-sheet__meas-row">
                <span className="explain-sheet__who">
                  Monitoring station
                  <small>
                    {[
                      measured.official.area,
                      measured.official.distanceMi != null
                        ? `${measured.official.distanceMi} mi away`
                        : 'regulatory grade',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <span className="explain-sheet__val">AQI {measured.official.aqi}</span>
              </div>
            )}
            {measured.local && (
              <div className="explain-sheet__meas-row">
                <span className="explain-sheet__who">
                  Local sensors
                  <small>
                    {measured.local.count ? `${measured.local.count} nearby` : 'consumer grade'}
                    {measured.local.medianDistanceMi != null
                      ? ` · ~${measured.local.medianDistanceMi} mi`
                      : ''}
                  </small>
                </span>
                <span className="explain-sheet__val">AQI {measured.local.aqi}</span>
              </div>
            )}
            <div className="explain-sheet__meas-row explain-sheet__meas-row--model">
              <span className="explain-sheet__who">
                Model, for this spot
                <small>what the forecast above uses</small>
              </span>
              <span className="explain-sheet__val">AQI {ugm3ToAqi(pm25)}</span>
            </div>
            <p className="explain-sheet__p explain-sheet__p--fine">
              Monitoring stations are accurate but sparse; local sensors are close but
              consumer-grade. When they disagree during moving smoke, that gap is the real
              signal, so we show both instead of averaging them into a number neither one
              reported.
            </p>
          </div>
        )}
        <div className="explain-sheet__prefs">
          <div className="explain-sheet__prefs-row">
            <span>Numbers shown as</span>
            <div className="explain-sheet__seg" role="group" aria-label="Units">
              <button
                type="button"
                className={units !== 'aqi' ? 'explain-sheet__seg-btn explain-sheet__seg-btn--on' : 'explain-sheet__seg-btn'}
                aria-pressed={units !== 'aqi'}
                onClick={() => onUnitsChange('ug')}
              >
                µg/m³
              </button>
              <button
                type="button"
                className={units === 'aqi' ? 'explain-sheet__seg-btn explain-sheet__seg-btn--on' : 'explain-sheet__seg-btn'}
                aria-pressed={units === 'aqi'}
                onClick={() => onUnitsChange('aqi')}
              >
                AQI
              </button>
            </div>
          </div>
          <div className="explain-sheet__prefs-row">
            <span>
              Sensitive household
              <small>Asthma, young kids, older adults, pregnancy, heart or lung conditions.</small>
            </span>
            <button
              type="button"
              className={sensitive ? 'explain-sheet__toggle explain-sheet__toggle--on' : 'explain-sheet__toggle'}
              role="switch"
              aria-checked={sensitive}
              onClick={() => onSensitiveChange(!sensitive)}
            />
          </div>
        </div>
        <div className="explain-sheet__caveat">
          For health decisions rely on AirNow.gov, local authorities, and your doctor.
        </div>
      </div>
    </>
  );
}
