// Choose, add and remove test centres.

import { GeoSource } from '../device/gps.js';
import { deleteCustomCentre, saveCustomCentre } from '../lib/storage.js';
import { allCentres, newId, routesFor } from '../services/centres.js';
import { reverseGeocode, searchPlaces } from '../services/geocode.js';
import { $, confirmDialog, esc, icon, promptDialog, toast } from './dom.js';

export const fullscreen = true;

export function enter(app) {
  $('#page').hidden = false;
  render(app);
}

function render(app, results = null, searching = false) {
  const page = $('#page');
  const centres = allCentres();
  page.innerHTML = `
    <div class="page-head">
      <button class="icon-btn" data-act="back" aria-label="Back">${icon('back')}</button>
      <h2>Test centres</h2>
    </div>
    <div class="group-title">Your test centre</div>
    <div class="group">
      ${centres.map((c) => `
        <button class="row ${app.centre?.id === c.id ? 'active' : ''}" data-centre="${esc(c.id)}">
          <span class="radio"></span>
          <div class="label"><div class="t">${esc(c.name)}</div>
          <div class="s">${esc(c.address || '')}${c.address ? ' · ' : ''}${routesFor(c).length} route${routesFor(c).length === 1 ? '' : 's'}${c.custom ? ' · added by you' : ''}</div></div>
          ${c.custom ? `<span class="icon-btn" data-del="${esc(c.id)}" aria-label="Delete">${icon('trash')}</span>` : ''}
        </button>`).join('')}
    </div>
    <p class="group-note">Switching centre keeps all your routes. Each centre has its own list.</p>

    <div class="group-title">Add a test centre</div>
    <form class="field" id="search-form">
      <label for="centre-q">Search by name, street or postcode</label>
      <input id="centre-q" type="search" placeholder="e.g. Colwick driving test centre" autocomplete="off" value="${esc(results?.q || '')}">
    </form>
    ${searching ? '<div class="card progress-line"><div class="spinner"></div>Searching…</div>' : ''}
    ${results ? `<div class="group"><ul class="result-list">
      ${results.items.length ? results.items.map((r, i) => `<li><button data-pick="${i}"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.label)}</div></button></li>`).join('') : '<li class="empty">No places found. Try a postcode.</li>'}
    </ul></div>` : ''}
    <div class="actions">
      <button class="btn secondary block" data-act="here">${icon('locate')} Use where I am now</button>
    </div>
    <p class="group-note">New centres start with no routes. Add some by tapping roads on the map, recording a drive with your instructor, importing a file, or letting the app make a practice loop around the centre.</p>`;

  const form = $('#search-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = $('#centre-q').value.trim();
    if (!q) return;
    render(app, { q, items: [] }, true);
    try {
      const items = await searchPlaces(q);
      render(app, { q, items });
    } catch (err) {
      render(app, { q, items: [] });
      toast(`Search failed: ${err.message}`);
    }
  };

  page.onclick = async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const c = centres.find((x) => x.id === del.dataset.del);
      if (c && await confirmDialog('Remove test centre?', `"${c.name}" and its routes will be removed from this phone.`, 'Remove', 'danger')) {
        deleteCustomCentre(c.id);
        if (app.centre?.id === c.id) app.setCentre(allCentres()[0]?.id);
        render(app);
      }
      return;
    }
    const pick = e.target.closest('[data-centre]');
    if (pick) {
      app.setCentre(pick.dataset.centre);
      app.goHome();
      return;
    }
    const res = e.target.closest('[data-pick]');
    if (res && results) {
      const r = results.items[Number(res.dataset.pick)];
      await addCentre(app, r.name, r.location, r.label);
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'back') app.back();
    if (a.dataset.act === 'here') {
      try {
        toast('Finding your location…');
        const fix = await GeoSource.current();
        let label = '';
        try { label = await reverseGeocode(fix.lon, fix.lat); } catch { /* optional */ }
        await addCentre(app, '', [fix.lon, fix.lat], label);
      } catch (err) {
        toast(`Couldn't get your location: ${err.message}`);
      }
    }
  };
}

async function addCentre(app, name, location, address) {
  const finalName = await promptDialog('Name this test centre', { value: name.replace(/driving test centre/i, '').trim() || name, placeholder: 'e.g. Nottingham (Colwick)', okLabel: 'Add centre' });
  if (!finalName) return;
  const centre = {
    id: newId('centre'),
    name: finalName,
    address: address || '',
    location: [Number(location[0].toFixed(6)), Number(location[1].toFixed(6))],
    destinationName: 'the test centre',
    routes: [],
    hotspots: [],
    custom: true,
  };
  saveCustomCentre(centre);
  app.setCentre(centre.id);
  toast(`${finalName} added`);
  app.goHome();
}

export function leave() {
  const page = $('#page');
  page.onclick = null;
  page.hidden = true;
}
