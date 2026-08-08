import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SmokeCanvasLayer } from './SmokeLayer.js';
import { FireLayer } from './FireLayer.js';
import { levelForPM25 } from '../lib/rating.js';
// Two fire layers, deliberately separate. fires.js is NIFC WFIGS: named
// incidents with containment and acreage, US only, drawn as tappable dots with
// a card. hotspots.js is NASA FIRMS: clustered satellite heat detections,
// global, and therefore the only one that covers Canada and Europe. They
// answer different questions and must never be relabelled as each other.
import { fetchFires, fireCard, fireRadius } from '../lib/fires.js';
import { fetchHotspots } from '../lib/hotspots.js';
import { domainFrameURL, pickDomains } from '../lib/frames.js';
import { getJSON, setJSON } from '../lib/storage.js';
import './SmokeMap.css';

// The fire card is React's, not Leaflet's. A bound tooltip lives inside
// `.leaflet-map-pane`, which Leaflet keeps transformed for panning — so it is
// a stacking context the tooltip cannot escape, and a card near a corner opens
// underneath the zoom control. It is also clipped by the map's own rounded
// overflow, and has to be argued out of `white-space: nowrap` before it will
// lay out at all. Owning the element here costs a little positioning and
// settles all three. React's escaping covers the fire names, which are
// external input.
const CARD_WIDTH = 208; // keep in step with .fire-card in SmokeMap.css
const CARD_CLEARANCE = 104; // headroom the tallest card needs above its dot
const CARD_MARGIN = 8;

// Three zoom tiers, each backed by its own grid (fetched lazily by App):
// tier 1 = 25km spacing (~200km square), tier 2 = 75km (~600km),
// tier 3 = 200km (~1600km, regional context).
export function tierForZoom(zoom) {
  if (zoom >= 8) return 1;
  if (zoom >= 6) return 2;
  return 3;
}

const TIER_SPACING_KM = { 1: 25, 2: 75, 3: 200 };

// The map opens all the way out. Smoke is a continental story — the plume that
// matters to Missoula started in British Columbia — and a city-level first
// frame hides the thing the reader came to see. MIN_ZOOM is also Leaflet's
// floor here, so "wide" and "as wide as it goes" are the same number.
const MIN_ZOOM = 4;

// What the reader is actually looking at. The fallback used to be silent: a
// 9-across point grid rendered exactly like a 3 km model field, with nothing
// saying which one was on screen. Naming the model and its resolution is the
// same rule as "model estimate, never observed" — the map should not imply
// detail the data does not have.
export function coverageLabel(domain, tier) {
  if (domain) {
    return {
      text: `${domain.label} · ${domain.resolutionKm} km model estimate`,
      title:
        `Pre-rendered ${domain.model}. Grid spacing about ${domain.resolutionKm} km. ` +
        `Model estimate, not an observation.`,
    };
  }
  const km = TIER_SPACING_KM[tier] ?? TIER_SPACING_KM[1];
  return {
    text: `Coarse grid · ${km} km points, model estimate`,
    title:
      `No pre-rendered field covers this view, so the map is interpolating 81 CAMS ` +
      `point forecasts about ${km} km apart. Model estimate, not an observation.`,
  };
}

function gridMeta(points) {
  const size = Math.round(Math.sqrt(points.length));
  const half = Math.floor(size / 2);
  const p00 = points.find((p) => p.i === -half && p.j === -half);
  const p10 = points.find((p) => p.i === -half + 1 && p.j === -half);
  const p01 = points.find((p) => p.i === -half && p.j === -half + 1);
  return {
    lat0: p00.lat,
    lon0: p00.lon,
    latStep: p10.lat - p00.lat,
    lonStep: p01.lon - p00.lon,
    size,
    half,
  };
}

function frameValues(points, meta, hourIndex) {
  const arr = new Float64Array(meta.size * meta.size);
  for (const p of points) {
    arr[(p.i + meta.half) * meta.size + (p.j + meta.half)] = p.pm25[hourIndex] ?? 0;
  }
  return arr;
}

