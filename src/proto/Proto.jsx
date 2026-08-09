// CANDIDATE — web front-end redesign, first pass. Lives at /asdfasdf/.
//
// This is the parity review from the iOS build turned into pixels. Nothing here
// is wired into the real app: it imports the production modules (sky, ink,
// rating, verdict, days, trend, aqi, time) and the production components it
// reuses unchanged (SkyBackdrop, Ridgeline), and renders a canned PM2.5 series
// through them. Every word of rating and disclaimer copy is the real copy.
//
// What is being proposed, in the order the suggestions were numbered:
//   1. the verdict is a window, not a card — one viewport, sky to horizon
//   2. the curve is a control and it sits under the words it drives
//   3. the level WORD is the hero; the number is the supporting line
//   4. no panel chrome on the verdict
//   5. sources / "why two numbers" / the nose caveat move into the sheet
//   6. tapping a day drives the scrubber instead of opening an accordion
//   7. the ridge gets the foot of the screen, full bleed
//   9. a "Now" affordance the moment you scrub off the present
//
// Deliberately unchanged and still below the fold: the map, the FAQ, the
// explainer and the disclaimer (see asdfasdf/index.html). Joe's note: the
// bottom material stays on the web, and a city footer joins it.

import { useEffect, useMemo, useState } from 'react';
import SkyBackdrop from '../components/SkyBackdrop.jsx';
import Ridgeline from '../components/Ridgeline.jsx';
import Curve from './Curve.jsx';
import ExplainSheet from './ExplainSheet.jsx';
import LocationSheet from './LocationSheet.jsx';
import InstallNudge from './InstallNudge.jsx';
import { SCENARIOS, rebase } from './scenarios.js';
import { recordVisit, explain as explainInstall } from './installPolicy.js';
import { computeVerdict, verdictHeadline } from '../lib/verdict.js';
import { buildDaySummaries } from '../lib/days.js';
import { levelForPM25 } from '../lib/rating.js';
import { ugm3ToAqi } from '../lib/aqi.js';
import { trendAt } from '../lib/trend.js';
import { formatLocalTime, formatVerdictTime } from '../lib/time.js';
import { summarizeAgreement } from '../lib/agreement.js';
import { renderShareCard } from '../lib/shareCard.js';
import '../styles/tokens.css';
import '../styles/sky.css';
// The bottom of the page is production, unchanged and deliberately so: the
// same shell primitives and the same cream reference sheet the live site
// serves. Only the window above it is new.
import '../styles/shell.css';
import '../styles/seo.css';
import './proto.css';

const TREND_COPY = {
  rising: { text: 'Getting worse', modifier: 'rising' },
  falling: { text: 'Improving', modifier: 'falling' },
  steady: { text: 'Holding steady', modifier: 'steady' },
};
const QUIET_FLOOR = 12; // clear and steady is not worth a chip — matches TrendChip.jsx

