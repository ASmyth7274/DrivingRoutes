// Route preview: map of the whole route, stats, hotspots and the turn list.

import { deleteCustomRoute, getHistory, setRouteHidden } from '../lib/storage.js';
import { displayDistanceText, formatDuration } from '../lib/units.js';
import { instructionText } from '../nav/instructions.js';
import { isUturnStep, RouteModel } from '../nav/route-model.js';
import { $, choose, confirmDialog, esc, icon, saveTextFile, toast } from './dom.js';
import { maneuverIcon } from './icons.js';

let token = 0;

function sheetPadding() {
  if (window.innerWidth > window.innerHeight && window.innerHeight < 540) {
    return { top: 40, bottom: 40, left: Math.min(420, window.innerWidth * 0.5) + 30, right: 40 };
  }
  return { top: 70, bottom: Math.round(window.innerHeight * 0.62) + 20, left: 40, right: 40 };
}

function head(route, params, extra = '') {
  const name = params.hideName ? 'Mystery test route' : route.name;
  return `
    <div class="grabber"></div>
    <div class="sheet-head">
      <div class="preview-head">
        <button class="icon-btn" data-act="back" aria-label="Back">${icon('back')}</button>
        <h2>${esc(name)}</h2>
        ${extra}
      </div>
    </div>`;
}

function notesFor(app, route) {
  return [...(app.centre.hotspots || []), ...(route.notes || [])];
}

export async function enter(app, params) {
  const my = ++token;
  const sheet = $('#sheet');
  sheet.className = 'sheet';
  sheet.scrollTop = 0;
  const route = app.route(params.routeId);
  if (!route) {
    app.back();
    return;
  }
  sheet.onclick = (e) => {
    const a = e.target.closest('[data-act]');
    if (a?.dataset.act === 'back') app.back();
  };
  sheet.innerHTML = `${head(route, params)}
    <div class="card progress-line"><div class="spinner"></div><span id="prep-msg">Preparing route…</span></div>`;
  app.map.showOutline([]);

  let data;
  try {
    data = await app.compile(route, { onProgress: (m) => { const el = $('#prep-msg'); if (el) el.textContent = m; } });
  } catch (err) {
    if (my !== token) return;
    sheet.innerHTML = `${head(route, params)}
      <div class="note-box warn"><b>Couldn't prepare this route</b>${esc(err?.message || 'Unknown error')}.
      Routes are worked out online the first time, then saved on your phone for offline use.</div>
      <div class="actions"><button class="btn primary block" data-act="retry">Try again</button></div>`;
    sheet.onclick = (e) => {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      if (a.dataset.act === 'back') app.back();
      if (a.dataset.act === 'retry') enter(app, params);
    };
    return;
  }
  if (my !== token) return;
  render(app, route, data, params);
  if (params.autostart) {
    // Only once: coming back to this screen shouldn't start the drive again.
    const mode = params.autostart;
    delete params.autostart;
    app.show('navigate', { routeId: route.id, simulate: mode === 'sim', mock: !!params.mock });
  }
}

