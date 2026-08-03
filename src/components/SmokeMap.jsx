import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { track } from '@vercel/analytics';
import 'leaflet/dist/leaflet.css';
import { SmokeCanvasLayer } from './SmokeLayer.js';
import { levelForPM25 } from '../lib/rating.js';
import {
  CARTO_ATTRIBUTION,
  CARTO_BASE_URL,
  CARTO_LABELS_URL,
  createTileHealth,
} from '../lib/basemap.js';
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
  hrrr,
  verdictPm25, // sensor-anchored series — marker must agree with the chip
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const smokeLayerRef = useRef(null);
  const markerRef = useRef(null);
  const frameRef = useRef(null); // { meta, vA, vB, imgA, imgB, bounds, changedAt, hrrrMode }
  const imageCacheRef = useRef(new Map()); // url -> HTMLImageElement (decoded)
  const [tier, setTier] = useState(1);
  const [basemapDown, setBasemapDown] = useState(false);

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
    // Both credits are required by CARTO's licence and must stay visible. They
    // ride this layer, and they leave with it — if the tiles fall back below,
    // Leaflet drops the attribution too, which is correct: we should not credit
    // a provider we have stopped using.
    const baseLayer = L.tileLayer(CARTO_BASE_URL, {
      maxZoom: 12,
      attribution: CARTO_ATTRIBUTION,
    }).addTo(map);

    const smokeLayer = new SmokeCanvasLayer();
    smokeLayer.addTo(map);
    smokeLayerRef.current = smokeLayer;

    // Between overlayPane (400, where the smoke canvas lives) and markerPane
    // (600, where the user's dot lives): labels sit over the smoke, the
    // "you are here" marker still sits over the labels.
    map.createPane('labels').style.zIndex = 450;
    map.getPane('labels').style.pointerEvents = 'none';
    const labelLayer = L.tileLayer(CARTO_LABELS_URL, {
      maxZoom: 12,
      pane: 'labels',
      // Attribution rides the base layer — same source, and Leaflet would
      // otherwise print the pair twice.
    }).addTo(map);

    // The tiles are keyless, so there is no quota to watch approach — the only
    // warning we get is the tiles themselves failing. When they do, drop to a
    // bare dark surface (the smoke field and the marker still work, and the
    // surface is the exact tone the ramp was audited against) and say so, once.
    const health = createTileHealth(({ errors, loads }) => {
      map.removeLayer(baseLayer);
      map.removeLayer(labelLayer);
      setBasemapDown(true);
      // No key means no provider-side alerting either, so this event is the
      // only way anyone finds out. Fires once per session, on trip only.
      track('basemap_unavailable', { provider: 'carto', errors, loads });
    });
    for (const layer of [baseLayer, labelLayer]) {
      layer.on('tileerror', health.onError);
      layer.on('tileload', health.onLoad);
    }

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

  return (
    <>
      <div className="smoke-map" ref={containerRef} />
      {basemapDown && (
        <p className="smoke-map__notice">
          The base map is unavailable right now. The smoke forecast and your location are
          unaffected.
        </p>
      )}
    </>
  );
}
