import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import LocationSearch from './components/LocationSearch.jsx';
import LocationSheet from './components/LocationSheet.jsx';
import SkyBackdrop from './components/SkyBackdrop.jsx';
import TrendChip from './components/TrendChip.jsx';
import ExplainSheet from './components/ExplainSheet.jsx';
import ScrubberBar from './components/ScrubberBar.jsx';
import Ridgeline from './components/Ridgeline.jsx';
import AgreementBand from './components/AgreementBand.jsx';
import FiveDayStrip from './components/FiveDayStrip.jsx';
import AppWidgetCTA from './components/AppWidgetCTA.jsx';
import InstallNudge from './components/InstallNudge.jsx';
// Order matters: sky.css re-points the tokens.css palette at the live ink, and
// shell.css builds the app surfaces on top of the result.
import './styles/tokens.css';
import './styles/sky.css';
import './styles/shell.css';

import { requestLocation, setManualLocation, clearLocation } from './lib/geolocation.js';
import { reverseGeocode } from './lib/geocoding.js';
import { buildGrid, snapCoord } from './lib/grid.js';
import { fetchGridPM25, findNowIndex } from './lib/openMeteo.js';
import { fetchServerForecast } from './lib/forecastApi.js';
import { computeAgreement } from './lib/agreement.js';
import { fetchFrames, fetchSeries, seriesAt } from './lib/frames.js';
import { fetchSensorsNear, fetchMeasuredDays, applySensorAnchor } from './lib/sensors.js';
import { buildDaySummaries } from './lib/days.js';
import { computeVerdict, verdictHeadline } from './lib/verdict.js';
import { levelForPM25 } from './lib/rating.js';
import { ugm3ToAqi } from './lib/aqi.js';
import { formatLocalTime, formatVerdictTime } from './lib/time.js';
import { getJSON, setJSON, clearKey } from './lib/storage.js';
import { getUnits, setUnits, getSensitive, setSensitive } from './lib/prefs.js';
import { toPlace, savePlace, getPlaces, placeId, removePlace as removeSavedPlace, placesWithCurrent } from './lib/places.js';
import { LEVELS } from './lib/rating.js';

// Map (and Leaflet with it) loads as a separate chunk after the verdict paints —
// share-spec rule: rating chip + clear-time render first from a single point
// fetch; the 81-point grid and map hydrate behind it.
const SmokeMap = lazy(() => import('./components/SmokeMap.jsx'));

// The viewer's own zone. Used for labels until /api/forecast reports the
// location's zone, which is the more correct answer for a shared link —
// "when does it clear" is a question about the air over that place.
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const PLAY_INTERVAL_MS = 600; // satellite-loop cadence; the map blends between hours at 60fps
const LOCATION_MATCH_TOLERANCE_DEG = 0.05;
// Map zoom tiers: grid spacing per tier — same 9x9 point budget, wider net.
const TIER_SPACING_KM = { 1: 25, 2: 75, 3: 200 };
// Snap grid centers to a lattice per tier so nearby users share the edge
// cache (api/aq.js). Coarser tiers snap coarser — the cells are bigger.
const TIER_SNAP_DEG = { 1: 0.1, 2: 0.25, 3: 0.25 };