function render(app, route, data, params) {
  const sheet = $('#sheet');
  const model = new RouteModel(data);
  const notes = notesFor(app, route);
  app.map.showRoute(model, { notes });
  app.map.fit(model.coords, sheetPadding());

  const units = app.settings.units;
  const roundabouts = model.steps.filter((s) => ['roundabout', 'rotary', 'roundabout turn'].includes(s.type)).length;
  const maxLimit = (data.speedLimits || []).reduce((m, r) => Math.max(m, r.mph || 0), 0);
  const hist = getHistory(app.centre.id, route.id);
  const hide = !!params.hideName;
  const uturns = model.steps.filter(isUturnStep).length;

  const steps = model.announced.map((s, i) => {
    const prev = i === 0 ? 0 : model.announced[i - 1].along;
    return `<li>${maneuverIcon(s)}<span>${esc(instructionText(s, { destination: route.destinationName || app.centre.destinationName || 'the test centre' }))}</span>
      <span class="d">${displayDistanceText(s.along - prev, units)}</span></li>`;
  }).join('');

  const noteItems = (route.notes || []).concat(app.centre.hotspots || [])
    .map((n) => `<div class="note-box"><b>${esc(n.title || 'Tip')}</b>${esc(n.text)}</div>`)
    .concat((app.centre.tips || []).map((t) => `<div class="note-box">${esc(t)}</div>`))
    .join('');

  sheet.innerHTML = `${head(route, params, `<button class="icon-btn" data-act="menu" aria-label="More">${icon('edit')}</button>`)}
    <div class="stats">
      <div class="stat"><div class="v">${displayDistanceText(model.length, units)}</div><div class="k">distance</div></div>
      <div class="stat"><div class="v">${formatDuration(data.duration * 1.15)}</div><div class="k">about</div></div>
      <div class="stat"><div class="v">${roundabouts}</div><div class="k">roundabouts</div></div>
      <div class="stat"><div class="v">${maxLimit || '–'}</div><div class="k">top limit</div></div>
    </div>
    ${uturns ? '' : `<p class="check-line">${icon('check')}<span>No U-turns</span></p>`}
    ${(data.warnings || []).map((w) => `<div class="note-box warn"><b>Check this route</b>${esc(w)}</div>`).join('')}
    <div class="actions">
      <button class="btn go block" data-act="drive">${icon('play')} Start route</button>
      <div class="row-btns">
        <button class="btn secondary" data-act="sim">${icon('sim')} Practice at home</button>
        ${hide ? '' : `<button class="btn secondary" data-act="steps">${icon('route')} Directions</button>`}
      </div>
    </div>
    ${hide ? '<p class="desc">The route is hidden for the mock test. Start when you are ready.</p>' : `
    ${route.description ? `<p class="desc">${esc(route.description)}</p>` : ''}
    ${hist?.count ? `<p class="desc">You've driven this route ${hist.count} time${hist.count > 1 ? 's' : ''}${hist.completed ? `, finishing ${hist.completed}` : ''}.</p>` : ''}
    ${noteItems ? `<div class="section-title"><span>Tips for this area</span></div>${noteItems}` : ''}
    <div class="section-title" id="steps"><span>Turn-by-turn</span><span>${model.announced.length} steps</span></div>
    <div class="card"><ul class="steps-list">${steps}</ul></div>`}
  `;

  sheet.onclick = async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'back') app.back();
    else if (act === 'drive' || act === 'sim') {
      // Speak straight away, inside the tap, so iOS lets the voice play (and you know it works).
      if (app.voice.enabled) app.voice.prime(act === 'sim' ? 'Starting practice drive.' : 'Starting route.');
      app.show('navigate', { routeId: route.id, simulate: act === 'sim', mock: !!params.mock });
    }
    else if (act === 'steps') $('#steps')?.scrollIntoView({ behavior: 'smooth' });
    else if (act === 'menu') menu(app, route, data, params);
  };
}

async function menu(app, route, data, params) {
  const buttons = [
    { label: 'Recalculate route', value: 'recalc' },
    { label: route.custom ? 'Edit route' : 'Edit a copy', value: 'edit' },
    { label: 'Share route file', value: 'export' },
    route.custom
      ? { label: 'Delete route', value: 'delete', kind: 'danger' }
      : { label: 'Hide from list', value: 'hide' },
    { label: 'Cancel', value: null },
  ];
  const v = await choose({ title: route.name, buttons });
  if (v === 'recalc') {
    app.compiled.delete(route.id);
    try {
      toast('Recalculating…');
      const fresh = await app.compile(route, { force: true });
      render(app, route, fresh, params);
      toast('Route updated');
    } catch (err) {
      toast(`Couldn't recalculate: ${err.message}`);
    }
  } else if (v === 'edit') {
    app.show('editor', { routeId: route.id, copy: !route.custom });
  } else if (v === 'export') {
    const { custom, builtIn, hidden, ...def } = route;
    void custom; void builtIn; void hidden;
    await saveTextFile(`${route.id}.json`, JSON.stringify({ app: 'driving-test-routes', version: 1, customCentres: [], customRoutes: { [app.centre.id]: [{ ...def, id: `${def.id}` }] } }, null, 2));
  } else if (v === 'hide') {
    setRouteHidden(app.centre.id, route.id, true);
    toast('Route hidden. You can show it again in Settings.');
    app.goHome();
  } else if (v === 'delete') {
    if (await confirmDialog('Delete route?', `"${route.name}" will be removed from this phone.`, 'Delete', 'danger')) {
      deleteCustomRoute(app.centre.id, route.id);
      app.goHome();
    }
  }
}

export function leave() {
  token++;
  $('#sheet').onclick = null;
}
