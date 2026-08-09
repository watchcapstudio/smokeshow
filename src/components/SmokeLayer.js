import L from 'leaflet';
import { ASH_GRAIN_FILL, ashSpeckFraction, smokeRGBA, smokeSpeckRGBA } from '../lib/rating.js';

// Sample resolution: one field sample per BLOCK px, scaled up with canvas
// smoothing. Small enough to look continuous, cheap enough for 60fps.
const BLOCK = 4;

// Continuous smoke field: bilinear interpolation of the PM2.5 grid onto a
// raster, plus temporal interpolation between two hourly frames (t: 0..1).
// This is what makes playback read as motion — the plume's gradients slide
// between what the model says at hour N and hour N+1, instead of 81 dots
// pulsing in place.
export class SmokeCanvasLayer extends L.Layer {
  constructor(options) {
    super(options);
    this._field = null;
    this._image = null;
  }

  // meta: { lat0, lon0, latStep, lonStep, size }; valuesA/valuesB: flat
  // Float64Array[size*size] for the two bracketing hours; t: blend 0..1.
  setField(meta, valuesA, valuesB, t) {
    this._field = { meta, valuesA, valuesB, t };
    this._image = null;
    this._redraw();
  }

  // Domain mode: crossfade two pre-rendered smooth frames, then lay the
  // ash-grain on top in SCREEN space — texture baked into a domain-wide image
  // becomes smudge after 10-20x upscaling, so the frames stay smooth and
  // the art happens here. bounds: [[latS, lonW], [latN, lonE]].
  // wraps: the domain spans the full 360°, so paint it in the neighbouring
  // world copies too — otherwise the global field ends at the antimeridian
  // and panning the Pacific walks off the edge of it.
  //
  // One domain at a time. This used to accept a coarser `base` pair, clipped
  // to outside `bounds`, so a regional field's rectangular edge did not read
  // as "no smoke here" when it meant "no model here" — removed because the two
  // domains carry different quantities (smoke vs total PM2.5) and butting them
  // together drew that difference as a rectangle. See the note in SmokeMap.jsx
  // and `git log` for the clipping code if a comparable field ever lands.
  setImageFrames(imgA, imgB, t, bounds, wraps = false) {
    this._image = { imgA, imgB, t, bounds, wraps };
    this._field = null;
    this._redraw();
  }

  clearSmoke() {
    this._image = null;
    this._field = null;
    if (this._canvas) {
      const ctx = this._canvas.getContext('2d');
      ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }
  }

  _grainPattern(ctx) {
    if (this._pattern) return this._pattern;
    const tile = document.createElement('canvas');
    tile.width = 96;
    tile.height = 96;
    const tctx = tile.getContext('2d');
    const CELL = 3;
    for (let cy = 0; cy < 32; cy++) {
      for (let cx = 0; cx < 32; cx++) {
        const h = ((((cx * 73856093) ^ (cy * 19349663)) >>> 0) % 1000) / 1000;
        if (h < 0.14) {
          // Pale, not dark: source-atop below keeps each speck's alpha equal to
          // the plume's own, so a speck reads as denser smoke only if it moves
          // toward the ramp's bright end. See ASH_GRAIN_FILL in rating.js.
          tctx.fillStyle = ASH_GRAIN_FILL;
          tctx.fillRect(cx * CELL, cy * CELL, 2, 2);
        }
      }
    }
    this._pattern = ctx.createPattern(tile, 'repeat');
    return this._pattern;
  }

