import { useId, useMemo } from 'react';
import { ARRIVAL_THRESHOLD } from '../lib/rating.js';
import { formatLocalTime } from '../lib/time.js';
import Ridgeline from './Ridgeline.jsx';
import { STORE_BADGES_ENABLED } from '../lib/featureFlags.js';
import './AppWidgetCTA.css';

// TODO: point these at the real store listings once the apps ship — the
// STORE_BADGES_ENABLED flag keeps them off the page (and un-clickable) until then.
const APP_STORE_URL = 'https://apps.apple.com/app/smokeshow';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=earth.smokeshow';

// A widget-sized version of Scrubber's buildCurve() (src/components/Scrubber.jsx):
// same area-chart shape, plus a dot at the scrub position so the mock visibly
// tracks the visitor's own timeline instead of freezing on "now".
function buildMiniCurve(pm25, windowStart, windowEnd, nowIndex, dotIndex, w, h) {
  const pad = 3;
  const length = Math.max(1, windowEnd - windowStart);
  const vals = [];
  for (let i = windowStart; i <= windowEnd; i++) vals.push(pm25?.[i] ?? 0);
  const maxV = Math.max(55, Math.max(...vals) * 1.15);
  const x = (i) => (i / length) * w;
  const y = (v) => h - pad - (Math.min(v, maxV) / maxV) * (h - pad * 2);
  const pts = vals.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`);
  const dotK = dotIndex - windowStart;
  const nowK = nowIndex - windowStart;
  return {
    areaD: `M0,${h} L${pts.join(' L')} L${w},${h} Z`,
    lineD: `M${pts.join(' L')}`,
    thresholdY: y(ARRIVAL_THRESHOLD).toFixed(1),
    nowX: x(nowK).toFixed(1),
    dotX: x(dotK).toFixed(1),
    dotY: y(vals[dotK] ?? 0).toFixed(1),
  };
}

// The lock-screen countdown accessory: hours from right now to whichever
// real change is next, read straight off the same verdict the rating chip's
// headline already uses — one source of truth, fixed to "now" exactly like a
// real widget's last refresh, so it can't drift into a different answer the
// way the demo's puppet tables once did (platform plan §6). Only the PM
// number arc and the widget faces track the scrub position — this one
// doesn't simulate a future refresh, because a real widget wouldn't either.
function nextChange(verdict, nowIndex) {
  if (verdict.above) {
    if (verdict.clearIdx != null) {
      const dh = Math.max(1, verdict.clearIdx - nowIndex);
      return { txt: `${dh}h`, label: 'TO CLEAR', color: 'var(--all-clear)', frac: Math.min(1, dh / 48) };
    }
    return { txt: '5d+', label: 'SMOKY', color: 'var(--smokeshow)', frac: 1 };
  }
  if (verdict.arrivalIdx != null) {
    const dh = Math.max(1, verdict.arrivalIdx - nowIndex);
    return { txt: `${dh}h`, label: 'TO SMOKE', color: 'var(--tastes)', frac: Math.min(1, dh / 48) };
  }
  return { txt: '5d+', label: 'CLEAR', color: 'var(--all-clear)', frac: 1 };
}

function WidgetCurve({ curve, uid, thin }) {
  return (
    <svg className="cta-widget__curve" viewBox={`0 0 ${curve.w} ${curve.h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--ink)' }} stopOpacity={thin ? 0.28 : 0.34} />
          <stop offset="1" style={{ stopColor: 'var(--ink)' }} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={curve.areaD} fill={`url(#${uid})`} />
      {!thin && (
        <>
          <line
            className="cta-widget__curve-threshold"
            x1="0"
            x2={curve.w}
            y1={curve.thresholdY}
            y2={curve.thresholdY}
          />
          <line className="cta-widget__curve-now" x1={curve.nowX} x2={curve.nowX} y1="0" y2={curve.h} />
        </>
      )}
      <path className="cta-widget__curve-line" d={curve.lineD} style={{ strokeWidth: thin ? 1.2 : 1.5 }} />
      <circle className="cta-widget__curve-dot" cx={curve.dotX} cy={curve.dotY} r={thin ? 1.8 : 2.4} />
    </svg>
  );
}

