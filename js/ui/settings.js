// Settings page.

import { exportData, getHiddenRoutes, importData, resetAll, setRouteHidden } from '../lib/storage.js';
import { idbClear } from '../lib/idb.js';
import { downloadArea, requestPersistentStorage, storageEstimate } from '../services/offline.js';
import { STYLES } from './map.js';
import { $, choose, confirmDialog, esc, icon, pickTextFile, saveTextFile, toast } from './dom.js';
import { APP_VERSION } from '../version.js';

export const fullscreen = true;

function seg(name, value, options) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, label]) => `<button data-v="${v}" class="${String(v) === String(value) ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
}

function toggle(name, checked) {
  return `<input type="checkbox" class="switch" data-set="${name}" ${checked ? 'checked' : ''}>`;
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(bytes > 1e8 ? 0 : 1)} MB`;
}

export function enter(app) {
  const page = $('#page');
  page.hidden = false;
  render(app);
}

function render(app) {
  const s = app.settings;
  const page = $('#page');
  const voices = app.voice.list();
  const hidden = app.centre ? getHiddenRoutes(app.centre.id) : [];
  const hiddenRoutes = app.routes({ includeHidden: true }).filter((r) => hidden.includes(r.id));

  page.innerHTML = `
    <div class="page-head">
      <button class="icon-btn" data-act="back" aria-label="Back">${icon('back')}</button>
      <h2>Settings</h2>
    </div>

    <div class="group-title">Voice directions</div>
    <div class="group">
      <div class="row"><div class="label"><div class="t">Spoken directions</div></div>${toggle('voice', s.voice)}</div>
      <div class="row">
        <div class="label"><div class="t">Direction style</div><div class="s">Sat nav says "In 200 yards, turn left". Examiner says "Take the next road on the left".</div></div>
        ${seg('voiceStyle', s.voiceStyle, [['satnav', 'Sat nav'], ['examiner', 'Examiner']])}
      </div>
      <div class="row">
        <div class="label"><div class="t">Voice</div></div>
        <select data-set="voiceName">
          <option value="">Automatic (British)</option>
          ${voices.map((v) => `<option value="${esc(v.name)}" ${v.name === s.voiceName ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}
        </select>
      </div>
      <div class="row">
        <div class="label"><div class="t">Speaking speed</div></div>
        <input type="range" min="0.7" max="1.3" step="0.05" value="${s.voiceRate}" data-set="voiceRate">
      </div>
      <button class="row" data-act="testvoice"><div class="label"><div class="t" style="color:var(--accent)">Test voice</div></div></button>
      <div class="row"><div class="label"><div class="t">Read out area tips</div><div class="s">e.g. busy roundabouts and tram crossings</div></div>${toggle('spokenNotes', s.spokenNotes)}</div>
    </div>

    <div class="group-title">Driving</div>
    <div class="group">
      <div class="row"><div class="label"><div class="t">Keep screen on</div><div class="s">While a route is running</div></div>${toggle('keepAwake', s.keepAwake)}</div>
      <div class="row"><div class="label"><div class="t">Speed limit warnings</div><div class="s">Uses OpenStreetMap limits, which can be missing or out of date</div></div>${toggle('speedWarnings', s.speedWarnings)}</div>
      <div class="row"><div class="label"><div class="t">Warn when over by</div></div>${seg('speedTolerance', s.speedTolerance, [[0, '0'], [2, '2'], [5, '5 mph']])}</div>
      <div class="row"><div class="label"><div class="t">Reroute automatically</div><div class="s">Finds a way back onto the test route if you go wrong</div></div>${toggle('autoReroute', s.autoReroute)}</div>
      <div class="row"><div class="label"><div class="t">Units</div></div>${seg('units', s.units, [['imperial', 'Miles'], ['metric', 'Km']])}</div>
    </div>

    <div class="group-title">Map</div>
    <div class="group">
      <div class="row"><div class="label"><div class="t">Map colours</div></div>${seg('mapTheme', s.mapTheme, [['auto', 'Auto'], ['light', 'Day'], ['dark', 'Night']])}</div>
      <div class="row"><div class="label"><div class="t">3D view while driving</div></div>${toggle('mapPitch', s.mapPitch)}</div>
    </div>
    <p class="group-note">Auto switches to the night map after sunset.</p>

    <div class="group-title">Offline</div>
    <div class="group">
      <button class="row" data-act="offline">
        <div class="label"><div class="t">Download map for ${esc(app.centre?.name || 'this area')}</div>
        <div class="s" id="offline-status">About 8 km around the test centre, so the map works with no signal</div>
        <div class="progress" id="offline-progress" hidden><div></div></div></div>
        ${icon('download')}
      </button>
      <button class="row" data-act="prepare">
        <div class="label"><div class="t">Prepare all routes offline</div><div class="s" id="prepare-status">Works out and saves every route on this phone</div></div>
        ${icon('refresh')}
      </button>
      <div class="row"><div class="label"><div class="t">Storage used</div></div><div class="val" id="storage-used">…</div></div>
    </div>

    ${hiddenRoutes.length ? `
    <div class="group-title">Hidden routes</div>
    <div class="group">
      ${hiddenRoutes.map((r) => `<button class="row" data-unhide="${esc(r.id)}"><div class="label"><div class="t">${esc(r.name)}</div></div><span class="val">Show</span></button>`).join('')}
    </div>` : ''}

    <div class="group-title">Your data</div>
    <div class="group">
      <button class="row" data-act="export"><div class="label"><div class="t">Back up routes and centres</div><div class="s">Save a file you can import on another phone</div></div>${icon('upload')}</button>
      <button class="row" data-act="import"><div class="label"><div class="t">Import a file</div><div class="s">A backup, or a test centre file</div></div>${icon('download')}</button>
      <button class="row" data-act="clearcache"><div class="label"><div class="t">Clear saved routes</div><div class="s">They'll be worked out again next time</div></div></button>
      <button class="row" data-act="reset"><div class="label"><div class="t" style="color:var(--danger)">Reset everything</div></div></button>
    </div>

    <div class="about">
      <p><b>Test Routes ${APP_VERSION}</b>. A practice aid for learner drivers. Routes are based on roads commonly reported around each test centre; DVSA doesn't publish test routes, so yours may differ.</p>
      <p>Only use this with a qualified supervisor, set it up before you drive, and mount your phone. Always follow road signs, markings, the police and your examiner over the app.</p>
      <p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. Map tiles by <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>. Routing by <a href="https://project-osrm.org" target="_blank" rel="noopener">OSRM</a> and <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noopener">Valhalla</a> (FOSSGIS). Map display by MapLibre.</p>
    </div>`;

  storageEstimate().then((e) => {
    const el = $('#storage-used');
    if (el) el.textContent = e ? mb(e.usage) : 'Unknown';
  });

  page.onchange = (e) => {
    const t = e.target.closest('[data-set]');
    if (!t) return;
    const key = t.dataset.set;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (key === 'voiceRate') v = Number(v);
    if (key === 'voiceName') v = v || null;
    app.updateSettings({ [key]: v });
  };

  page.onclick = async (e) => {
    const segBtn = e.target.closest('[data-seg] button');
    if (segBtn) {
      const name = segBtn.parentElement.dataset.seg;
      let v = segBtn.dataset.v;
      if (name === 'speedTolerance') v = Number(v);
      app.updateSettings({ [name]: v });
      segBtn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === segBtn));
      return;
    }
    const unhide = e.target.closest('[data-unhide]');
    if (unhide) {
      setRouteHidden(app.centre.id, unhide.dataset.unhide, false);
      render(app);
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'back') app.back();
    else if (act === 'testvoice') app.voice.say('In 200 yards, at the roundabout, take the third exit onto the A 52, Brian Clough Way.', { priority: 'high' });
    else if (act === 'offline') downloadOffline(app);
    else if (act === 'prepare') prepareAll(app);
    else if (act === 'export') {
      await saveTextFile(`test-routes-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportData(), null, 2));
    } else if (act === 'import') {
      const text = await pickTextFile();
      if (!text) return;
      try {
        const n = importData(JSON.parse(text));
        app.refreshCentre();
        toast(`Imported ${n} item${n === 1 ? '' : 's'}`);
        render(app);
      } catch (err) {
        toast(`Couldn't import: ${err.message}`);
      }
    } else if (act === 'clearcache') {
      if (await confirmDialog('Clear saved routes?', 'Routes will be worked out again when you next open them (needs signal).', 'Clear')) {
        await idbClear('routes');
        app.compiled.clear();
        toast('Saved routes cleared');
      }
    } else if (act === 'reset') {
      if (await confirmDialog('Reset everything?', 'This removes your routes, centres, history and settings from this phone.', 'Reset', 'danger')) {
        resetAll();
        await idbClear('routes');
        location.reload();
      }
    }
  };
}

