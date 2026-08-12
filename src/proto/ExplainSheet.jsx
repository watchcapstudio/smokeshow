// "What this means" — where suggestion 5's material lands.
//
// The live verdict card currently carries the source tabs, the "Why two
// numbers?" expander and the nose caveat inline, which is three explanations
// stacked on top of the answer. iOS keeps all of it in the sheet; so does this.
//
// Every rung of the ladder and every guidance line is read straight off the
// payload's `scale[]`, and the disclaimer is the brief's text verbatim — the
// same rule `ParityTests.testDisclaimerMatchesTheBriefWordForWord` enforces on
// the Swift side. Copy pasted into a component is copy that drifts.

import { useEffect, useRef } from 'react';

export default function ExplainSheet({ open, onClose, level, scale, measured, agreement }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const entry = scale.find((s) => s.index === level?.index) ?? null;
  const both = measured?.official && measured?.local;

  return (
    <div className="proto-sheet" role="dialog" aria-modal="true" aria-label="What this means">
      <button
        type="button"
        className="proto-sheet__scrim"
        aria-label="Close"
        onClick={onClose}
        tabIndex={-1}
      />
      <div className="proto-sheet__panel">
        <div className="proto-sheet__head">
          <h2>What this means</h2>
          <button type="button" ref={closeRef} className="proto-sheet__done" onClick={onClose}>
            Done
          </button>
        </div>

        {entry && (
          <section className="proto-sheet__section">
            <h3>
              {entry.name} · {entry.rangeUg} µg/m³
            </h3>
            <p>{entry.notice}</p>
            <p className="proto-sheet__dim">{entry.notLine}</p>
            <p className="proto-sheet__dim">Visibility: {entry.visibility}</p>
            <p className="proto-sheet__dim">EPA guidance: {entry.guidance.general}</p>
          </section>
        )}

        <section className="proto-sheet__section">
          <h3>The scale</h3>
          <ol className="proto-ladder">
            {scale.map((s) => (
              <li
                key={s.key}
                className={
                  'proto-ladder__rung' +
                  (s.index === level?.index ? ' proto-ladder__rung--on' : '')
                }
              >
                <i className={`proto-ladder__pip proto-ladder__pip--${s.key}`} />
                <span className="proto-ladder__name">
                  {s.name} · {s.rangeUg}
                </span>
                <span className="proto-ladder__vis">{s.visibility}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* Suggestion 5, the part with the most words in it: the two-instrument
            explanation is a paragraph, and a paragraph does not belong on the
            horizon of a one-screen verdict. */}
        {both && (
          <section className="proto-sheet__section">
            <h3>Why two numbers?</h3>
            <p>
              Station is the nearest regulatory-grade monitor, about{' '}
              {measured.official.distanceMi} miles from you, reading AQI {measured.official.aqi}.
              Local is the median of {measured.local.count} neighborhood sensors, typically about{' '}
              {measured.local.medianDistanceMi} miles away, reading AQI {measured.local.aqi}.
            </p>
            <p>
              They are shown separately and never blended. During fast-moving smoke a monitor tens
              of miles away and a cluster of sensors nearby legitimately disagree, and averaging
              them would produce a number neither one reported.
            </p>
            <p className="proto-sheet__dim">
              Hours before now are model estimate — model reanalysis, not readings.
            </p>
          </section>
        )}

        {/* Where the agreement line under the curve lands. The one-liner on
            the window says what; this says what it means and what to do with
            it, which is the split the sheet exists for. */}
        {agreement && (
          <section className="proto-sheet__section">
            <h3>How sure is this?</h3>
            <p>{agreement.label}.</p>
            {agreement.diverged ? (
              <p>
                Two models are running the same hours and putting the smoke in different places.
                The shaded stretch on the curve is where they disagree — treat the timing there
                as rough, and check back rather than planning around the exact hour.
              </p>
            ) : (
              <p>
                Nothing is contradicting this forecast right now. Confidence still falls off past
                about 36 hours, which is why the curve washes out toward its right edge — that is
                lead time, not a disagreement.
              </p>
            )}
            <p className="proto-sheet__dim">
              Forecasts are model estimates. Hours before now are model reanalysis, not readings.
            </p>
          </section>
        )}

        <section className="proto-sheet__section">
          <h3>The fine print</h3>
          <p className="proto-sheet__dim">
            <strong>Smokeshow is for informational and educational purposes only.</strong> It is
            not health, medical, or safety advice. Forecasts are model estimates and can be wrong,
            sometimes by a lot. Descriptions of what you might smell, see, or feel are
            generalizations, not predictions about your body. For decisions about your health,
            outdoor activity, or air quality safety, rely on official sources like AirNow.gov, the
            National Weather Service, and your local health authorities, and talk to a medical
            professional about your own situation.
          </p>
        </section>
      </div>
    </div>
  );
}
