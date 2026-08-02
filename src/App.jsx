import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import LocationBanner from './components/LocationBanner.jsx';
import LocationSearch from './components/LocationSearch.jsx';
import RatingChip from './components/RatingChip.jsx';
import SkyBackdrop from './components/SkyBackdrop.jsx';
import Ridgeline from './components/Ridgeline.jsx';
import TrendChip from './components/TrendChip.jsx';
import ExplainSheet from './components/ExplainSheet.jsx';
import Scrubber from './components/Scrubber.jsx';
import AgreementBand from './components/AgreementBand.jsx';
import FiveDayStrip from './components/FiveDayStrip.jsx';
import SharedBanner from './components/SharedBanner.jsx';
import ShareButton from './components/ShareButton.jsx';
import AppWidgetCTA from './components/AppWidgetCTA.jsx';
import InstallNudge from './components/InstallNudge.jsx';
import PullToRefresh from './components/PullToRefresh.jsx';
// Order matters: sky.css re-points the tokens.css palette at the live ink, and
// shell.css builds the app surfaces on top of the result.
import './styles/tokens.css';
import './styles/sky.css';
import './styles/shell.css';

import { requestLocation, setManualLocation, clearLocation } from './lib/geolocation.js';
import { reverseGeocode } from './lib/geocoding.js';
import { buildGrid, snapCoord } from './lib/grid.js';
import { fetchGridPM25, findNowIndex } from './lib/openMeteo.js';
import { computeAgreement } from './lib/agreement.js';
import { fetchHRRR, hrrrSeriesAt } from './lib/hrrr.js';
import { fetchSensorsNear, fetchMeasuredDays, applySensorAnchor } from './lib/sensors.js';
import { buildDaySummaries } from './lib/days.js';
import { computeVerdict, verdictHeadline } from './lib/verdict.js';
import { levelForPM25 } from './lib/rating.js';
import { ugm3ToAqi } from './lib/aqi.js';
import { formatLocalTime, formatVerdictTime } from './lib/time.js';
import { getJSON, setJSON, clearKey } from './lib/storage.js';
import { getUnits, setUnits, getSensitive, setSensitive } from './lib/prefs.js';

// Map (and Leaflet with it) loads as a separate chunk after the verdict paints —
// share-spec rule: rating chip + clear-time render first from a single point
// fetch; the 81-point grid and map hydrate behind it.
const SmokeMap = lazy(() => import('./components/SmokeMap.jsx'));

const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const PLAY_INTERVAL_MS = 600; // satellite-loop cadence; the map blends between hours at 60fps
const LOCATION_MATCH_TOLERANCE_DEG = 0.05;
// Map zoom tiers: grid spacing per tier — same 9x9 point budget, wider net.
const TIER_SPACING_KM = { 1: 25, 2: 75, 3: 200 };
// Snap grid centers to a lattice per tier so nearby users share the edge
// cache (api/aq.js). Coarser tiers snap coarser — the cells are bigger.
const TIER_SNAP_DEG = { 1: 0.1, 2: 0.25, 3: 0.25 };

function parseSharedParams() {
  const params = new URLSearchParams(window.location.search);
  const lat = Number.parseFloat(params.get('lat'));
  const lon = Number.parseFloat(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    granted: true,
    lat,
    lon,
    label: params.get('name') || null,
    source: 'shared',
    fromShare: params.get('utm_source') === 'share',
  };
}

function writeLocationToURL(lat, lon, name) {
  const params = new URLSearchParams();
  params.set('lat', lat.toFixed(3));
  params.set('lon', lon.toFixed(3));
  if (name) params.set('name', name);
  window.history.replaceState(null, '', `/?${params.toString()}`);
}