// A location page (scripts/gen-location-pages.mjs) stamps the place it is about
// into the document. Reading it here is what makes /smoke-forecast/chicago-il/
// paint Chicago's verdict without a geolocation prompt — the reader already
// told us where they meant by landing on that URL, and asking again would be
// both rude and slow. Query params still win, so a shared link pointed at a
// different place keeps working from a city page.
function presetPlace() {
  const preset = window.__SMOKESHOW_PLACE__;
  if (!preset || !Number.isFinite(preset.lat) || !Number.isFinite(preset.lon)) return null;
  return {
    granted: true,
    lat: preset.lat,
    lon: preset.lon,
    label: preset.label || null,
    source: 'page',
  };
}

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
  // The server-computed verdict (docs/forecast-api-contract.md). Null means
  // the endpoint was unavailable and every derived value below falls back to
  // the original client-side computation — same src/lib modules, same maths.
  const [serverForecast, setServerForecast] = useState(null);
  const [gridTiers, setGridTiers] = useState({}); // stage 2+: per-zoom-tier grids — hydrate the map
  const [gridFailed, setGridFailed] = useState(false);
  const fetchingTiersRef = useRef(new Set());
  const [frames, setFrames] = useState(null); // pre-rendered smoke domains — see lib/frames.js
  const [frameSeries, setFrameSeries] = useState(null); // second model's point series, if one reaches here
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
  const [canvas, setCanvas] = useState('sky'); // 'sky' | 'map' — the flipping stage
  const [mapEverShown, setMapEverShown] = useState(false); // mount the map lazily, keep it after
  const [savedTick, setSavedTick] = useState(0); // bump to re-read the saved-places list
  const playIntervalRef = useRef(null);

  useEffect(() => {
    const shared = parseSharedParams() ?? presetPlace();
    if (shared) setLocation(shared);
    else requestLocation().then(setLocation);
    // The pre-rendered frames are additive — the app is fully functional
    // without them, and fetchFrames() returns null for a manifest version this
    // build does not understand, which lands in the same place.
    fetchFrames().then(setFrames).catch(() => {});
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
      setServerForecast(null);
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

      setSensorNow(null);

      try {
        const fetchedAtMs = Date.now();
        const points = buildGrid(
          snapCoord(location.lat, TIER_SNAP_DEG[1]),
          snapCoord(location.lon, TIER_SNAP_DEG[1]),
        );
        const centerPoint = points.find((p) => p.isCenter);

        // Stage 1 — the verdict, before the map exists. /api/forecast returns
        // it fully derived (level, clear-time, trend, days, sky) so this
        // client renders exactly what iOS and Android will render. It carries
        // the measured rows too, so no separate sensor round-trip is needed.
        const server = await fetchServerForecast(location.lat, location.lon, {
          source: aqiSource,
        });
        if (cancelled) return;

        if (server) {
          setServerForecast(server);
          setSensorNow(server.measured);
          setNowIndex(server.nowIndex);
          setSelectedIndex(server.nowIndex);
          // The map and the agreement band read the un-anchored model series,
          // same as before — a sensor correction at one point doesn't
          // generalise spatially, and the band exists to compare models.
          setCenterData({
            ...centerPoint,
            timesUTC: server.timesUTC,
            pm25: server.pm25Model,
            fetchedAtMs,
          });
          setLoading(false);
        } else {
          // Endpoint unavailable (bad deploy, dev server, offline): compute
          // the same answer here from the same modules.
          fetchSensorsNear(location.lat, location.lon).then((s) => {
            if (!cancelled) setSensorNow(s);
          });
          const [center] = await fetchGridPM25([centerPoint]);
          if (cancelled) return;

          const nIdx = findNowIndex(center.timesUTC);
          setNowIndex(nIdx);
          setSelectedIndex(nIdx);
          setCenterData({ ...center, fetchedAtMs });
          setLoading(false);
        }

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

  // Labels follow the location's zone once the endpoint reports it — the
  // headline, the strip, and the scrubber then all read the same clock, and
  // it's the same clock the native clients will show.
  const tz = serverForecast?.timezone ?? TIMEZONE;

  // Measured history for the past-day boxes: the last 3 local dates. Keyed on
  // `tz`, because the date keys have to match the ones the strip builds.
  useEffect(() => {
    if (!location?.granted) return;
    let cancelled = false;
    setMeasuredDays(new Map());
    const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    const dates = [3, 2, 1].map((d) => keyFmt.format(new Date(Date.now() - d * 86_400_000)));
    fetchMeasuredDays(location.lat, location.lon, dates).then((m) => {
      if (!cancelled) setMeasuredDays(m);
    });
    return () => {
      cancelled = true;
    };
  }, [location, tz]);

  // Switching the measured source re-asks the server, because the verdict is
  // computed on the anchored series — the clear-time genuinely differs
  // between the official monitor and the local sensor median, and deciding
  // that here would put a second implementation of the answer in the browser.
  // If the refetch fails, drop to the client-side path rather than showing a
  // verdict anchored to the row the user just switched away from.
  useEffect(() => {
    if (!location?.granted || !serverForecast) return;
    if (serverForecast.requestedSource === aqiSource) return;
    let cancelled = false;
    fetchServerForecast(location.lat, location.lon, { source: aqiSource }).then((next) => {
      if (cancelled) return;
      if (next) {
        setServerForecast(next);
        setSensorNow(next.measured);
        setNowIndex(next.nowIndex);
      } else {
        setServerForecast(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [aqiSource, location, serverForecast]);

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

  // The agreement band's second model. Only one domain publishes a point
  // series (HRRR), and it is a 2 MB file, so it is fetched lazily and only for
  // readers inside its extent — everyone else stays single-model rather than
  // paying to learn they are not covered.
  useEffect(() => {
    if (!frames || !location?.granted) return undefined;
    let cancelled = false;
    fetchSeries(frames, location.lat, location.lon).then((s) => {
      if (!cancelled) setFrameSeries(s);
    });
    return () => {
      cancelled = true;
    };
  }, [frames, location]);

  // Its arrival upgrades the agreement band from run-to-run to real multi-model.
  const hrrrLocal = useMemo(
    () =>
      frameSeries && location?.granted
        ? seriesAt(frameSeries, location.lat, location.lon)
        : null,
    [frameSeries, location],
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
  // signal the band exists to show. When the endpoint answered it already ran
  // this same applySensorAnchor() call, so take its result rather than
  // running a second copy of the computation over the same numbers.
  const anchoredPm25 = useMemo(
    () =>
      serverForecast?.pm25 ??
      (centerData ? applySensorAnchor(centerData.pm25, nowIndex, activeSensor?.ug ?? null) : null),
    [serverForecast, centerData, nowIndex, activeSensor],
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

  // The product's one promise — "when does it clear" — is answered once, on
  // the server, so a phone and a laptop cannot disagree about it. These three
  // fall back to the identical local computation when the endpoint is down.
  const verdict = useMemo(
    () =>
      serverForecast?.verdict ??
      (anchoredPm25 ? computeVerdict({ pm25: anchoredPm25, nowIndex }) : null),
    [serverForecast, anchoredPm25, nowIndex],
  );
  const headline = useMemo(
    () =>
      serverForecast?.headline ??
      (verdict && centerData
        ? verdictHeadline(verdict, (i) => formatVerdictTime(centerData.timesUTC[i], tz))
        : null),
    [serverForecast, verdict, centerData, tz],
  );
  const days = useMemo(
    () =>
      serverForecast?.days ??
      (centerData && anchoredPm25
        ? buildDaySummaries({
            timesUTC: centerData.timesUTC,
            pm25: anchoredPm25,
            nowIndex,
            timezone: tz,
          })
        : []),
    [serverForecast, centerData, anchoredPm25, nowIndex, tz],
  );
  // "Update location" opens a chooser: search any city, or re-use the GPS.
  function handleUpdateLocation() {
    setPlaying(false);
    if (choosingLocation) {
      setChoosingLocation(false);
      return;
    }
    // flushSync so the sheet mounts and its input focuses synchronously inside
    // this tap — iOS only raises the keyboard for a focus within a user gesture.
    flushSync(() => setChoosingLocation(true));
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

  // The place we're about to leave is often the folded-in current place that was
  // never saved (first-run search, geolocation). Pin it before switching away so
  // it stays a chip instead of vanishing — but only if it isn't already saved,
  // so existing chips keep their order.
  function pinIfUnsaved(place) {
    if (place?.lat == null) return;
    if (getPlaces().some((p) => p.id === place.id)) return;
    savePlace(place);
  }

  // The current active place, derived from location the same way the chip row
  // does. Handlers defined before the render-scope `currentPlace` use this.
  function outgoingPlace() {
    if (location?.lat == null) return null;
    return toPlace({
      lat: location.lat,
      lon: location.lon,
      label: placeName,
      isCurrentLocation: !['manual', 'shared', 'page'].includes(location.source),
    });
  }

  // Add-and-go from the place sheet: pin the pill, switch the verdict to it, and
  // close. `result` is either a geocoder hit (name/admin1/label) or a saved
  // Place (shortName/label) — savePlace upserts by coordinate id either way.
  function handleAddPlace(result) {
    setPlaying(false);
    setChoosingLocation(false);
    pinIfUnsaved(outgoingPlace());
    const label = result.label ?? result.shortName ?? null;
    setPlaceName(label);
    savePlace(
      toPlace({
        lat: result.lat,
        lon: result.lon,
        label,
        isCurrentLocation: !!result.isCurrentLocation,
      }),
    );
    setSavedTick((t) => t + 1);
    setLocation({ granted: true, lat: result.lat, lon: result.lon, label, source: 'manual' });
  }

  // Re-runs the whole fetch effect for the location we already have.
  function handleRetry() {
    setLocation((current) => (current ? { ...current } : current));
  }

  // On a location page the wordmark steps down to a plain banner, because that
  // page already has an h1 and it names the city — which is the heading that
  // should carry, since the page is about Chicago's air and not about us. On
  // every other page the wordmark stays the h1: the root page's only static
  // heading is an h2, so demoting this everywhere would leave it with none.
  const onLocationPage = location?.source === 'page';
  const Wordmark = onLocationPage ? 'p' : 'h1';
  const header = (
    <header className="app-header">
      <Wordmark className="app-header__wordmark">SMOKESHOW</Wordmark>
      <span className="app-header__tagline">smoky where you are?</span>
    </header>
  );

  const chooser = (
    <LocationSheet
      open={choosingLocation}
      onClose={() => setChoosingLocation(false)}
      onAddPlace={handleAddPlace}
      onUseMyLocation={handleUseMyLocation}
      saved={getPlaces()}
      currentPlaceId={
        location && location.lat != null ? placeId(location.lat, location.lon) : null
      }
    />
  );

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
  const ctaSlot = document.getElementById('cta-slot');
  const nowLevel = levelForPM25(anchoredPm25[nowIndex]);
  const selectedDate = new Date(centerData.timesUTC[selectedIndex] + 'Z');
  const atNow = selectedIndex === nowIndex;
  const shareUrl =
    `${window.location.origin}/s?lat=${location.lat.toFixed(3)}&lon=${location.lon.toFixed(3)}` +
    `${placeName ? `&name=${encodeURIComponent(placeName)}` : ''}&utm_source=share`;

  // The chip row: the saved places with the current one folded in, so it always
  // shows where you are even before it is saved.
  const isGeoPlace = !['manual', 'shared', 'page'].includes(location.source);
  const currentPlace = toPlace({
    lat: location.lat,
    lon: location.lon,
    label: placeName,
    isCurrentLocation: isGeoPlace,
  });
  void savedTick; // read so the row re-renders after a remove
  const chips = placesWithCurrent(currentPlace);

  function handleCanvas(next) {
    if (next === 'map') setMapEverShown(true);
    setCanvas(next);
  }
  function handleSelectPlace(place) {
    if (place.id === currentPlace.id) return;
    setPlaying(false);
    pinIfUnsaved(currentPlace);
    setSavedTick((t) => t + 1);
    setPlaceName(place.label);
    setLocation({ granted: true, lat: place.lat, lon: place.lon, label: place.label, source: 'manual' });
  }
  function handleRemovePlace(place) {
    removeSavedPlace(place.id);
    setSavedTick((t) => t + 1);
    if (place.id === currentPlace.id) {
      const next = placesWithCurrent(null).find((p) => p.id !== place.id);
      if (next) handleSelectPlace(next);
    }
  }
  function handleNow() {
    setPlaying(false);
    setSelectedIndex(nowIndex);
  }
  async function handleShare() {
    const payload = {
      title: 'Smokeshow',
      text: `${placeName || 'This air'}: ${atNow && headline ? headline : selectedLevel?.name}`,
      url: shareUrl,
    };
    try {
      if (navigator.share) await navigator.share(payload);
      else await navigator.clipboard?.writeText(shareUrl);
    } catch {
      /* dismissed */
    }
  }

  return (
    <div className={'app app--stage' + (playing ? ' is-playing' : '')}>
      <div className="stage" data-canvas={canvas}>
        <SkyBackdrop
          pm25={selectedPM25}
          date={selectedDate}
          lat={location.lat}
          lon={location.lon}
          playing={playing}
          frameMs={PLAY_INTERVAL_MS}
        />

        {/* The sky window: verdict on the sky, the horizon with sun and moon,
            the five days. Hidden (not unmounted) under the map so the CSS
            variables it owns stay live. */}
        <div className="window" hidden={canvas !== 'sky'}>
          <header className="whead">
            <span className="whead__clock">{formatLocalTime(centerData.timesUTC[selectedIndex], tz)}</span>
            <button
              type="button"
              className="whead__gear"
              aria-label="Detail and settings"
              onClick={() => setExplainOpen(true)}
            >
              ≡
            </button>
          </header>

          <div className="verdict">
            <p className="verdict__place">
              {placeName || 'Here'}
              {location.source === 'shared' ? (
                // A shared-link viewer looking at someone else's air — the
                // moment to offer them their own.
                <button type="button" className="verdict__change" onClick={handleCheckYourAir}>
                  Check your air →
                </button>
              ) : (
                <button type="button" className="verdict__change" onClick={handleUpdateLocation}>
                  change
                </button>
              )}
            </p>
            <h1 className="verdict__word">{selectedLevel?.name}</h1>
            <TrendChip pm25={anchoredPm25} index={selectedIndex} verdict={verdict} />
            {atNow && headline && <p className="verdict__clear">{headline}</p>}
            <p className="verdict__body">{selectedLevel?.notice}</p>
            <p className="verdict__meta">
              AQI {ugm3ToAqi(selectedPM25)} · {Math.round(selectedPM25)} µg/m³ PM2.5 · model estimate
            </p>
            <button type="button" className="verdict__more" onClick={() => setExplainOpen(true)}>
              What this means ›
            </button>
          </div>

          {/* Empty sky between the verdict and the landscape; it soaks up spare
              height on a tall screen and collapses first when the verdict runs
              long, so the hills and pills never get shoved into the scrubber. */}
          <div className="window__spacer" />

          <div className="window__horizon">
            <Ridgeline pm25={selectedPM25} />
          </div>

          <FiveDayStrip
            timesUTC={centerData.timesUTC}
            pm25={anchoredPm25}
            nowIndex={nowIndex}
            timezone={tz}
            measuredDays={measuredDays}
            compact
            activeIndex={selectedIndex}
            onPickDay={setSelectedIndex}
          />
        </div>

        {/* The map canvas. Mounted on first flip and kept, so it does not reload
            each time. Its own compact verdict + model-agreement ride on top. */}
        {mapEverShown && (
          <div className="stage__map" hidden={canvas !== 'map'}>
            {gridTiers[1] ? (
              <Suspense fallback={<div className="map-placeholder">Loading map…</div>}>
                <SmokeMap
                  gridTiers={gridTiers}
                  selectedIndex={selectedIndex}
                  center={location}
                  onNeedTier={handleNeedTier}
                  playing={playing}
                  frameMs={PLAY_INTERVAL_MS}
                  frames={frames}
                  verdictPm25={anchoredPm25}
                />
              </Suspense>
            ) : (
              <div className="map-placeholder">
                {gridFailed
                  ? 'Map unavailable right now — the forecast still works.'
                  : 'Loading map…'}
              </div>
            )}
            <div className="stage__map-verdict">
              <strong>{selectedLevel?.name}</strong>
              {atNow && headline && <span>{headline}</span>}
            </div>
            <div className="stage__map-band">
              <AgreementBand
                agreement={agreement}
                windowStart={windowStart}
                windowEnd={windowEnd}
                timesUTC={centerData.timesUTC}
                currentPM25={centerData.pm25}
                hrrrSeries={hrrrLocal}
              />
            </div>
          </div>
        )}

        <ScrubberBar
          canvas={canvas}
          onCanvas={handleCanvas}
          places={chips}
          currentPlaceId={currentPlace.id}
          onSelectPlace={handleSelectPlace}
          onRemovePlace={handleRemovePlace}
          onAddPlace={handleUpdateLocation}
          timesUTC={centerData.timesUTC}
          pm25={anchoredPm25}
          windowStart={windowStart}
          windowEnd={windowEnd}
          selectedIndex={selectedIndex}
          nowIndex={nowIndex}
          onScrub={setSelectedIndex}
          onNow={handleNow}
          playing={playing}
          onTogglePlay={() => setPlaying((p) => !p)}
          onShare={handleShare}
          timezone={tz}
        />
      </div>

      {chooser}

      <ExplainSheet
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        level={selectedLevel}
        pm25={selectedPM25}
        units={units}
        sensitive={sensitive}
        days={days}
        sensorNow={atNow ? sensorNow : null}
        onUnitsChange={handleUnitsChange}
        onSensitiveChange={handleSensitiveChange}
      />

      {ctaSlot &&
        createPortal(
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
            timezone={tz}
          />,
          ctaSlot,
        )}

      <InstallNudge levelIndex={nowLevel?.index ?? 0} headline={headline} />
    </div>
  );
}
