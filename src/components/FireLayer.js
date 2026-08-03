import L from 'leaflet';
import {
  fireIconPx,
  fireLegendText,
  fireOpacity,
  fireSummary,
  mergeClusters,
  mergePxForZoom,
  minDetectionsForZoom,
} from '../lib/hotspots.js';

// NASA FIRMS heat detections, drawn as clustered ember icons above the smoke.
//
// Two constraints drive the whole implementation:
//
// 1. The icon has to read against a near-black basemap AND against a plume
//    that composites to near-white ivory — and fires are exactly where the
//    plume is, so the bright case is the normal case, not the edge case. The
//    answer is opposite-polarity rings: a dark outer ring carries the icon on
//    heavy smoke, a pale inner ring carries it on bare tiles, and the ember
//    core is never asked to do the contrast work alone. Same trick the "you
//    are here" marker uses, at a size that survives being zoomed out.
//
// 2. Fires are a zoomed-out feature. The clusters arrive pre-linked at ~10 km;
//    this layer merges further in SCREEN space, so the icon count depends on
//    how much map a reader can see rather than on how many hotspots exist.
export class FireLayer extends L.Layer {
  constructor() {
    super();
    this._fires = null;
  }

  setFires(fires) {
    this._fires = fires;
    this._render();
  }

  onAdd(map) {
    this._map = map;
    // Above the label tiles (450) — a fire icon buried under a place name is
    // a fire icon that failed. Below the marker pane (600), so the reader's
    // own location still wins.
    if (!map.getPane('fires')) {
      const pane = map.createPane('fires');
      pane.style.zIndex = 460;
    }
    this._container = L.DomUtil.create('div', 'fire-layer');
    this._container.style.position = 'absolute';
    map.getPane('fires').appendChild(this._container);
    // Icons take clicks; the gaps between them stay draggable map.
    L.DomEvent.disableClickPropagation(this._container);
    L.DomEvent.disableScrollPropagation(this._container);
    map.on('moveend zoomend resize', this._render, this);
    this._render();
  }

  onRemove(map) {
    L.DomUtil.remove(this._container);
    map.off('moveend zoomend resize', this._render, this);
    this._container = null;
  }

  _render() {
    if (!this._map || !this._container) return;
    const map = this._map;
    L.DomUtil.setPosition(this._container, map.containerPointToLayerPoint([0, 0]));
    this._container.innerHTML = '';
    if (!this._fires?.clusters?.length) {
      this._legend?.remove();
      this._legend = null;
      return;
    }

    // Only what is on screen, with a margin so an icon does not pop in at the
    // edge of a pan.
    const bounds = map.getBounds().pad(0.25);
    const visible = this._fires.clusters.filter((c) =>
      bounds.contains(L.latLng(c.lat, c.lon)),
    );

    const zoom = map.getZoom();
    const merged = mergeClusters(
      visible,
      (lat, lon) => map.latLngToContainerPoint([lat, lon]),
      mergePxForZoom(zoom),
    );

    // The zoom floor drops isolated small clusters so the continental view is
    // about the complexes driving the smoke. How many it dropped goes in the
    // legend — see fireLegendText.
    const floor = minDetectionsForZoom(zoom);
    const drawn = merged.filter((m) => m.n >= floor);
    const hidden = merged.length - drawn.length;

    const opacity = fireOpacity(zoom);
    for (const m of drawn) {
      const px = fireIconPx(m.n, zoom);
      const el = L.DomUtil.create('button', 'fire-icon', this._container);
      el.type = 'button';
      el.style.width = `${px}px`;
      el.style.height = `${px}px`;
      el.style.left = `${m.x}px`;
      el.style.top = `${m.y}px`;
      el.style.opacity = String(opacity);
      // Screen readers get the honest noun, not "fire".
      el.setAttribute(
        'aria-label',
        `${m.n} satellite heat detection${m.n === 1 ? '' : 's'} — tap for detail`,
      );
      // The count only fits — and only helps — once the icon is big enough to
      // hold it. Below that the size IS the count.
      if (px >= 20) {
        const label = L.DomUtil.create('span', 'fire-icon__count', el);
        label.style.fontSize = `${Math.max(9, Math.round(px * 0.34))}px`;
        label.textContent = m.n >= 1000 ? `${Math.round(m.n / 100) / 10}k` : String(m.n);
      }
      L.DomEvent.on(el, 'click', (e) => {
        L.DomEvent.stop(e);
        this._openPopup(m);
      });
    }

    this._renderLegend(drawn.length > 0, hidden);
  }

  _openPopup(m) {
    const s = fireSummary(m, this._fires);
    const body = s.lines.map((l) => `<p>${l}</p>`).join('');
    L.popup({ className: 'fire-popup', maxWidth: 260, autoPanPadding: [16, 16] })
      .setLatLng([m.lat, m.lon])
      .setContent(`<h4>${s.title}</h4>${body}`)
      .openOn(this._map);
  }

  _renderLegend(show, hidden) {
    if (!show) {
      this._legend?.remove();
      this._legend = null;
      this._legendText = null;
      return;
    }
    if (!this._legend) {
      const legend = L.control({ position: 'bottomleft' });
      legend.onAdd = () => {
        const el = L.DomUtil.create('div', 'fire-legend');
        el.innerHTML = '<span class="fire-legend__dot"></span><span></span>';
        this._legendText = el.lastElementChild;
        return el;
      };
      legend.addTo(this._map);
      this._legend = legend;
    }
    if (this._legendText) this._legendText.textContent = fireLegendText(hidden);
  }
}
