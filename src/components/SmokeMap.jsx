import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { SmokeCanvasLayer } from './SmokeLayer.js';
import { levelForPM25 } from '../lib/rating.js';
import { frameAt } from '../lib/smokeFrames.js';
import './SmokeMap.css';

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
  frames, // pre-rendered smoke domains (HRRR CONUS + CAMS global), or null
  onCoverage, // reports which field is painting, so the UI can name it
  verdictPm25, // sensor-anchored series — marker must agree with the chip
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const smokeLayerRef = useRef(null);
  const markerRef = useRef(null);
  const frameRef = useRef(null); // { meta, vA, vB, imgA, imgB, bounds, changedAt, sharpMode }
  const imageCacheRef = useRef(new Map()); // url -> HTMLImageElement (decoded)
  const [tier, setTier] = useState(1);

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
    // Three-layer sandwich, not dark_all: base tiles, then the smoke canvas,
    // then the labels on top. Heavy smoke composites to near-opaque ivory, so
    // labels baked into the basemap would be buried exactly when a reader most
    // needs to know which city is under the plume. Splitting them is the only
    // way to keep the place names above the weather.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
      maxZoom: 12,
      // CARTO's basemaps are free to use with attribution; both credits are
      // required and must stay visible.
      // Copernicus/CAMS attribution is required wherever the global field can
      // paint, which is everywhere — so it ships with the other two credits
      // rather than appearing and disappearing with the domain.
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
        '&copy; <a href="https://carto.com/attributions">CARTO</a> &middot; ' +
        'smoke: NOAA HRRR-Smoke &amp; ' +
        '<a href="https://atmosphere.copernicus.eu/">Copernicus Atmosphere Monitoring Service</a>',
    }).addTo(map);

    const smokeLayer = new SmokeCanvasLayer();
    smokeLayer.addTo(map);
    smokeLayerRef.current = smokeLayer;

    // Between overlayPane (400, where the smoke canvas lives) and markerPane
    // (600, where the user's dot lives): labels sit over the smoke, the
    // "you are here" marker still sits over the labels.
    map.createPane('labels').style.zIndex = 450;
    map.getPane('labels').style.pointerEvents = 'none';
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
      maxZoom: 12,
      pane: 'labels',
      // Attribution rides the base layer — same source, and Leaflet would
      // otherwise print the pair twice.
    }).addTo(map);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!gridTiers[tier]) onNeedTier?.(tier);
  }, [tier, gridTiers, onNeedTier]);

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

    // Prefer the sharpest pre-rendered field that covers this hour AND this
    // place; the point-grid canvas is the fallback when neither does. The
    // place half is what stops a CONUS image being pinned over a reader in
    // Edmonton with no smoke drawn over them at all.
    const hitA = frameAt(frames, timeA, center.lat, center.lon);
    const hitB = frameAt(frames, timeB, center.lat, center.lon);
    const urlA = hitA?.url ?? null;
    const urlB = hitB?.url ?? urlA;
    const sharpMode = !!urlA;

    const vA = frameValues(data, meta, selectedIndex);
    const vB = frameValues(data, meta, Math.min(selectedIndex + 1, lastIdx));
    // Bounds come from the domain that actually won, not from a single global
    // manifest — the two domains cover different boxes.
    const bounds = sharpMode
      ? [
          [hitA.domain.bounds.latS, hitA.domain.bounds.lonW],
          [hitA.domain.bounds.latN, hitA.domain.bounds.lonE],
        ]
      : null;
    const frame = { meta, vA, vB, imgA: null, imgB: null, bounds, changedAt: performance.now(), sharpMode };
    frameRef.current = frame;

    // The old fallback was silent. Naming the field is the same honesty rule
    // as "model estimate, never observed".
    onCoverage?.(hitA ? { key: hitA.domain.key, label: hitA.domain.label, resolutionKm: hitA.domain.resolutionKm } : null);

    // Always draw the exact hour on step: when playing, the rAF loop below
    // immediately takes over and blends toward the next hour — but if rAF is
    // throttled (hidden tab, low-power mode), this keeps playback stepping
    // instead of freezing the canvas while the clock advances.
    if (sharpMode) {
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
  }, [gridTiers, selectedIndex, tier, playing, frames, verdictPm25, center.lat, center.lon, onCoverage]);

  useEffect(() => {
    if (!playing) return;
    let raf;
    const loop = () => {
      const f = frameRef.current;
      if (f && smokeLayerRef.current) {
        const t = Math.min(1, (performance.now() - f.changedAt) / (frameMs || 600));
        if (f.sharpMode) {
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

  return <div className="smoke-map" ref={containerRef} />;
}
