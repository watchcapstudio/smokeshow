import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SmokeCanvasLayer } from './SmokeLayer.js';
import { levelForPM25 } from '../lib/rating.js';
import { fetchFires, fireCard, fireRadius } from '../lib/fires.js';
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
  hrrr,
  verdictPm25, // sensor-anchored series — marker must agree with the chip
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const smokeLayerRef = useRef(null);
  const markerRef = useRef(null);
  const frameRef = useRef(null); // { meta, vA, vB, imgA, imgB, bounds, changedAt, hrrrMode }
  const imageCacheRef = useRef(new Map()); // url -> HTMLImageElement (decoded)
  const fireLayerRef = useRef(null);
  const fireRendererRef = useRef(null);
  const [tier, setTier] = useState(1);
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
    const map = L.map(containerRef.current, { zoomControl: true, minZoom: 4 }).setView(
      [center.lat, center.lon],
      9,
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

    const marker = L.marker([center.lat, center.lon], {
      icon: L.divIcon({
        className: 'user-marker',
        html: '<div class="user-marker__dot"></div><div class="user-marker__label"></div>',
        iconSize: [12, 12],
      }),
    }).addTo(map);
    markerRef.current = marker;

    map.on('zoomend', () => setTier(tierForZoom(map.getZoom())));

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    mapRef.current.setView([center.lat, center.lon], 9);
    markerRef.current.setLatLng([center.lat, center.lon]);
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

    // Prefer the sharp HRRR frame when one exists for this hour; the CAMS
    // canvas field is the everywhere-else and past-the-run fallback.
    const urlA = hrrr?.frameByTime.get(timeA) ?? null;
    const urlB = hrrr?.frameByTime.get(timeB) ?? urlA;
    const hrrrMode = !!urlA;

    const vA = frameValues(data, meta, selectedIndex);
    const vB = frameValues(data, meta, Math.min(selectedIndex + 1, lastIdx));
    const bounds = hrrrMode
      ? [
          [hrrr.manifest.bounds.latS, hrrr.manifest.bounds.lonW],
          [hrrr.manifest.bounds.latN, hrrr.manifest.bounds.lonE],
        ]
      : null;
    const frame = { meta, vA, vB, imgA: null, imgB: null, bounds, changedAt: performance.now(), hrrrMode };
    frameRef.current = frame;

    // Always draw the exact hour on step: when playing, the rAF loop below
    // immediately takes over and blends toward the next hour — but if rAF is
    // throttled (hidden tab, low-power mode), this keeps playback stepping
    // instead of freezing the canvas while the clock advances.
    if (hrrrMode) {
      Promise.all([loadFrame(urlA), urlB ? loadFrame(urlB) : null]).then(([a, b]) => {
        if (frameRef.current !== frame || !smokeLayerRef.current) return; // stale hour
        frame.imgA = a;
        frame.imgB = b || a;
        smokeLayerRef.current.setImageFrames(a, b || a, 0, bounds);
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
  }, [gridTiers, selectedIndex, tier, playing, hrrr, verdictPm25]);

  useEffect(() => {
    if (!playing) return;
    let raf;
    const loop = () => {
      const f = frameRef.current;
      if (f && smokeLayerRef.current) {
        const t = Math.min(1, (performance.now() - f.changedAt) / (frameMs || 600));
        if (f.hrrrMode) {
          if (f.imgA) smokeLayerRef.current.setImageFrames(f.imgA, f.imgB, t, f.bounds);
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
