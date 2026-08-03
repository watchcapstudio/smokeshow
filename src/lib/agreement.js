import { levelForPM25 } from './rating.js';

const LEAD_TIME_FADE_HOURS = 36; // beyond this, uncertainty is structural
const DIVERGE_ABS_DIFF = 15; // µg/m³

// Agreement inputs:
//   1. multi-model: CAMS vs HRRR at the same valid hour (real "models split")
//   2. lead-time fade: forecasts past +36h are structurally less certain
// hrrrSeries is a Map(timeUTC -> µg/m³) from lib/smokeFrames.js, or null when the
// HRRR feed is unavailable / the location is outside CONUS.
export function computeAgreement({ timesUTC, pm25, fetchedAtMs, hrrrSeries }) {
  return timesUTC.map((t, idx) => {
    const validMs = new Date(t + 'Z').getTime();
    const leadHours = (validMs - fetchedAtMs) / 3_600_000;
    let status = 'agree';

    if (leadHours > LEAD_TIME_FADE_HOURS) status = 'fade';

    if (hrrrSeries) {
      const hrrrVal = hrrrSeries.get(t);
      const camsVal = pm25[idx];
      if (hrrrVal != null && camsVal != null) {
        const diff = Math.abs(hrrrVal - camsVal);
        const hrrrLevel = levelForPM25(hrrrVal)?.index;
        const camsLevel = levelForPM25(camsVal)?.index;
        if (diff > DIVERGE_ABS_DIFF || hrrrLevel !== camsLevel) status = 'diverge';
      }
    }

    return { timeUTC: t, status };
  });
}

export function summarizeAgreement(agreement, { multiModel = false } = {}) {
  if (!multiModel) {
    // Single model (outside HRRR's CONUS coverage): nothing to compare,
    // only the honest structural note.
    return { label: 'Single-model forecast. Confidence fades past 36 hours.', diverged: false };
  }
  const hasDiverge = agreement.some((a) => a.status === 'diverge');
  return hasDiverge
    ? { label: 'Models split on timing', diverged: true }
    : { label: 'Models agree', diverged: false };
}
