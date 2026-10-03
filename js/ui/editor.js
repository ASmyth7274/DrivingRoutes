// Route editor: tap roads on the map in driving order.

import { saveCustomRoute } from '../lib/storage.js';
import { displayDistanceText, formatDuration } from '../lib/units.js';
import { RouteModel } from '../nav/route-model.js';
import { newId } from '../services/centres.js';
import { routeEndpoints } from '../services/compiler.js';
import { nearestRoad, route as routeRequest } from '../services/router.js';
import { $, choose, esc, icon, toast } from './dom.js';

export const fullscreen = true;

let E = null;

export function enter(app, params = {}) {
  const centre = app.centre;
  const existing = params.routeId ? app.route(params.routeId) : null;
  const def = existing
    ? JSON.parse(JSON.stringify(existing))
    : { name: '', description: '', waypoints: [], tags: [] };
  if (!existing || params.copy) {
    def.id = newId('route');
    if (existing) def.name = `${existing.name} (my copy)`;
  }
  delete def.builtIn;
  delete def.hidden;
  def.custom = true;
  def.waypoints = (def.waypoints || []).map((w) => ({ ...w }));

  E = { app, def, selected: -1, history: [], timer: null, token: 0, model: null };

  const nav = $('#nav');
  nav.hidden = false;
  nav.innerHTML = `
    <div class="editor-top">
      <button class="icon-btn hit" data-act="back" aria-label="Back">${icon('back')}</button>
      <div class="hint">Tap the roads you want to drive, in order. Drag a point to move it, tap it to select. Starts and ends at ${esc(centre.name)}.</div>
    </div>
    <div class="editor-panel hit" id="ed-panel"></div>`;
  nav.onclick = onClick;

  app.map.clearRoute();
  app.map.showOutline([]);
  app.map.hidePuck();
  E.offClick = app.map.on('click', (e) => addPoint(e.lngLat));
  drawMarkers();
  renderPanel();
  const { start } = routeEndpoints(centre, def);
  const all = [start, ...def.waypoints.map((w) => w.at)];
  if (all.length > 1) app.map.fit(all, { top: 120, bottom: Math.round(window.innerHeight * 0.5), left: 40, right: 40 });
  else app.map.flyTo(start, 14);
  if (def.waypoints.length) schedulePreview(0);
}

function snapshot() {
  E.history.push(JSON.stringify(E.def.waypoints));
  if (E.history.length > 50) E.history.shift();
}

async function addPoint(lngLat) {
  if (!E) return;
  snapshot();
  const wp = { at: [Number(lngLat[0].toFixed(6)), Number(lngLat[1].toFixed(6))], road: '' };
  const at = E.selected >= 0 ? E.selected + 1 : E.def.waypoints.length;
  E.def.waypoints.splice(at, 0, wp);
  E.selected = E.selected >= 0 ? at : -1;
  drawMarkers();
  renderPanel();
  try {
    const near = await nearestRoad(wp.at[0], wp.at[1]);
    if (near.distance < 120) {
      wp.at = [Number(near.location[0].toFixed(6)), Number(near.location[1].toFixed(6))];
      wp.road = near.name || '';
      drawMarkers();
      renderPanel();
    }
  } catch { /* offline: keep the tapped point */ }
  schedulePreview();
}

function drawMarkers() {
  const app = E.app;
  app.map.clearMarkers();
  const { start, end } = routeEndpoints(app.centre, E.def);
  app.map.addMarker(start, { className: 'pin-start' });
  if (end && (end[0] !== start[0] || end[1] !== start[1])) app.map.addMarker(end, { className: 'pin-end' });
  E.def.waypoints.forEach((w, i) => {
    app.map.addMarker(w.at, {
      className: `wp ${i === E.selected ? 'sel' : ''}`,
      html: String(i + 1),
      draggable: true,
      onDrag: async (ll) => {
        snapshot();
        w.at = [Number(ll[0].toFixed(6)), Number(ll[1].toFixed(6))];
        w.road = '';
        try {
          const near = await nearestRoad(w.at[0], w.at[1]);
          if (near.distance < 120) {
            w.at = [Number(near.location[0].toFixed(6)), Number(near.location[1].toFixed(6))];
            w.road = near.name || '';
          }
        } catch { /* keep as dropped */ }
        drawMarkers();
        renderPanel();
        schedulePreview();
      },
      onClick: () => {
        E.selected = E.selected === i ? -1 : i;
        drawMarkers();
        renderPanel();
      },
    });
  });
}