export default function App() {
  const [location, setLocation] = useState(null);
  const [placeName, setPlaceName] = useState(null);
  const [centerData, setCenterData] = useState(null); // stage 1: single point — paints the verdict
  const [gridTiers, setGridTiers] = useState({}); // stage 2+: per-zoom-tier grids — hydrate the map
  const [gridFailed, setGridFailed] = useState(false);
  const fetchingTiersRef = useRef(new Set());
  const [hrrr, setHrrr] = useState(null);
  const [sensorNow, setSensorNow] = useState(null); // { official, local } | null
  const [aqiSource, setAqiSource] = useState(() => getJSON('aqiSource') || 'official');
  const [units, setUnitsState] = useState(() => getUnits());
  const [sensitive, setSensitiveState] = useState(() => getSensitive());
  const [explainOpen, setExplainOpen] = useState(false);
  const [measuredDays, setMeasuredDays] = useState(new Map());
  const [nowIndex, setNowIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const playIntervalRef = useRef(null);

  useEffect(() => {
    const shared = parseSharedParams();
    if (shared) setLocation(shared);
    else requestLocation().then(setLocation);
    // HRRR feed is additive — the app is fully functional without it.
    fetchHRRR().then(setHrrr).catch(() => {});
    clearKey('previousRun'); // run-to-run comparison retired; drop the stale cache
  }, []);

  useEffect(() => {
    if (!location?.granted) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setCenterData(null);
      setGridTiers({});
      fetchingTiersRef.current.clear();
      setGridFailed(false);

      if (location.label) {
        setPlaceName(location.label);
      } else {
        reverseGeocode(location.lat, location.lon).then((name) => {
          if (cancelled) return;
          const resolved = name || `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`;
          setPlaceName(resolved);
          if (location.source !== 'shared') writeLocationToURL(location.lat, location.lon, name);
        });
      }
      if (location.source === 'manual') {
        writeLocationToURL(location.lat, location.lon, location.label);
      }

      // Measured truth anchor — additive; null keeps the app model-only.
      setSensorNow(null);
      fetchSensorsNear(location.lat, location.lon).then((s) => {
        if (!cancelled) setSensorNow(s);
      });

      // Measured history for the past-day boxes: the last 3 local dates.
      setMeasuredDays(new Map());
      {
        const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });
        const dates = [3, 2, 1].map((d) => keyFmt.format(new Date(Date.now() - d * 86_400_000)));
        fetchMeasuredDays(location.lat, location.lon, dates).then((m) => {
          if (!cancelled) setMeasuredDays(m);
        });
      }

      try {
        const fetchedAtMs = Date.now();
        const points = buildGrid(
          snapCoord(location.lat, TIER_SNAP_DEG[1]),
          snapCoord(location.lon, TIER_SNAP_DEG[1]),
        );
        const centerPoint = points.find((p) => p.isCenter);

        // Stage 1 — one point, fast: verdict paints before the map exists.
        const [center] = await fetchGridPM25([centerPoint]);
        if (cancelled) return;

        const nIdx = findNowIndex(center.timesUTC);
        setNowIndex(nIdx);
        setSelectedIndex(nIdx);
        setCenterData({ ...center, fetchedAtMs });
        setLoading(false);

        // Stage 2 — default-zoom grid hydrates the map; failure here never
        // takes down the verdict. Wider tiers fetch lazily on zoom-out.
        try {
          const grid = await fetchGridPM25(points);
          if (!cancelled) setGridTiers({ 1: grid });
        } catch {
          if (!cancelled) setGridFailed(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Could not load the forecast. Check your connection and try again.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location]);

  // Home-screen app pattern: returning to a backgrounded app with stale
  // data should feel like opening it fresh — reload if the forecast is
  // older than 20 minutes when the app becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        centerData &&
        Date.now() - centerData.fetchedAtMs > 20 * 60_000
      ) {
        window.location.reload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [centerData]);

  const windowStart = Math.max(0, nowIndex - 12);
  const windowEnd = centerData ? Math.min(centerData.timesUTC.length - 1, nowIndex + 48) : 0;

  const handleNeedTier = useCallback(
    async (tier) => {
      if (!location?.granted || !TIER_SPACING_KM[tier]) return;
      if (fetchingTiersRef.current.has(tier)) return;
      fetchingTiersRef.current.add(tier);
      try {
        const grid = await fetchGridPM25(
          buildGrid(
            snapCoord(location.lat, TIER_SNAP_DEG[tier]),
            snapCoord(location.lon, TIER_SNAP_DEG[tier]),
            { spacingKm: TIER_SPACING_KM[tier] },
          ),
        );
        setGridTiers((prev) => ({ ...prev, [tier]: grid }));
      } catch {
        fetchingTiersRef.current.delete(tier); // allow a retry on the next zoom event
      }
    },
    [location],
  );

  useEffect(() => {
    clearInterval(playIntervalRef.current);
    if (!playing || !centerData) return;
    playIntervalRef.current = setInterval(() => {
      setSelectedIndex((idx) => (idx >= windowEnd ? windowStart : idx + 1));
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(playIntervalRef.current);
  }, [playing, windowStart, windowEnd, centerData]);

  // HRRR series for this location (null outside CONUS or before the feed loads);
  // its arrival upgrades the agreement band from run-to-run to real multi-model.
  const hrrrLocal = useMemo(
    () => (hrrr?.series && location?.granted ? hrrrSeriesAt(hrrr.series, location.lat, location.lon) : null),
    [hrrr, location],
  );

  const agreement = useMemo(
    () =>
      centerData
        ? computeAgreement({
            timesUTC: centerData.timesUTC,
            pm25: centerData.pm25,
            fetchedAtMs: centerData.fetchedAtMs,
            hrrrSeries: hrrrLocal,
          })
        : null,
    [centerData, hrrrLocal],
  );

  // The user picks which measured truth anchors the verdict: the official
  // monitor picture (matches other apps) or the local PurpleAir median.
  const activeSensor = useMemo(() => {
    if (!sensorNow) return null;
    return aqiSource === 'local'
      ? (sensorNow.local ?? sensorNow.official)
      : (sensorNow.official ?? sensorNow.local);
  }, [sensorNow, aqiSource]);

  // Experience surfaces (chip, verdict, strip) read the sensor-anchored
  // series; the agreement band and map stay pure model — comparing models
  // to each other with sensor corrections baked in would muddy exactly the
  // signal the band exists to show.
  const anchoredPm25 = useMemo(
    () =>
      centerData
        ? applySensorAnchor(centerData.pm25, nowIndex, activeSensor?.ug ?? null)
        : null,
    [centerData, nowIndex, activeSensor],
  );

  function handleSourceChange(source) {
    setAqiSource(source);
    setJSON('aqiSource', source);
  }

  function handleUnitsChange(next) {
    setUnitsState(next);
    setUnits(next);
  }

  function handleSensitiveChange(next) {
    setSensitiveState(next);
    setSensitive(next);
  }

  const verdict = useMemo(
    () => (anchoredPm25 ? computeVerdict({ pm25: anchoredPm25, nowIndex }) : null),
    [anchoredPm25, nowIndex],
  );
  const headline = useMemo(
    () =>
      verdict && centerData
        ? verdictHeadline(verdict, (i) => formatVerdictTime(centerData.timesUTC[i], TIMEZONE))
        : null,
    [verdict, centerData],
  );
  const days = useMemo(
    () =>
      centerData && anchoredPm25
        ? buildDaySummaries({
            timesUTC: centerData.timesUTC,
            pm25: anchoredPm25,
            nowIndex,
            timezone: TIMEZONE,
          })
        : [],
    [centerData, anchoredPm25, nowIndex],
  );
  // "Update location" opens a chooser: search any city, or re-use the GPS.
  function handleUpdateLocation() {
    setPlaying(false);
    setChoosingLocation((v) => !v);
  }

  async function handleUseMyLocation() {
    setChoosingLocation(false);
    clearLocation();
    setLocation(null);
    setPlaceName(null);
    const loc = await requestLocation();
    setLocation(loc);
  }

  // The viewer→user conversion moment: shared-link recipient claims their own air.
  async function handleCheckYourAir() {
    setPlaying(false);
    const loc = await requestLocation();
    if (loc.granted) {
      setPlaceName(null);
      setLocation(loc);
    } else {
      clearLocation();
      setLocation(loc); // denied → search box path
    }
  }

  function handleManualSelect(result) {
    setChoosingLocation(false);
    setPlaceName(null);
    const loc = setManualLocation(result.lat, result.lon, result.label);
    setLocation(loc);
  }

  // Re-runs the whole fetch effect for the location we already have.
  function handleRetry() {
    setLocation((current) => (current ? { ...current } : current));
  }

  const header = (
    <header className="app-header">
      <h1 className="app-header__wordmark">SMOKESHOW</h1>
      <span className="app-header__tagline">smoky where you are?</span>
    </header>
  );

  const chooser = choosingLocation ? (
    <div className="location-chooser">
      <LocationSearch
        onSelect={handleManualSelect}
        hint="Search for a city, or use your current location."
      />
      <div className="location-chooser__actions">
        <button type="button" className="btn btn--filled" onClick={handleUseMyLocation}>
          Use my current location
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => setChoosingLocation(false)}>
          Cancel
        </button>
      </div>
    </div>
  ) : null;

  // Every state below paints on the same sky, so nothing about the page's
  // colour changes between "locating" and "here is your air" — the sky just
  // gains a real PM2.5 reading and a real place to put the sun.
  if (!location || (loading && !centerData)) {
    return (
      <div className="app app--loading">
        <SkyBackdrop pm25={null} date={null} lat={location?.lat} lon={location?.lon} />
        {header}
        <div className="spacer" />
        <p className="app-status">
          <span className="app-status__pip" />
          {!location ? 'Locating' : 'Reading the air'}
        </p>
        <p className="app-status__line">
          {!location ? 'Finding where you are.' : 'Pulling the forecast over you.'}
        </p>
      </div>
    );
  }

  if (!location.granted) {
    return (
      <div className="app">
        <SkyBackdrop pm25={null} date={null} lat={null} lon={null} />
        {header}
        <p className="eyebrow">No location</p>
        <p className="app-status__line">Tell us where to look.</p>
        <LocationSearch onSelect={handleManualSelect} />
      </div>
    );
  }

  if (error || !centerData) {
    return (
      <div className="app app--error">
        <SkyBackdrop pm25={null} date={null} lat={location.lat} lon={location.lon} />
        {header}
        <div className="spacer" />
        <p className="eyebrow">No forecast</p>
        <p className="app-status__line">{error || 'Something went wrong loading the forecast.'}</p>
        <p className="app-status__detail">
          The forecast is fetched live every time, so a retry often clears it.
        </p>
        <div className="app-status__actions">
          <button type="button" className="btn btn--filled" onClick={handleRetry}>
            Try again
          </button>
          <button type="button" className="btn btn--quiet" onClick={handleUpdateLocation}>
            Change location
          </button>
        </div>
        {chooser}
      </div>
    );
  }

  const selectedPM25 = anchoredPm25[selectedIndex];
  const selectedLevel = levelForPM25(selectedPM25);
  // Static slot in index.html between the FAQ and the explainer — the map
  // renders down there (portal) while its state stays wired up here.
  const mapSlot = document.getElementById('map-slot');
  const nowLevel = levelForPM25(anchoredPm25[nowIndex]);
  const isShared = location.source === 'shared';
  const shareUrl =
    `${window.location.origin}/s?lat=${location.lat.toFixed(3)}&lon=${location.lon.toFixed(3)}` +
    `${placeName ? `&name=${encodeURIComponent(placeName)}` : ''}&utm_source=share`;

  return (
    <div className="app">
      <PullToRefresh />
      <SkyBackdrop
        pm25={selectedPM25}
        date={new Date(centerData.timesUTC[selectedIndex] + 'Z')}
        lat={location.lat}
        lon={location.lon}
      />
      {header}
      {isShared ? (
        <SharedBanner
          placeName={placeName || 'a shared location'}
          fromShare={location.fromShare}
          onCheckYourAir={handleCheckYourAir}
        />
      ) : (
        <LocationBanner placeName={placeName} onUpdateLocation={handleUpdateLocation} />
      )}
      {chooser}
      <RatingChip
        level={selectedLevel}
        pm25={selectedPM25}
        isNow={selectedIndex === nowIndex}
        timeLabel={formatLocalTime(centerData.timesUTC[selectedIndex], TIMEZONE)}
        headline={selectedIndex === nowIndex ? headline : null}
        sensor={selectedIndex === nowIndex ? activeSensor : null}
        sources={sensorNow}
        aqiSource={aqiSource}
        onSourceChange={handleSourceChange}
        units={units}
        onExplain={() => setExplainOpen(true)}
      />
      <TrendChip pm25={anchoredPm25} index={selectedIndex} verdict={verdict} />
      <Ridgeline pm25={selectedPM25} />
      <ShareButton
        level={nowLevel}
        aqi={ugm3ToAqi(anchoredPm25[nowIndex])}
        placeName={placeName}
        timeLabel={formatLocalTime(centerData.timesUTC[nowIndex], TIMEZONE)}
        headline={headline}
        days={days}
        diverged={agreement?.some((a) => a.status === 'diverge') ?? false}
        shareUrl={shareUrl}
      />
      <ExplainSheet
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        level={selectedLevel}
        pm25={selectedPM25}
        units={units}
        sensitive={sensitive}
        days={days}
        sensorNow={selectedIndex === nowIndex ? sensorNow : null}
        onUnitsChange={handleUnitsChange}
        onSensitiveChange={handleSensitiveChange}
      />
      {mapSlot &&
        createPortal(
          <div className="map-section">
            {gridTiers[1] ? (
              <Suspense fallback={<div className="map-placeholder">Loading map…</div>}>
                <SmokeMap
                  gridTiers={gridTiers}
                  selectedIndex={selectedIndex}
                  center={location}
                  onNeedTier={handleNeedTier}
                  playing={playing}
                  frameMs={PLAY_INTERVAL_MS}
                  hrrr={hrrr}
                  verdictPm25={anchoredPm25}
                />
              </Suspense>
            ) : (
              <div className="map-placeholder">
                {gridFailed
                  ? 'Map unavailable right now — the forecast above still works.'
                  : 'Loading map…'}
              </div>
            )}
            <Scrubber
              timesUTC={centerData.timesUTC}
              pm25={anchoredPm25}
              windowStart={windowStart}
              windowEnd={windowEnd}
              selectedIndex={selectedIndex}
              nowIndex={nowIndex}
              onScrub={setSelectedIndex}
              playing={playing}
              onTogglePlay={() => setPlaying((p) => !p)}
              timezone={TIMEZONE}
            />
            <AgreementBand
              agreement={agreement}
              windowStart={windowStart}
              windowEnd={windowEnd}
              timesUTC={centerData.timesUTC}
              currentPM25={centerData.pm25}
                    hrrrSeries={hrrrLocal}
            />
          </div>,
          mapSlot,
        )}
      <FiveDayStrip
        timesUTC={centerData.timesUTC}
        pm25={anchoredPm25}
        nowIndex={nowIndex}
        timezone={TIMEZONE}
        measuredDays={measuredDays}
      />
      {/* SLOT: cta */}
      <AppWidgetCTA
        pm25={anchoredPm25}
        timesUTC={centerData.timesUTC}
        selectedIndex={selectedIndex}
        nowIndex={nowIndex}
        windowStart={windowStart}
        windowEnd={windowEnd}
        verdict={verdict}
        headline={headline}
        level={selectedLevel}
        placeName={placeName}
        timezone={TIMEZONE}
      />
      <InstallNudge levelIndex={nowLevel?.index ?? 0} headline={headline} />
    </div>
  );
}