export default function Proto() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [selectedIndex, setSelectedIndex] = useState(null); // null = now
  const [explainOpen, setExplainOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [placeOverride, setPlaceOverride] = useState(null);
  const [shareState, setShareState] = useState(null); // null | 'working' | 'copied' | 'failed'
  const [forceNudge, setForceNudge] = useState(false);

  const series = useMemo(() => {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
    return rebase(scenario.fixture, {
      forceDivergeFromNow: scenario.forceDivergeFromNow ?? null,
    });
  }, [scenarioId]);

  const { timesUTC, pm25, nowIndex, timezone: tz, lat, lon, scale } = series;
  const place = placeOverride ?? series.place;

  // One record per load, before anything can ask for the Home Screen.
  useEffect(() => {
    recordVisit();
  }, []);

  // Switching scenarios has to drop the scrub with it: hour 96 of one series
  // is a different moment in another, and holding the index across the change
  // silently moves the reader somewhere they did not ask to be.
  useEffect(() => {
    setSelectedIndex(null);
  }, [scenarioId]);

  const windowStart = Math.max(0, nowIndex - 12);
  const windowEnd = Math.min(timesUTC.length - 1, nowIndex + 48);
  const activeIndex = selectedIndex ?? nowIndex;
  const isNow = selectedIndex == null;

  const verdict = useMemo(() => computeVerdict({ pm25, nowIndex }), [pm25, nowIndex]);
  const headline = useMemo(
    () => verdictHeadline(verdict, (i) => formatVerdictTime(timesUTC[i], tz)),
    [verdict, timesUTC, tz],
  );
  const days = useMemo(
    () => buildDaySummaries({ timesUTC, pm25, nowIndex, timezone: tz }),
    [timesUTC, pm25, nowIndex, tz],
  );

  const shownPM25 = pm25[activeIndex];
  const level = levelForPM25(shownPM25);
  const aqi = ugm3ToAqi(shownPM25);

  const trend = shownPM25 == null ? null : trendAt(pm25, activeIndex, verdict);
  const showTrend = trend && !(trend === 'steady' && shownPM25 < QUIET_FLOOR);

  // Day -> the worst hour inside the scrubbable window, which is the hour a
  // person means when they point at a day and ask "what about then?".
  // Days past +48h cannot be reached, so they dim rather than doing nothing.
  const dayTargets = useMemo(() => {
    const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    const targets = new Map();
    for (let i = windowStart; i <= windowEnd; i++) {
      const key = keyFmt.format(new Date(timesUTC[i] + 'Z'));
      const best = targets.get(key);
      if (best == null || (pm25[i] ?? -1) > (pm25[best] ?? -1)) targets.set(key, i);
    }
    return targets;
  }, [timesUTC, pm25, windowStart, windowEnd, tz]);

  const clockLabel = isNow
    ? formatLocalTime(timesUTC[nowIndex], tz)
    : formatLocalTime(timesUTC[activeIndex], tz);

  // Agreement, said once in words under the curve. summarizeAgreement is the
  // live module and its copy ships verbatim — "Models split on timing" and the
  // single-model line are both from it.
  const agreementNote = useMemo(() => {
    const summary = series.agreementSummary;
    if (summary?.label) return summary;
    return summarizeAgreement(
      series.agreement.map((status) => ({ status })),
      { multiModel: false },
    );
  }, [series]);

  async function handleShare() {
    setShareState('working');
    const shareUrl =
      `https://smokeshow.earth/s?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}` +
      `&name=${encodeURIComponent(place)}&utm_source=share`;
    try {
      // The real card renderer — canvas, no network, so what Joe sees here is
      // the card that would actually be shared.
      const blob = await renderShareCard({
        level: levelForPM25(pm25[nowIndex]),
        aqi: ugm3ToAqi(pm25[nowIndex]),
        placeName: place,
        timeLabel: formatLocalTime(timesUTC[nowIndex], tz),
        headline,
        days,
        diverged: !!agreementNote.diverged,
        url: 'https://smokeshow.earth',
      });
      const file = new File([blob], 'smokeshow.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], url: shareUrl, title: 'SMOKESHOW' });
          setShareState(null);
          return;
        } catch (e) {
          if (e.name === 'AbortError') {
            setShareState(null);
            return;
          }
        }
      }
      // Desktop and anywhere the file share is unavailable: hand over the card
      // as a download and put the link on the clipboard.
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'smokeshow.png';
      a.click();
      URL.revokeObjectURL(a.href);
      await navigator.clipboard?.writeText(shareUrl);
      setShareState('copied');
      setTimeout(() => setShareState(null), 2400);
    } catch {
      setShareState('failed');
      setTimeout(() => setShareState(null), 2400);
    }
  }

  return (
    <>
      <SkyBackdrop
        pm25={shownPM25}
        date={new Date(timesUTC[activeIndex] + 'Z')}
        lat={lat}
        lon={lon}
      />

      {/* The stage is what scopes the ridge. Positioned inside it rather than
          fixed to the viewport, so the land ends where the window ends and
          does not follow the reader down onto the FAQ. */}
      <div className="proto-stage">
      {/* Suggestion 7: the ridge is the bottom of the window, not a 68px band
          floating between two controls. Same component, same ink-following
          haze the live site already gets right — only the frame changed. */}
      <div className="proto-ridge" aria-hidden="true">
        <Ridgeline pm25={shownPM25} />
      </div>

      <main className="proto-window">
        <header className="proto-header">
          <h1 className="proto-wordmark">SMOKESHOW</h1>
          <span className="proto-clock">
            {isNow ? clockLabel : `${clockLabel} · model`}
          </span>
        </header>

        {/* Empty sky. On a clear day you see a lot of it, and that is the
            product doing its job rather than a layout with a hole in it. */}
        <div className="proto-sky-gap" />

        <section className="proto-verdict">
          {/* Suggestion 3: the word is the hero. The live site leads with the
              AQI integer, iOS leads with the word, and the two surfaces
              currently give a reader a different lead answer. */}
          <p className="proto-level">{level?.name ?? 'Unavailable'}</p>

          {showTrend && (
            <p className={`proto-trend proto-trend--${TREND_COPY[trend].modifier}`}>
              <span className="proto-trend__pip" />
              {TREND_COPY[trend].text}
            </p>
          )}

          {/* The one sentence that must be identical on the phone and the
              laptop, and the whole question the product answers. It gets the
              accent for that reason. */}
          {/* The headline is always about now, but the word above it follows
              the scrub — so once the reader is out at Tuesday the two are
              answering different questions and only the header clock says so.
              Dimming it is the lightest way to scope it; inventing a "from
              now" label would be new user-facing copy, which is Joe's call and
              not a prototype's. Flagged in the writeup. */}
          <p className={'proto-headline' + (isNow ? '' : ' proto-headline--away')}>{headline}</p>

          <p className="proto-notice">{level?.notice}</p>

          <p className="proto-reading">
            {shownPM25 == null
              ? '—  ·  no model value for this hour'
              : `AQI ${aqi}  ·  ${Math.round(shownPM25)} µg/m³ PM2.5  ·  model estimate`}
          </p>

          <button type="button" className="proto-explain" onClick={() => setExplainOpen(true)}>
            What this means ›
          </button>
        </section>

        <section className="proto-timeline">
          <div className="proto-timeline__head">
            {isNow ? (
              <>
                <span className="proto-eyebrow">Now</span>
                <span className="proto-eyebrow proto-eyebrow--dim">−12h · +48h</span>
              </>
            ) : (
              <>
                <span className="proto-eyebrow proto-eyebrow--readout">
                  {new Intl.DateTimeFormat('en-US', {
                    weekday: 'short',
                    hour: 'numeric',
                    hour12: true,
                    timeZone: tz,
                  }).format(new Date(timesUTC[activeIndex] + 'Z'))}
                  {shownPM25 == null ? ' · —' : ` · ${Math.round(shownPM25)} µg/m³`}
                </span>
                {/* Suggestion 9: the live site gives you no way back to now
                    except dragging until you find it. */}
                <button
                  type="button"
                  className="proto-now-btn"
                  onClick={() => setSelectedIndex(null)}
                >
                  Now
                </button>
              </>
            )}
          </div>

          <Curve
            timesUTC={timesUTC}
            pm25={pm25}
            windowStart={windowStart}
            windowEnd={windowEnd}
            nowIndex={nowIndex}
            selectedIndex={activeIndex}
            onScrub={(i) => setSelectedIndex(i === nowIndex ? null : i)}
            timezone={tz}
            agreement={series.agreement}
          />

          {/* The agreement band, answered as one line rather than a second
              chart. Joe asked whether it should be an expandable section; the
              case against is that a reader only ever wants it when the models
              disagree, and a collapsed section is invisible exactly then. So
              the divergence is drawn on the curve where it happens, and this
              line names it and opens the explainer. On an agreeing forecast it
              is one quiet sentence about lead time. */}
          <button
            type="button"
            className={
              'proto-agreement' + (agreementNote.diverged ? ' proto-agreement--split' : '')
            }
            onClick={() => setExplainOpen(true)}
          >
            <span className="proto-agreement__pip" aria-hidden="true" />
            {agreementNote.label}
          </button>
        </section>

        {/* Suggestion 6: a day tap sends the playhead to that day's worst hour,
            which moves the sky, the ridge, the reading and the level word
            together. The live site expands an accordion with a second chart in
            it instead; that material belongs in the sheet. */}
        <section className="proto-days" aria-label="Five day outlook">
          {days.map((day) => {
            const target = dayTargets.get(day.key) ?? null;
            const selected = target != null && target === activeIndex;
            return (
              <button
                type="button"
                key={day.key}
                className={
                  'proto-day' +
                  (selected ? ' proto-day--on' : '') +
                  (target == null ? ' proto-day--out' : '')
                }
                disabled={target == null}
                aria-pressed={selected}
                onClick={() => setSelectedIndex(selected ? null : target)}
              >
                <span className="proto-day__weekday">{day.weekday}</span>
                <span className="proto-day__level">{day.level?.name}</span>
                <span className="proto-day__parts">
                  {(day.dayParts ?? []).map((p) => (
                    <i
                      key={p.key}
                      style={{ background: p.bucket ? p.bucket.color : 'transparent' }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </section>

        {/* The foot carries the three things that are about the whole screen
            rather than about one hour: where this is, sending it to someone,
            and the map. Two rows, because crushing three targets into one puts
            them all under 44px on a phone. */}
        <div className="proto-foot">
          <button
            type="button"
            className="proto-foot__place"
            onClick={() => setLocationOpen(true)}
          >
            <span className="proto-foot__pin" aria-hidden="true">
              ◎
            </span>
            {place}
            <span className="proto-foot__caret" aria-hidden="true">
              ▾
            </span>
          </button>

          <button
            type="button"
            className="proto-foot__share"
            onClick={handleShare}
            disabled={shareState === 'working'}
          >
            <ShareGlyph />
            {shareState === 'copied'
              ? 'Link copied'
              : shareState === 'failed'
                ? 'Try again'
                : 'Share'}
          </button>
        </div>

        <a className="proto-place" href="#map">
          <span className="proto-place__cta">See the smoke on the map</span>
          <span className="proto-place__chev">›</span>
        </a>
      </main>
      </div>

      <ExplainSheet
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        level={level}
        scale={scale}
        measured={series.measured}
        agreement={agreementNote}
      />

      <LocationSheet
        open={locationOpen}
        onClose={() => setLocationOpen(false)}
        current={place}
        onSelect={(picked) => {
          setLocationOpen(false);
          // null is "use my current location" — in the live app that re-runs
          // geolocation; here it just returns to the fixture's own place.
          setPlaceOverride(picked ? picked.label : null);
        }}
      />

      <InstallNudge
        levelIndex={levelForPM25(pm25[nowIndex])?.index ?? 0}
        headline={headline}
        force={forceNudge}
      />

      <ReviewBar
        scenarioId={scenarioId}
        onPick={setScenarioId}
        forceNudge={forceNudge}
        onToggleNudge={() => setForceNudge((v) => !v)}
      />
    </>
  );
}

/// Review chrome. Not part of the proposal — it exists so the five states can
/// be seen without waiting for the weather, and it says so on screen.
function ShareGlyph() {
  return (
    <svg className="proto-foot__glyph" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="15" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="15" cy="15" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7.1 8.8 L12.9 6.2 M7.1 11.2 L12.9 13.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ReviewBar({ scenarioId, onPick, forceNudge, onToggleNudge }) {
  // Collapsed by default: opened, it sits on top of the days and the place
  // bar, which are two of the things being reviewed.
  const [open, setOpen] = useState(false);
  const install = open ? explainInstall() : null;
  return (
    <div className={'proto-review' + (open ? ' proto-review--open' : '')}>
      <button type="button" className="proto-review__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '×' : 'Review'}
      </button>
      {open && (
        <div className="proto-review__body">
          <p className="proto-review__label">Candidate · review only</p>
          <div className="proto-review__scenarios">
            {SCENARIOS.map((s) => (
              <button
                type="button"
                key={s.id}
                className={
                  'proto-review__pick' + (s.id === scenarioId ? ' proto-review__pick--on' : '')
                }
                onClick={() => onPick(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={
              'proto-review__pick proto-review__pick--wide' +
              (forceNudge ? ' proto-review__pick--on' : '')
            }
            onClick={onToggleNudge}
          >
            {forceNudge ? 'Hide' : 'Show'} the install nudge
          </button>

          {install && (
            <p className="proto-review__note">
              Install policy: sessions {install.sessions}/3 · days {install.days}/2 ·{' '}
              {install.platform}
              {install.eligible ? ' · would fire in 12s' : ` · held (${install.reasons.join(', ')})`}
            </p>
          )}

          <p className="proto-review__note">
            Fixture data from the iOS test payloads, time-shifted to now. The verdict, the days
            and the headline are recomputed by the production modules. “Models split” is
            synthesised — every real fixture is single-model. <a href="/">Live site ›</a>
          </p>
        </div>
      )}
    </div>
  );
}