function renderPanel() {
  const panel = $('#ed-panel');
  if (!panel || !E) return;
  const d = E.def;
  const m = E.model;
  const units = E.app.settings.units;
  panel.innerHTML = `
    <div class="grabber"></div>
    <div class="field"><label for="ed-name">Route name</label><input id="ed-name" value="${esc(d.name)}" placeholder="e.g. Bardills and back"></div>
    <div class="card progress-line" id="ed-stats">
      ${E.loading ? '<div class="spinner"></div>Updating route…' : m ? `${icon('route')} ${displayDistanceText(m.length, units)} · about ${formatDuration(m.duration * 1.15)}` : `${icon('info')} Tap the map to add your first waypoint`}
    </div>
    ${E.selected >= 0 ? `<p class="desc">Point ${E.selected + 1} selected: new taps are added after it.</p>` : ''}
    ${d.waypoints.length ? `<div class="card"><ul class="wp-list">
      ${d.waypoints.map((w, i) => `<li><span class="n" style="${i === E.selected ? 'background:#e8453c' : ''}">${i + 1}</span><span class="r">${esc(w.road || 'Unnamed road')}</span>
        <button class="icon-btn" data-del="${i}" aria-label="Remove point ${i + 1}">${icon('trash')}</button></li>`).join('')}
    </ul></div>` : ''}
    <div class="actions">
      <div class="row-btns">
        <button class="btn secondary small" data-act="undo" ${E.history.length ? '' : 'disabled'}>Undo</button>
        <button class="btn secondary small" data-act="clear" ${d.waypoints.length ? '' : 'disabled'}>Clear</button>
      </div>
      <button class="btn primary block" data-act="save" ${d.waypoints.length ? '' : 'disabled'}>Save route</button>
    </div>`;
  $('#ed-name').oninput = (e) => { E.def.name = e.target.value; };
}

function schedulePreview(ms = 900) {
  clearTimeout(E.timer);
  E.timer = setTimeout(preview, ms);
}

async function preview() {
  if (!E) return;
  const my = ++E.token;
  const app = E.app;
  const { start, end } = routeEndpoints(app.centre, E.def);
  if (!E.def.waypoints.length) {
    E.model = null;
    app.map.clearRoute();
    renderPanel();
    return;
  }
  E.loading = true;
  renderPanel();
  try {
    const points = [start, ...E.def.waypoints.map((w) => w.at), end].map(([lon, lat]) => ({ lon, lat }));
    const data = await routeRequest(points);
    if (!E || my !== E.token) return;
    E.model = new RouteModel(data);
    app.map.showRoute(E.model);
  } catch (err) {
    if (E && my === E.token) toast(`Couldn't draw the route: ${err.message}`);
  } finally {
    if (E && my === E.token) {
      E.loading = false;
      renderPanel();
    }
  }
}

async function onClick(e) {
  if (!E) return;
  const del = e.target.closest('[data-del]');
  if (del) {
    snapshot();
    const i = Number(del.dataset.del);
    E.def.waypoints.splice(i, 1);
    if (E.selected >= E.def.waypoints.length) E.selected = -1;
    drawMarkers();
    renderPanel();
    schedulePreview();
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'back') {
    if (E.def.waypoints.length && E.history.length) {
      const v = await choose({ title: 'Leave without saving?', buttons: [{ label: 'Discard changes', value: true, kind: 'danger' }, { label: 'Keep editing', value: false }] });
      if (!v) return;
    }
    E.app.back();
  } else if (act === 'undo') {
    const prev = E.history.pop();
    if (prev) {
      E.def.waypoints = JSON.parse(prev);
      E.selected = -1;
      drawMarkers();
      renderPanel();
      schedulePreview();
    }
  } else if (act === 'clear') {
    snapshot();
    E.def.waypoints = [];
    E.selected = -1;
    drawMarkers();
    renderPanel();
    schedulePreview(0);
  } else if (act === 'save') {
    save();
  }
}

function save() {
  const app = E.app;
  const def = E.def;
  def.name = (def.name || '').trim() || `My route ${new Date().toLocaleDateString('en-GB')}`;
  def.waypoints = def.waypoints.map((w) => (w.road ? { at: w.at, road: w.road } : { at: w.at }));
  const { custom, ...clean } = def;
  void custom;
  saveCustomRoute(app.centre.id, clean);
  app.compiled.delete(clean.id);
  toast('Route saved');
  const id = clean.id;
  app.history = [];
  app.show('preview', { routeId: id }, { replace: true });
}

export function leave(app) {
  if (E) {
    clearTimeout(E.timer);
    E.offClick?.();
  }
  E = null;
  app.map.clearMarkers();
  const nav = $('#nav');
  nav.onclick = null;
  nav.innerHTML = '';
  nav.hidden = true;
}
