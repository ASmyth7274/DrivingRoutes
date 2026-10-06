// Home: test centre, route list and quick actions.

import { destination, round6 } from '../lib/geo.js';
import { getHistory, saveCustomRoute } from '../lib/storage.js';
import { isOffline } from '../lib/net.js';
import { newId } from '../services/centres.js';
import { nearestRoad } from '../services/router.js';
import { displayDistanceText, formatDuration } from '../lib/units.js';
import { $, choose, esc, icon, ROUTE_COLOURS, toast } from './dom.js';

let preparing = false;
let disposed = false;

export function colourFor(app, route) {
  const all = app.routes({ includeHidden: true });
  const i = Math.max(0, all.findIndex((r) => r.id === route.id));
  return ROUTE_COLOURS[i % ROUTE_COLOURS.length];
}

export function numberFor(app, route) {
  const all = app.routes({ includeHidden: true });
  return all.findIndex((r) => r.id === route.id) + 1;
}

function sortRoutes(routes) {
  // Most popular first; equal ones keep their order in the centre file, so card numbers run in order.
  return [...routes].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

function statsLine(app, route, data) {
  const parts = [];
  if (data) {
    parts.push(displayDistanceText(data.distance, app.settings.units));
    parts.push(`~${formatDuration(data.duration * 1.15)}`);
  } else if (route.estMinutes) {
    parts.push(`about ${route.estMinutes} min`);
  }
  const h = getHistory(app.centre.id, route.id);
  if (h?.count) parts.push(`driven ${h.count}×`);
  return parts.join(' · ');
}

function card(app, route, data) {
  const pop = (route.popularity || 0) >= 4;
  const tags = (route.tags || []).slice(0, 4);
  return `
    <button class="card route-card" data-route="${esc(route.id)}">
      <div class="route-num" style="--c:${colourFor(app, route)}">${route.custom ? icon('route') : numberFor(app, route)}</div>
      <div>
        <div class="route-title">${esc(route.name)}</div>
        <div class="route-meta">${esc(statsLine(app, route, data)) || '&nbsp;'}</div>
        <div class="chips">
          ${pop ? '<span class="chip gold">★ Popular</span>' : ''}
          ${route.custom ? '<span class="chip grey">Your route</span>' : ''}
          ${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
        </div>
      </div>
      ${icon('chev', 'chev')}
    </button>`;
}

async function render(app) {
  const sheet = $('#sheet');
  const c = app.centre;
  if (!c) {
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="sheet-head"><div class="app-title"><img class="logo" src="icons/icon-192.png" alt=""><h1>Test Routes</h1></div></div>
      <div class="empty">No test centre set up yet.</div>
      <div class="actions"><button class="btn primary block" data-act="centres">Add a test centre</button></div>`;
    sheet.querySelector('[data-act="centres"]').onclick = () => app.show('centres');
    return;
  }
  const routes = sortRoutes(app.routes());
  const builtIn = routes.filter((r) => !r.custom);
  const mine = routes.filter((r) => r.custom);
  const datas = await Promise.all(routes.map((r) => app.cachedRoute(r)));
  const dataFor = new Map(routes.map((r, i) => [r.id, datas[i]]));
  if (disposed) return;

  sheet.innerHTML = `
    <div class="grabber"></div>
    <div class="sheet-head">
      <div class="app-title">
        <img class="logo" src="icons/icon-192.png" alt="">
        <h1>Test Routes</h1>
        <button class="icon-btn" data-act="settings" aria-label="Settings">${icon('gear')}</button>
      </div>
      <button class="centre-chip" data-act="centres">
        ${icon('pin')}
        <div class="grow">
          <div class="name">${esc(c.name)}</div>
          <div class="addr">${esc(c.address || 'Tap to change test centre')}</div>
        </div>
        ${icon('down')}
      </button>
    </div>
    ${routes.length ? `
    <div class="quick-actions">
      <button class="btn secondary" data-act="random">${icon('shuffle')} Random route</button>
      <button class="btn secondary" data-act="mock">${icon('test')} Mock test</button>
    </div>` : ''}
    <div id="prep-status"></div>
    ${builtIn.length ? `<div class="section-title"><span>${c.practice ? 'Practice routes' : 'Common test routes'}</span><span>${builtIn.length}</span></div>` : ''}
    ${builtIn.map((r) => card(app, r, dataFor.get(r.id))).join('')}
    <div class="section-title"><span>Your routes</span></div>
    ${mine.map((r) => card(app, r, dataFor.get(r.id))).join('') || '<div class="empty">Make your own route by tapping roads on the map, or record one while you drive with your instructor.</div>'}
    <div class="quick-actions">
      <button class="btn secondary" data-act="create">${icon('plus')} Create route</button>
      <button class="btn secondary" data-act="record">${icon('record')} Record a drive</button>
    </div>
    <div class="actions" style="margin-top:0">
      <button class="btn secondary block" data-act="loop">${icon('refresh')} Make a practice loop near the centre</button>
    </div>
    <p class="about">${builtIn.length && !c.practice ? "Routes are based on roads commonly reported around this test centre. DVSA doesn't publish test routes, so your test may differ. " : ''}${c.practice ? 'These are practice loops that copy the kinds of road on test routes, not real test routes. ' : ''}Always follow road signs, markings and your examiner over the app.</p>`;

  sheet.onclick = (e) => {
    const r = e.target.closest('[data-route]');
    if (r) {
      app.show('preview', { routeId: r.dataset.route });
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'settings') app.show('settings');
    else if (act === 'centres') app.show('centres');
    else if (act === 'create') app.show('editor', {});
    else if (act === 'record') app.show('record');
    else if (act === 'loop') generateLoop(app, a);
    else if (act === 'random') randomRoute(app, false);
    else if (act === 'mock') randomRoute(app, true);
  };

  showOutlines(app, routes, dataFor);
  prepareAll(app, routes, dataFor);
}

/** A random loop through roads 1.4–3 km around the centre, for centres without routes. */
async function generateLoop(app, button) {
  if (isOffline()) {
    toast('Making a loop needs a signal.');
    return;
  }
  button.disabled = true;
  button.innerHTML = '<div class="spinner"></div> Picking roads…';
  const c = app.centre.location;
  const first = Math.random() * 360;
  const waypoints = [];
  for (let i = 0; i < 4; i++) {
    const p = destination(c, first + i * 90 + (Math.random() - 0.5) * 40, 1400 + Math.random() * 1600);
    const wp = { at: round6(p) };
    try {
      const near = await nearestRoad(p[0], p[1]);
      wp.at = round6(near.location);
      if (near.name) wp.road = near.name;
    } catch { /* keep the raw point */ }
    waypoints.push(wp);
  }
  const n = app.routes({ includeHidden: true }).filter((r) => /^Practice loop/.test(r.name)).length + 1;
  const route = {
    id: newId('route'),
    name: `Practice loop ${n}`,
    description: 'Made automatically through roads around the test centre. Make another for a different mix of roads.',
    tags: ['Generated'],
    waypoints,
  };
  saveCustomRoute(app.centre.id, route);
  app.show('preview', { routeId: route.id });
}

function pickWeighted(routes) {
  const weights = routes.map((r) => Math.max(1, r.popularity || 1));
  let x = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < routes.length; i++) {
    x -= weights[i];
    if (x <= 0) return routes[i];
  }
  return routes[routes.length - 1];
}

async function randomRoute(app, mock) {
  const routes = app.routes().filter((r) => !r.custom || mock === false);
  if (!routes.length) return;
  const r = pickWeighted(routes);
  if (mock) {
    const ok = await choose({
      title: 'Mock driving test',
      message: `You'll get a route you don't know in advance, like on the day. The examiner voice gives directions, with about 20 minutes of independent driving following the sat nav in the middle.`,
      buttons: [
        { label: 'Start mock test', value: 'start', kind: 'go' },
        { label: 'Practice at home (simulated)', value: 'sim' },
        { label: 'Cancel', value: null },
      ],
    });
    if (!ok) return;
    if (app.voice.enabled) app.voice.prime('Starting mock test.');
    app.show('preview', { routeId: r.id, autostart: ok === 'start' ? 'drive' : 'sim', mock: true, hideName: true });
  } else {
    toast(`Random pick: ${r.name}`);
    app.show('preview', { routeId: r.id });
  }
}

function showOutlines(app, routes, dataFor) {
  if (!routes || !dataFor) return;
  const lines = routes
    .map((r) => ({ coords: dataFor.get(r.id)?.coords, color: colourFor(app, r) }))
    .filter((x) => x.coords);
  app.map.clearRoute();
  app.map.showOutline(lines);
  app.map.hidePuck();
  const pad = { top: 60, bottom: Math.round(window.innerHeight * 0.62) + 20, left: 30, right: 30 };
  if (window.innerWidth > window.innerHeight && window.innerHeight < 540) {
    pad.bottom = 30;
    pad.left = Math.min(420, window.innerWidth * 0.5) + 30;
  }
  const all = lines.flatMap((l) => l.coords);
  if (all.length) app.map.fit(all, pad, { duration: 0 });
  else app.map.flyTo(app.centre.location, 13);
  app.map.setNotes([]);
}

/** Quietly compute and cache every route so they work offline later. */
async function prepareAll(app, routes, dataFor) {
  if (preparing || isOffline()) return;
  const todo = routes.filter((r) => !dataFor.get(r.id));
  if (!todo.length) return;
  preparing = true;
  const el = () => document.getElementById('prep-status');
  let done = 0;
  try {
    for (const r of todo) {
      if (disposed) break;
      const box = el();
      if (box) box.innerHTML = `<div class="card progress-line"><div class="spinner"></div>Preparing routes for offline use… ${done + 1} of ${todo.length}</div>`;
      try {
        await app.compile(r);
      } catch (err) {
        console.warn('Could not prepare route', r.id, err);
      }
      done++;
      await new Promise((res) => setTimeout(res, 400));
    }
  } finally {
    preparing = false;
    const box = el();
    if (box) box.innerHTML = '';
    if (!disposed && app.screenName === 'home') render(app);
  }
}

export function enter(app) {
  disposed = false;
  const sheet = $('#sheet');
  sheet.className = 'sheet';
  sheet.scrollTop = 0;
  render(app);
}

export function leave() {
  disposed = true;
  $('#sheet').onclick = null;
}