export default function SmokeMap({
  gridTiers,
  selectedIndex,
  center,
  onNeedTier,
  playing,
  frameMs,
  frames,
  verdictPm25, // sensor-anchored series — marker must agree with the chip
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const smokeLayerRef = useRef(null);
  const markerRef = useRef(null);
  const hotspotLayerRef = useRef(null); // FIRMS heat detections (global)
  const coverageRef = useRef(null);
  const frameRef = useRef(null); // { meta, vA, vB, imgA, imgB, bounds, wraps, changedAt, sharpMode }
  const imageCacheRef = useRef(new Map()); // url -> HTMLImageElement (decoded)
  const fireLayerRef = useRef(null); // NIFC named incidents (US)
  const fireRendererRef = useRef(null);
  // Seed from the opening zoom, not from 1: the map now opens wide, so the
  // very first onNeedTier() must ask for the wide grid. Seeding at 1 requested
  // the 25 km grid for a continental view and left the fallback stretched.
  const [tier, setTier] = useState(tierForZoom(MIN_ZOOM));
  const [fireHint, setFireHint] = useState(false);
  // { fire, radius, pinned } — pinned means opened by tap and immune to the
  // mouseout that a pointer device would send.
  const [activeFire, setActiveFire] = useState(null);

  // The hint has done its job the moment someone reaches a fire, whether or
  // not they read it. Remembered across sessions — it is a nudge, not a label.
  const dismissHint = useCallback(() => {
    setFireHint(false);
    setJSON('fireHintSeen', true);
  }, []);

  // Which domain covers the view, not which covers the user: pan from Missoula
  // to Edmonton and the field under the cursor has to be the one that reaches
  // there. Seeded from the location so the first paint needs no map events.
  const [view, setView] = useState({ lat: center.lat, lon: center.lon });

  // Decode-once image cache; crossOrigin so the canvas stays readable.
  function loadFrame(url) {
    const cache = imageCacheRef.current;
    if (cache.has(url)) return cache.get(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    const promise = img.decode().then(() => img);
    cache.set(url, promise);
    return promise;
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, minZoom: MIN_ZOOM }).setView(
      [center.lat, center.lon],
      MIN_ZOOM,
    );
    // Three-layer sandwich, not light_all: base tiles, then the smoke canvas,
    // then the labels on top. Heavy smoke composites to near-opaque black, so
    // labels baked into the basemap would be buried exactly when a reader most
    // needs to know which city is under the plume. Splitting them is the only
    // way to keep the place names above the weather.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      maxZoom: 12,
      // CARTO's basemaps are free to use with attribution; both credits are
      // required and must stay visible.
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    // The smoke is not CARTO's. Both feeds are credited unconditionally rather
    // than per-domain: Copernicus's licence requires the "Generated using…"
    // wording wherever CAMS data is shown, and a credit that blinks in and out
    // as the reader pans is not a credit.
    map.attributionControl.addAttribution(
      'Smoke: <a href="https://rapidrefresh.noaa.gov/hrrr/">NOAA HRRR-Smoke</a> · ' +
        'Generated using <a href="https://atmosphere.copernicus.eu/">Copernicus Atmosphere ' +
        'Monitoring Service</a> information',
    );
    // Leaflet's own prefix is a courtesy, not a licence term, and on a 430px
    // phone it costs a whole line of a strip that now has to carry two
    // required credits. The library is credited in package.json and the
    // colophon; Copernicus and OSM have to be credited here.
    map.attributionControl.setPrefix('');

    const smokeLayer = new SmokeCanvasLayer();
    smokeLayer.addTo(map);
    smokeLayerRef.current = smokeLayer;

    // Between overlayPane (400, where the smoke canvas lives) and markerPane
    // (600, where the user's dot lives): labels sit over the smoke, the
    // "you are here" marker still sits over the labels.
    map.createPane('labels').style.zIndex = 450;
    map.getPane('labels').style.pointerEvents = 'none';
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
      maxZoom: 12,
      pane: 'labels',
      // Attribution rides the base layer — same source, and Leaflet would
      // otherwise print the pair twice.
    }).addTo(map);

    // Fires sit above the labels — a city name printed through a fire dot
    // makes the dot look like cartography — but below the "you are here"
    // marker, which always wins. Unlike the labels pane this one takes pointer
    // events; the whole point is that you can reach the dots.
    map.createPane('fires').style.zIndex = 460;
    // One renderer for the whole layer: Leaflet gives each vector its own SVG
    // root otherwise, and a fire-heavy August would put a few hundred of them
    // in the DOM.
    fireRendererRef.current = L.svg({ pane: 'fires' });
    fireLayerRef.current = L.layerGroup([], { pane: 'fires' }).addTo(map);
    // A tap-opened card is dismissed by tapping the map, the same gesture that
    // dismisses every other transient thing on a phone. It also goes on any
    // map movement: the card is anchored to a screen position, and following a
    // dot through a pan means re-rendering on every frame of the drag to avoid
    // it visibly lagging behind.
    map.on('click movestart zoomstart', () => setActiveFire(null));

    // The FIRMS hotspot layer is a separate canvas layer with its own pane, so
    // the two never fight for the same DOM. It mounts empty and stays empty
    // until (and unless) fires.json lands: the feed is additive, and an absent
    // one must cost the map nothing.
    const hotspotLayer = new FireLayer();
    hotspotLayer.addTo(map);
    hotspotLayerRef.current = hotspotLayer;

    const marker = L.marker([center.lat, center.lon], {
      icon: L.divIcon({
        className: 'user-marker',
        html: '<div class="user-marker__dot"></div><div class="user-marker__label"></div>',
        iconSize: [12, 12],
      }),
    }).addTo(map);
    markerRef.current = marker;

    // Top-right, not bottom-left: the attribution strip below now carries two
    // mandatory credits and wraps to three lines on a phone, which is exactly
    // where a bottom-left badge would end up buried.
    const Coverage = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const el = L.DomUtil.create('div', 'smoke-coverage');
        el.setAttribute('aria-live', 'polite');
        return el;
      },
    });
    coverageRef.current = new Coverage().addTo(map).getContainer();

    map.on('zoomend', () => setTier(tierForZoom(map.getZoom())));
    map.on('moveend', () => {
      const c = map.getCenter();
      setView({ lat: c.lat, lon: c.lng });
    });

    if (import.meta.env.DEV) window.__smokeshowMap = map; // dev-only: lets tests drive zoom directly

    // Leaflet only measures its container once; if layout settles late (slow
    // devices, rotation, flex reflow) the map — and our canvas — stay 0-sized.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      // Layers die with the map — a stale ref here would leave the remounted
      // map (StrictMode, location change) updating orphaned layers forever.
      smokeLayerRef.current = null;
      fireLayerRef.current = null;
      fireRendererRef.current = null;
      hotspotLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetched here rather than in App, so it cannot touch first paint: this
  // component is lazy-loaded and only mounts once the grid has arrived, which
  // is already well after the verdict has painted. A failure is swallowed —
  // no fires.json means no icons, never a broken map.
  useEffect(() => {
    let cancelled = false;
    fetchHotspots()
      .then((hotspots) => {
        if (!cancelled) hotspotLayerRef.current?.setFires(hotspots);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!gridTiers[tier]) onNeedTier?.(tier);
  }, [tier, gridTiers, onNeedTier]);

  // Active fires, loaded for whatever is on screen and reloaded as the map
  // moves. Additive throughout: every failure path here leaves the smoke map
  // exactly as it was.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    let timer = null;

    const render = (fires) => {
      const group = fireLayerRef.current;
      if (!group) return;
      group.clearLayers();
      setActiveFire(null); // the marker it pointed at no longer exists

      for (const fire of fires) {
        const radius = fireRadius(fire.acres);
        const marker = L.circleMarker([fire.lat, fire.lon], {
          pane: 'fires',
          renderer: fireRendererRef.current,
          radius,
          className: 'fire-dot',
          // Colours live in CSS so the dot is pinned against the same two
          // backdrops as the rest of the map chrome; see SmokeMap.css.
          stroke: true,
          weight: 1.5,
          interactive: true,
        });
        // Hover shows the card on a pointer device and releasing hides it.
        // Touch has no hover at all, so a tap pins the card open until the
        // next tap elsewhere — the same gesture doing both jobs.
        marker.on('mouseover', () => {
          setActiveFire((cur) => (cur?.pinned ? cur : { fire, radius, pinned: false }));
          dismissHint();
        });
        marker.on('mouseout', () => {
          setActiveFire((cur) => (cur?.pinned || cur?.fire !== fire ? cur : null));
        });
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e); // or the map's own click closes it again
          setActiveFire({ fire, radius, pinned: true });
          dismissHint();
        });
        group.addLayer(marker);
      }

      if (fires.length && !getJSON('fireHintSeen')) setFireHint(true);
    };

    const load = async () => {
      const b = map.getBounds();
      const data = await fetchFires({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
      if (cancelled || !data) return;
      render(data.fires);
    };

    // A drag fires moveend once, but a pinch-zoom-then-pan fires several in
    // quick succession; settle before asking.
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    };

    map.on('moveend', schedule);
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      map.off('moveend', schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter when the user switches cities — the map instance outlives the
  // location, so follow it explicitly.
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    // Recentre at whatever zoom the reader is already using. Switching cities
    // is not a fresh visit: someone who zoomed in to their valley should not be
    // thrown back out to the continent for having searched.
    mapRef.current.setView([center.lat, center.lon], mapRef.current.getZoom());
    markerRef.current.setLatLng([center.lat, center.lon]);
    setView({ lat: center.lat, lon: center.lon });
  }, [center.lat, center.lon]);

  useEffect(() => {
    if (!smokeLayerRef.current || !mapRef.current) return;
    // Render the active tier; while it loads, fall back to the nearest fetched
    // one so zooming out never blanks the smoke layer.
    const data = gridTiers[tier] || gridTiers[tier - 1] || gridTiers[tier + 1] || gridTiers[1];
    if (!data) return;

    const meta = gridMeta(data);
    const lastIdx = data[0].pm25.length - 1;
    const timeA = data[0].timesUTC[selectedIndex];
    const timeB = data[0].timesUTC[Math.min(selectedIndex + 1, lastIdx)];

    // Prefer the sharpest pre-rendered domain that reaches this view and has
    // this hour — HRRR inside CONUS, CAMS global everywhere else. The 81-point
    // canvas field stays the fallback for hours and places neither covers.
    const picks = pickDomains(frames, timeA, view.lat, view.lon);
    const pick = picks[0] ?? null;
    const urlA = pick?.url ?? null;
    // Frame B comes from the SAME domain, so a crossfade never dissolves one
    // model's plume into another's.
    const urlB = (pick && domainFrameURL(pick.domain, timeB)) ?? urlA;
    const sharpMode = !!urlA;

    // No backfill. A coarser domain used to paint outside the sharp one's
    // rectangle, to stop a reader in Missoula looking north at the Canadian
    // fires and seeing nothing. Two things killed it. HRRR-Smoke MASSDEN is
    // SMOKE, and CAMS particulate_matter_2.5um is TOTAL PM2.5 including dust,
    // sea salt and traffic — measured over their CONUS overlap, they agree
    // where there is smoke (median ratio 1.00) and disagree everywhere else,
    // because CAMS carries an ~8.5 µg/m³ aerosol floor that HRRR reports as
    // clean. Butting them together drew that difference as a hard rectangle
    // and invited the reader to compare two different quantities. And the
    // "seeing nothing" argument was a dark-basemap argument: on Positron, no
    // data reads as plain map, not as a void. Restore this once a
    // smoke-comparable global field exists — see docs/global-frames.md.

    const vA = frameValues(data, meta, selectedIndex);
    const vB = frameValues(data, meta, Math.min(selectedIndex + 1, lastIdx));
    const bounds = sharpMode
      ? [
          [pick.domain.bounds.latS, pick.domain.bounds.lonW],
          [pick.domain.bounds.latN, pick.domain.bounds.lonE],
        ]
      : null;
    const wraps = !!pick?.domain.wraps;
    const frame = {
      meta,
      vA,
      vB,
      imgA: null,
      imgB: null,
      bounds,
      wraps,
      changedAt: performance.now(),
      sharpMode,
    };
    frameRef.current = frame;

    if (coverageRef.current) {
      const { text, title } = coverageLabel(pick?.domain, tier);
      coverageRef.current.textContent = text;
      coverageRef.current.title = title;
      // Machine-readable for scripts/verify-domains.mjs — the badge's own
      // wording is a product decision and should stay free to change.
      coverageRef.current.dataset.domain = pick?.domain.id ?? '';
      coverageRef.current.dataset.base = '';
    }

    // Always draw the exact hour on step: when playing, the rAF loop below
    // immediately takes over and blends toward the next hour — but if rAF is
    // throttled (hidden tab, low-power mode), this keeps playback stepping
    // instead of freezing the canvas while the clock advances.
    if (sharpMode) {
      Promise.all([loadFrame(urlA), urlB ? loadFrame(urlB) : null]).then(([a, b]) => {
        if (frameRef.current !== frame || !smokeLayerRef.current) return; // stale hour
        frame.imgA = a;
        frame.imgB = b || a;
        smokeLayerRef.current.setImageFrames(a, b || a, 0, bounds, wraps);
      });
    } else {
      smokeLayerRef.current.setField(meta, vA, vA, 0);
    }

    // Marker label reads the ANCHORED series (same source as the chip) —
    // reading the raw model grid here once showed "All clear" on the map
    // while sensors read AQI 176.
    const markerPm25 =
      verdictPm25?.[selectedIndex] ??
      (gridTiers[1] || data).find((p) => p.isCenter)?.pm25[selectedIndex];
    const level = levelForPM25(markerPm25);
    const el = markerRef.current?.getElement();
    const label = el?.querySelector('.user-marker__label');
    if (label && level) label.textContent = level.name;
  }, [gridTiers, selectedIndex, tier, playing, frames, verdictPm25, view]);

  useEffect(() => {
    if (!playing) return;
    let raf;
    const loop = () => {
      const f = frameRef.current;
      if (f && smokeLayerRef.current) {
        const t = Math.min(1, (performance.now() - f.changedAt) / (frameMs || 600));
        if (f.sharpMode) {
          if (f.imgA)
            smokeLayerRef.current.setImageFrames(f.imgA, f.imgB, t, f.bounds, f.wraps);
        } else {
          smokeLayerRef.current.setField(f.meta, f.vA, f.vB, t);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, frameMs]);

  // The hint only appears when there is something to point at, and only until
  // the first time somebody reaches a fire. Wording follows the input: "hover"
  // is meaningless on a phone and "tap" is wrong on a laptop.
  const hintVerb =
    typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches
      ? 'Hover'
      : 'Tap';

  // Anchored to the dot, then pushed back inside the map: near an edge, a card
  // that keeps its arrow-straight alignment is a card with its text cut off,
  // and the name is the whole reason it opened.
  let cardStyle = null;
  let card = null;
  if (activeFire && mapRef.current) {
    const map = mapRef.current;
    const p = map.latLngToContainerPoint([activeFire.fire.lat, activeFire.fire.lon]);
    const width = map.getSize().x;
    const below = p.y < CARD_CLEARANCE;
    const half = CARD_WIDTH / 2;
    const left = Math.min(
      Math.max(p.x, half + CARD_MARGIN),
      Math.max(half + CARD_MARGIN, width - half - CARD_MARGIN),
    );
    cardStyle = {
      left: `${left}px`,
      top: `${below ? p.y + activeFire.radius + 6 : p.y - activeFire.radius - 6}px`,
      transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
    };
    card = fireCard(activeFire.fire);
  }

  return (
    <div className="smoke-map-wrap">
      <div className="smoke-map" ref={containerRef} />
      {card && (
        <div className="fire-card" style={cardStyle} role="status">
          <div className="fire-card__name">{card.title}</div>
          {card.facts && <div className="fire-card__facts">{card.facts}</div>}
          {card.meta && <div className="fire-card__meta">{card.meta}</div>}
          {card.stamp && <div className="fire-card__stamp">{card.stamp}</div>}
        </div>
      )}
      {fireHint && (
        <button type="button" className="fire-hint" onClick={dismissHint}>
          <span className="fire-hint__dot" aria-hidden="true" />
          {hintVerb} a fire for its name and containment
        </button>
      )}
    </div>
  );
}