let downloading = false;

async function downloadOffline(app) {
  if (downloading || !app.centre) return;
  downloading = true;
  const status = $('#offline-status');
  const bar = $('#offline-progress');
  bar.hidden = false;
  try {
    await requestPersistentStorage();
    const res = await downloadArea([STYLES.light, STYLES.dark], app.centre.location, 8, (done, total) => {
      if (status) status.textContent = `Downloading… ${done} of ${total}`;
      if (bar) bar.firstElementChild.style.width = `${Math.round((done / total) * 100)}%`;
    });
    if (status) status.textContent = res.failed ? `Done, but ${res.failed} items failed. Try again with better signal.` : 'Map saved for offline use';
    const e = await storageEstimate();
    const el = $('#storage-used');
    if (el && e) el.textContent = mb(e.usage);
  } catch (err) {
    if (status) status.textContent = `Download failed: ${err.message}`;
  } finally {
    downloading = false;
  }
}

async function prepareAll(app) {
  const status = $('#prepare-status');
  const routes = app.routes();
  let ok = 0;
  for (let i = 0; i < routes.length; i++) {
    if (status) status.textContent = `Preparing ${i + 1} of ${routes.length}: ${routes[i].name}`;
    try {
      await app.compile(routes[i]);
      ok++;
    } catch (err) {
      console.warn(err);
    }
  }
  if (status) status.textContent = `${ok} of ${routes.length} routes ready offline`;
  if (ok < routes.length) {
    await choose({ title: 'Some routes need signal', message: 'Try again when you have a good connection.', buttons: [{ label: 'OK', value: 1, kind: 'primary' }] });
  }
}

export function leave() {
  const page = $('#page');
  page.onclick = null;
  page.onchange = null;
  page.hidden = true;
}