// "Your air, on your Home Screen" — the paid-app pitch, demonstrated with the
// visitor's own forecast instead of a screenshot. Ports the demo's widget
// column (public/ifhghs/demo/index.html renderWidgets(), ~line 1150) but
// drives every pixel from real App state: the live sky custom properties
// SkyBackdrop already writes to <html> (--sky-*, --ink, --sun-*), and the
// same verdict/headline the rating chip shows. Nothing here is a second
// source of truth for the forecast.
export default function AppWidgetCTA({
  pm25,
  timesUTC,
  selectedIndex,
  nowIndex,
  windowStart,
  windowEnd,
  verdict,
  headline,
  level,
  placeName,
  timezone,
}) {
  const uid = useId();
  const pm = pm25?.[selectedIndex];

  const curveSmall = useMemo(
    () => ({ ...buildMiniCurve(pm25, windowStart, windowEnd, nowIndex, selectedIndex, 148, 54), w: 148, h: 54 }),
    [pm25, windowStart, windowEnd, nowIndex, selectedIndex],
  );
  const curveMed = useMemo(
    () => ({ ...buildMiniCurve(pm25, windowStart, windowEnd, nowIndex, selectedIndex, 296, 46), w: 296, h: 46 }),
    [pm25, windowStart, windowEnd, nowIndex, selectedIndex],
  );
  const curveRect = useMemo(
    () => ({ ...buildMiniCurve(pm25, windowStart, windowEnd, nowIndex, selectedIndex, 144, 17), w: 144, h: 17 }),
    [pm25, windowStart, windowEnd, nowIndex, selectedIndex],
  );

  if (pm == null || !level) return null;

  const change = nextChange(verdict, nowIndex);
  const sub = headline || (level.index === 0 ? 'Stays clear' : level.name);
  const loc = (placeName || 'your air').split(',')[0].toUpperCase();
  const clockLabel = timesUTC?.[selectedIndex] ? formatLocalTime(timesUTC[selectedIndex], timezone) : '—';
  const pmArcLen = Math.min(1, pm / 250) * 151;

  return (
    <section className="cta-widgets" aria-labelledby="cta-widgets-heading">
      <div className="cta-widgets__panel panel">
        <p className="eyebrow">SMOKESHOW app · $2.99/month</p>
        <h2 id="cta-widgets-heading" className="cta-widgets__heading">
          Your air, on your Home Screen.
        </h2>
        <p className="cta-widgets__lead">
          See it without looking it up. These widgets are live — they're reading{' '}
          {placeName ? `${loc}'s` : 'your'} forecast right now, and they'll follow it as you scrub the
          timeline above.
        </p>

        <div className="cta-widgets__home">
          <div className="cta-widget cta-widget--small">
            <span className="cta-widget__sun" aria-hidden="true" />
            <span className="cta-widget__scrim" aria-hidden="true" />
            <span className="cta-widget__grain" aria-hidden="true" />
            <div className="cta-widget__ridge">
              <Ridgeline pm25={pm} />
            </div>
            <WidgetCurve curve={curveSmall} uid={`${uid}s`} />
            <div className="cta-widget__loc">{loc}</div>
            <div className="cta-widget__overlay">
              <div className="cta-widget__word">{level.name}</div>
              <div className="cta-widget__sub">{sub}</div>
            </div>
          </div>
          <div className="cta-widget cta-widget--medium">
            <span className="cta-widget__sun" aria-hidden="true" />
            <span className="cta-widget__scrim" aria-hidden="true" />
            <span className="cta-widget__grain" aria-hidden="true" />
            <div className="cta-widget__ridge">
              <Ridgeline pm25={pm} />
            </div>
            <WidgetCurve curve={curveMed} uid={`${uid}m`} />
            <div className="cta-widget__loc">{loc}</div>
            <div className="cta-widget__overlay">
              <div className="cta-widget__word">{level.name}</div>
              <div className="cta-widget__sub">{sub}</div>
            </div>
          </div>
        </div>

        <div className="cta-lock">
          <div className="cta-lock__clock">{clockLabel}</div>
          <div className="cta-lock__inline">
            <span className="cta-lock__pip" style={{ background: `var(--${level.key})` }} />
            {level.name} · {sub}
          </div>
          <div className="cta-lock__row">
            <div className="cta-lock__circ" aria-hidden="true">
              <svg viewBox="0 0 60 60">
                <circle cx="30" cy="30" r="24" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="4.5" />
                <circle
                  cx="30"
                  cy="30"
                  r="24"
                  fill="none"
                  stroke={`var(--${level.key})`}
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeDasharray={`${pmArcLen} 151`}
                  transform="rotate(-90 30 30)"
                />
                <text x="30" y="34" textAnchor="middle" fontSize="15" fontWeight="700" fill="#F4E9D6">
                  {Math.round(pm)}
                </text>
              </svg>
            </div>
            <div className="cta-lock__circ" aria-hidden="true">
              <svg viewBox="0 0 60 60">
                <circle cx="30" cy="30" r="24" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3.5" />
                <circle
                  cx="30"
                  cy="30"
                  r="24"
                  fill="none"
                  stroke={change.color}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={`${change.frac * 151} 151`}
                  transform="rotate(-90 30 30)"
                />
                <text x="30" y="31" textAnchor="middle" fontSize="14" fontWeight="700" fill="#F4E9D6">
                  {change.txt}
                </text>
                <text x="30" y="43" textAnchor="middle" fontSize="6.5" letterSpacing="1" fill="#F4E9D6" opacity="0.7">
                  {change.label}
                </text>
              </svg>
            </div>
            <div className="cta-lock__rect">
              <div className="cta-lock__rect-word">{level.name}</div>
              <div className="cta-lock__rect-sub">{sub}</div>
              <WidgetCurve curve={curveRect} uid={`${uid}r`} thin />
            </div>
          </div>
        </div>

        <p className="cta-widgets__secondary">
          Plus notifications: threshold alerts when smoke arrives, peaks, or clears. No digests, no
          streaks, no engagement pings.
        </p>

        <div className="cta-widgets__footer">
          <p className="cta-widgets__price">
            Coming soon to iOS, macOS &amp; Android. 14-day trial, $2.99/month.
          </p>
          {STORE_BADGES_ENABLED && (
            <div className="cta-widgets__badges">
              <a href={APP_STORE_URL} className="cta-widgets__badge">
                <img src="/badges/app-store-badge.svg" alt="Download on the App Store" width="119" height="40" />
              </a>
              <a href={PLAY_STORE_URL} className="cta-widgets__badge">
                <img src="/badges/google-play-badge.png" alt="Get it on Google Play" width="172" height="60" />
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
