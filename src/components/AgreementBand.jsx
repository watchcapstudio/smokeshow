import { summarizeAgreement } from '../lib/agreement.js';
import './AgreementBand.css';

function AgreementCurves({ timesUTC, windowStart, windowEnd, currentPM25, hrrrSeries }) {
  const width = 320;
  const height = 80;
  const idxs = [];
  for (let i = windowStart; i <= windowEnd; i++) idxs.push(i);

  function hrrrValueFor(i) {
    return hrrrSeries?.get(timesUTC[i]) ?? null;
  }

  const allValues = [
    ...idxs.map((i) => currentPM25[i] ?? 0),
    ...idxs.map((i) => hrrrValueFor(i) ?? 0),
    50,
  ];
  const maxVal = Math.max(...allValues);

  function toPoints(getVal) {
    return idxs
      .map((i, k) => {
        const x = (k / Math.max(1, idxs.length - 1)) * width;
        const v = getVal(i);
        const y = v == null ? null : height - (Math.min(v, maxVal) / maxVal) * height;
        return y == null ? null : `${x},${y}`;
      })
      .filter(Boolean)
      .join(' ');
  }

  return (
    <>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="agreement-band__chart"
        preserveAspectRatio="none"
        role="img"
        aria-label="Forecast model curves compared"
      >
        <polyline
          points={toPoints(hrrrValueFor)}
          className="agreement-band__line agreement-band__line--hrrr"
          fill="none"
        />
        <polyline
          points={toPoints((i) => currentPM25[i])}
          className="agreement-band__line agreement-band__line--current"
          fill="none"
        />
      </svg>
      <div className="agreement-band__legend">
        <span className="agreement-band__legend-item agreement-band__legend-item--current">
          CAMS (Europe's model)
        </span>
        <span className="agreement-band__legend-item agreement-band__legend-item--hrrr">
          NOAA HRRR-Smoke (US model)
        </span>
      </div>
    </>
  );
}

export default function AgreementBand({
  agreement,
  windowStart,
  windowEnd,
  timesUTC,
  currentPM25,
  hrrrSeries,
}) {
  const windowAgreement = agreement.slice(windowStart, windowEnd + 1);
  const { label } = summarizeAgreement(windowAgreement, {
    multiModel: !!hrrrSeries,
  });
  const segWidth = 100 / Math.max(1, windowAgreement.length);

  return (
    <div className="agreement-band">
      <div className="agreement-band__track">
        {windowAgreement.map((a, k) => (
          <div
            key={k}
            className={`agreement-band__seg agreement-band__seg--${a.status}`}
            style={{ width: `${segWidth}%` }}
          />
        ))}
      </div>
      <p className="agreement-band__summary">{label}</p>
      {hrrrSeries && (
        <div className="agreement-band__detail">
          <AgreementCurves
            timesUTC={timesUTC}
            windowStart={windowStart}
            windowEnd={windowEnd}
            currentPM25={currentPM25}
            hrrrSeries={hrrrSeries}
          />
          <p className="agreement-band__caveat">
            When these lines separate, treat timing as uncertain by ±6–12 hours.
          </p>
        </div>
      )}
      <p className="agreement-band__standing-caveat">
        All smoke models depend on satellites seeing the fires. Clouds or thick smoke can hide
        fires, and hidden fires aren't in any forecast.
      </p>
    </div>
  );
}