  // Hidden while a pre-rendered domain frame covers the current hour.
  setVisible(visible) {
    if (this._canvas) this._canvas.style.display = visible ? '' : 'none';
  }

  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'smoke-canvas-layer');
    this._canvas.style.position = 'absolute';
    this._canvas.style.pointerEvents = 'none';
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on('moveend zoomend resize', this._reset, this);
    this._reset();
  }

  onRemove(map) {
    L.DomUtil.remove(this._canvas);
    map.off('moveend zoomend resize', this._reset, this);
  }

  _reset() {
    if (!this._map || !this._canvas) return;
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);
    const size = this._map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this._redraw();
  }

  _redraw() {
    if (!this._canvas || !this._map) return;
    if (this._image) {
      this._redrawImage();
      return;
    }
    if (!this._field) return;
    const { meta, valuesA, valuesB, t } = this._field;
    const { lat0, lon0, latStep, lonStep, size } = meta;
    const w = this._canvas.width;
    const h = this._canvas.height;
    if (!w || !h) return;

    const bw = Math.ceil(w / BLOCK);
    const bh = Math.ceil(h / BLOCK);
    // NOTE: named _raster (not _off) — L.Evented defines an internal _off()
    // method, and shadowing it with a canvas breaks Leaflet's event cleanup.
    if (!this._raster || this._raster.width !== bw || this._raster.height !== bh) {
      this._raster = document.createElement('canvas');
      this._raster.width = bw;
      this._raster.height = bh;
      this._rasterCtx = this._raster.getContext('2d');
      // Reused across frames — reallocating these every redraw churned the GC
      // during scrub/playback (a fresh ImageData + two typed arrays per frame).
      // Only rebuild on resize; the values below are fully overwritten each pass.
      this._lats = new Float64Array(bh);
      this._lons = new Float64Array(bw);
      this._imageData = this._rasterCtx.createImageData(bw, bh);
    }

    // Web Mercator: lon is linear in x, lat depends only on y — one projection
    // call per row/column instead of per sample.
    const lats = this._lats;
    const lons = this._lons;
    for (let by = 0; by < bh; by++) {
      lats[by] = this._map.containerPointToLatLng([0, by * BLOCK + BLOCK / 2]).lat;
    }
    for (let bx = 0; bx < bw; bx++) {
      lons[bx] = this._map.containerPointToLatLng([bx * BLOCK + BLOCK / 2, 0]).lng;
    }

    const img = this._imageData;
    const data = img.data;
    data.fill(0); // reused buffer: clear last frame so skipped cells stay transparent
    const n = size - 1;

    for (let by = 0; by < bh; by++) {
      const gi = (lats[by] - lat0) / latStep;
      if (gi < -0.5 || gi > n + 0.5) continue;
      for (let bx = 0; bx < bw; bx++) {
        const gj = (lons[bx] - lon0) / lonStep;
        if (gj < -0.5 || gj > n + 0.5) continue;

        const ci = Math.min(Math.max(gi, 0), n);
        const cj = Math.min(Math.max(gj, 0), n);
        const i0 = Math.min(Math.floor(ci), n - 1);
        const j0 = Math.min(Math.floor(cj), n - 1);
        const fi = ci - i0;
        const fj = cj - j0;
        const k00 = i0 * size + j0;
        const k10 = k00 + size;

        const a =
          valuesA[k00] * (1 - fi) * (1 - fj) +
          valuesA[k00 + 1] * (1 - fi) * fj +
          valuesA[k10] * fi * (1 - fj) +
          valuesA[k10 + 1] * fi * fj;
        const b =
          valuesB[k00] * (1 - fi) * (1 - fj) +
          valuesB[k00 + 1] * (1 - fi) * fj +
          valuesB[k10] * fi * (1 - fj) +
          valuesB[k10 + 1] * fi * fj;
        const v = a + (b - a) * t;

        const [r, g, bl, al] = smokeRGBA(v);
        // Soften the grid's outer boundary so the field doesn't end in a wall.
        const edge = Math.min(ci, cj, n - ci, n - cj);
        const fade = Math.min(1, (edge + 0.5) / 1.25);

        // Ash-grain stipple: a deterministic per-cell hash sprinkles brighter
        // specks whose density scales with concentration. Density changes
        // read far more strongly than flat tint changes, so the field
        // visibly evolves hour to hour. Hash is position-only — no flicker
        // between frames, specks dissolve in/out as the field moves.
        // The speck's direction is the ramp's business, not this loop's:
        // smokeSpeckRGBA() owns it so the two can't drift apart again.
        const a01 = (al / 255) * fade;
        const hash = ((((bx * 73856093) ^ (by * 19349663)) >>> 0) % 1000) / 1000;
        const p = (by * bw + bx) * 4;
        if (hash < ashSpeckFraction(a01)) {
          const [sr, sg, sb, sa] = smokeSpeckRGBA(v);
          data[p] = sr;
          data[p + 1] = sg;
          data[p + 2] = sb;
          data[p + 3] = Math.round(sa * fade);
        } else {
          data[p] = r;
          data[p + 1] = g;
          data[p + 2] = bl;
          data[p + 3] = Math.round(al * fade);
        }
      }
    }

    this._rasterCtx.putImageData(img, 0, 0);
    const ctx = this._canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._raster, 0, 0, w, h);
  }

  // Screen-space rect a domain's bounds occupy right now.
  _rect(bounds) {
    const nw = this._map.latLngToContainerPoint([bounds[1][0], bounds[0][1]]);
    const se = this._map.latLngToContainerPoint([bounds[0][0], bounds[1][1]]);
    return { x: nw.x, y: nw.y, w: se.x - nw.x, h: se.y - nw.y };
  }

  _paintPair(ctx, imgA, imgB, t, bounds, wraps) {
    const r = this._rect(bounds);
    const cw = this._canvas.width;
    // A 360°-wide domain is exactly one world wide, so the neighbouring copies
    // are a straight ±worldWidth shift. Only the copies that intersect the
    // viewport get drawn.
    const world = wraps ? this._map.getPixelWorldBounds()?.getSize().x || r.w : 0;
    const offsets = wraps
      ? [-world, 0, world].filter((o) => r.x + o < cw && r.x + o + r.w > 0)
      : [0];
    for (const o of offsets) {
      if (imgA) {
        ctx.globalAlpha = 1 - t;
        ctx.drawImage(imgA, r.x + o, r.y, r.w, r.h);
      }
      if (imgB && t > 0) {
        ctx.globalAlpha = t;
        ctx.drawImage(imgB, r.x + o, r.y, r.w, r.h);
      }
    }
    ctx.globalAlpha = 1;
  }

  _redrawImage() {
    const { imgA, imgB, t, bounds, wraps } = this._image;
    const ctx = this._canvas.getContext('2d');
    const w = this._canvas.width;
    const h = this._canvas.height;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;

    this._paintPair(ctx, imgA, imgB, t, bounds, wraps);

    // Screen-space ash grain, weighted by the smoke's own opacity:
    // source-atop multiplies the pattern by destination alpha, so specks
    // are faint over thin haze and dense over heavy smoke — no pixel reads.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = this._grainPattern(ctx);
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
}
