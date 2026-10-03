// MapLibre wrapper: route drawing, the car marker and sat nav camera.
// Map tiles: OpenFreeMap (free OpenStreetMap vector tiles, no key needed).

import { bbox, sliceLine } from '../lib/geo.js';
import { Emitter } from '../lib/events.js';

export const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

const RASTER_FALLBACK = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#e9e5dc' } },
    { id: 'osm', type: 'raster', source: 'osm' },
  ],
};

const EMPTY = { type: 'FeatureCollection', features: [] };

function line(coords, props = {}) {
  if (!coords || coords.length < 2) return EMPTY;
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } }] };
}

function points(list) {
  return {
    type: 'FeatureCollection',
    features: list.map((p) => ({ type: 'Feature', properties: p.props || {}, geometry: { type: 'Point', coordinates: p.at } })),
  };
}

function arrowheadImage() {
  const size = 48;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(size / 2, 4);
  g.lineTo(size - 6, size - 8);
  g.lineTo(6, size - 8);
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 6;
  g.strokeStyle = '#1557b0';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.fill();
  return g.getImageData(0, 0, size, size);
}

export class MapView extends Emitter {
  constructor(el, { theme = 'light' } = {}) {
    super();
    this.el = el;
    this.theme = theme;
    this.data = { route: EMPTY, done: EMPTY, arrow: EMPTY, arrowHead: EMPTY, vias: EMPTY, off: EMPTY, track: EMPTY, alt: EMPTY };
    this.available = typeof window !== 'undefined' && !!window.maplibregl;
    this.styleFailed = false;
    this.puck = null;
    this.markers = [];
    if (!this.available) return;
    try {
      this.map = new window.maplibregl.Map({
        container: el,
        style: STYLES[theme] || STYLES.light,
        center: [-1.2383, 52.9047],
        zoom: 12,
        attributionControl: false,
        maxPitch: 65,
        fadeDuration: 0,
        dragRotate: true,
        touchPitch: true,
        cooperativeGestures: false,
        refreshExpiredTiles: false,
      });
    } catch (err) {
      console.error('Map failed to start', err);
      this.available = false;
      return;
    }
    this.map.addControl(new window.maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    this.styleLoaded = false;
    this.map.on('style.load', () => {
      this.styleLoaded = true;
      this._ensureLayers();
    });
    this.map.on('error', (e) => this._onError(e));
    const userMove = (e) => { if (e.originalEvent) this.emit('usermove'); };
    this.map.on('dragstart', userMove);
    this.map.on('zoomstart', userMove);
    this.map.on('rotatestart', userMove);
    this.map.on('pitchstart', userMove);
    this.map.on('click', (e) => {
      // Taps on markers are handled by the marker itself.
      if (e.originalEvent?.target?.closest?.('.maplibregl-marker')) return;
      this.emit('click', { lngLat: [e.lngLat.lng, e.lngLat.lat], point: e.point });
    });
  }

  _onError(e) {
    // The style itself failed to load (e.g. first run with no signal, or the
    // tile service is down): fall back to plain OpenStreetMap raster tiles.
    if (!this.styleLoaded && !this.styleFailed) {
      console.warn('Map style failed to load, using raster fallback', e?.error);
      this.styleFailed = true;
      this.map.setStyle(RASTER_FALLBACK);
      this.emit('stylefallback');
    }
  }

  setTheme(theme) {
    if (!this.available || theme === this.theme) return;
    this.theme = theme;
    if (this.styleFailed) return;
    this.styleLoaded = false;
    this.map.setStyle(STYLES[theme] || STYLES.light);
  }

  resize() {
    this.map?.resize();
  }

  _firstSymbolLayer() {
    const layers = this.map.getStyle()?.layers || [];
    return layers.find((l) => l.type === 'symbol')?.id;
  }

  _ensureLayers() {
    const m = this.map;
    if (!m.hasImage('dtr-arrowhead')) m.addImage('dtr-arrowhead', arrowheadImage(), { pixelRatio: 2 });
    for (const [id, data] of Object.entries(this.data)) {
      if (!m.getSource(`dtr-${id}`)) m.addSource(`dtr-${id}`, { type: 'geojson', data });
    }
    const before = this._firstSymbolLayer();
    const add = (layer, beforeId) => { if (!m.getLayer(layer.id)) m.addLayer(layer, beforeId); };
    add({ id: 'dtr-alt', type: 'line', source: 'dtr-alt', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['coalesce', ['get', 'color'], '#5b8def'], 'line-width': 4, 'line-opacity': 0.55 } }, before);
    add({ id: 'dtr-route-casing', type: 'line', source: 'dtr-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0b3d91', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 10, 18, 22] } }, before);
    add({ id: 'dtr-route', type: 'line', source: 'dtr-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2f7cf6', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 7, 18, 16] } }, before);
    add({ id: 'dtr-done', type: 'line', source: 'dtr-done', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#8a94a6', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 7, 18, 16], 'line-opacity': 0.85 } }, before);
    add({ id: 'dtr-track', type: 'line', source: 'dtr-track', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#e8453c', 'line-width': 5 } }, before);
    add({ id: 'dtr-off', type: 'line', source: 'dtr-off', layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#f29d38', 'line-width': 4, 'line-dasharray': [1.5, 1.5] } });
    add({ id: 'dtr-arrow-casing', type: 'line', source: 'dtr-arrow', layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#1557b0', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 24] } });
    add({ id: 'dtr-arrow', type: 'line', source: 'dtr-arrow', layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 5, 18, 15] } });
    add({ id: 'dtr-arrowhead', type: 'symbol', source: 'dtr-arrowHead',
      layout: {
        'icon-image': 'dtr-arrowhead', 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.55, 18, 1.5],
      } });
    add({ id: 'dtr-vias', type: 'circle', source: 'dtr-vias',
      paint: {
        'circle-radius': ['match', ['get', 'kind'], 'start', 8, 'end', 8, 'note', 7, 4],
        'circle-color': ['match', ['get', 'kind'], 'start', '#18a058', 'end', '#d93025', 'note', '#f29d38', '#ffffff'],
        'circle-stroke-color': ['match', ['get', 'kind'], 'via', '#2f7cf6', '#ffffff'],
        'circle-stroke-width': 2.5,
      } });
    this.emit('styleready');
  }

  _set(id, data) {
    this.data[id] = data;
    const src = this.map?.getSource?.(`dtr-${id}`);
    if (src) src.setData(data);
  }

  /** Draw a full route (preview) with start/end and optional notes. */
  showRoute(model, { notes = [], showVias = false } = {}) {
    this.model = model;
    this._set('route', line(model.coords));
    this._set('done', EMPTY);
    this._set('arrow', EMPTY);
    this._set('arrowHead', EMPTY);
    const pts = [
      { at: model.start, props: { kind: 'start' } },
      { at: model.end, props: { kind: 'end' } },
      ...notes.map((n) => ({ at: n.at, props: { kind: 'note' } })),
    ];
    if (showVias) model.vias.forEach((v) => pts.push({ at: v.location, props: { kind: 'via' } }));
    this._set('vias', points(pts));
  }

  showOutline(routes) {
    // routes: [{ coords, color }]
    this._set('alt', {
      type: 'FeatureCollection',
      features: routes.filter((r) => r.coords?.length > 1).map((r) => ({
        type: 'Feature', properties: { color: r.color }, geometry: { type: 'LineString', coordinates: r.coords },
      })),
    });
  }

  clearRoute() {
    this.model = null;
    for (const id of ['route', 'done', 'arrow', 'arrowHead', 'vias', 'off']) this._set(id, EMPTY);
  }

  setNotes(notes) {
    const model = this.model;
    const pts = model ? [{ at: model.start, props: { kind: 'start' } }, { at: model.end, props: { kind: 'end' } }] : [];
    notes.forEach((n) => pts.push({ at: n.at, props: { kind: 'note' } }));
    this._set('vias', points(pts));
  }

  /** Grey out the part already driven. */
  setProgress(along) {
    const m = this.model;
    if (!m) return;
    this._set('done', line(sliceLine(m.coords, m.cum, 0, along)));
    this._set('route', line(sliceLine(m.coords, m.cum, along, m.length)));
  }

  /** White arrow on the road showing the next manoeuvre. */
  setManeuverArrow(step) {
    const m = this.model;
    if (!m || !step || step.type === 'arrive') {
      this._set('arrow', EMPTY);
      this._set('arrowHead', EMPTY);
      return;
    }
    const seg = sliceLine(m.coords, m.cum, Math.max(0, step.along - 28), Math.min(m.length, step.along + 22));
    if (seg.length < 2) return;
    this._set('arrow', line(seg));
    const end = seg[seg.length - 1];
    const pt = m.pointAt(Math.min(m.length, step.along + 22));
    this._set('arrowHead', points([{ at: end, props: { bearing: pt.bearing } }]));
  }

  setOffRouteLine(from, to) {
    this._set('off', from && to ? line([from, to]) : EMPTY);
  }

  setTrack(coords) {
    this._set('track', line(coords));
  }

  setPuck(point, bearingDeg, { off = false } = {}) {
    if (!this.available) return;
    if (!this.puck) {
      const el = document.createElement('div');
      el.className = 'puck';
      el.innerHTML = '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" class="puck-ring"/><path d="M24 8 L36 36 L24 30 L12 36 Z" class="puck-arrow"/></svg>';
      this.puck = new window.maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat(point)
        .addTo(this.map);
    }
    this.puck.setLngLat(point);
    this.puck.setRotation(bearingDeg || 0);
    this.puck.getElement().classList.toggle('off', off);
  }

  hidePuck() {
    this.puck?.remove();
    this.puck = null;
  }

  follow({ center, bearing, zoom, pitch, padding }) {
    if (!this.available) return;
    this.map.jumpTo({ center, bearing, zoom, pitch, padding });
  }

  fit(coords, padding = 40, opts = {}) {
    if (!this.available || !coords?.length) return;
    const [x0, y0, x1, y1] = bbox(coords);
    this.map.fitBounds([[x0, y0], [x1, y1]], { padding, bearing: 0, pitch: 0, duration: opts.duration ?? 600, maxZoom: 16 });
  }

  flyTo(center, zoom = 14) {
    if (!this.available) return;
    this.map.jumpTo({ center, zoom, bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  }

  addMarker(lngLat, { html = '', className = 'pin', draggable = false, onDrag, onClick } = {}) {
    if (!this.available) return null;
    const el = document.createElement('div');
    el.className = className;
    el.innerHTML = html;
    const mk = new window.maplibregl.Marker({ element: el, draggable }).setLngLat(lngLat).addTo(this.map);
    if (onDrag) mk.on('dragend', () => { const ll = mk.getLngLat(); onDrag([ll.lng, ll.lat]); });
    if (onClick) el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    this.markers.push(mk);
    return mk;
  }

  clearMarkers() {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
  }
}
