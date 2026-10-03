// Record a drive (e.g. a mock test route with an instructor) and save it as a route.

import { GeoSource } from '../device/gps.js';
import { bearing, angleDiff, cumulativeDistances, distance, pointAlong, simplifyIndices } from '../lib/geo.js';
import { saveCustomRoute } from '../lib/storage.js';
import { displayDistanceText, mph } from '../lib/units.js';
import { newId } from '../services/centres.js';
import { $, choose, confirmDialog, icon, promptDialog, toast } from './dom.js';

export const fullscreen = true;

let R = null;

/**
 * Turn a GPS track into route waypoints: roughly every `spacing` metres,
 * nudged away from junctions (where the track changes direction), each with
 * the direction of travel so the router uses the right side of the road.
 */
export function waypointsFromTrack(track, spacing = 320) {
  if (track.length < 2) return [];
  const idx = simplifyIndices(track, 4);
  const coords = idx.map((i) => track[i]);
  const cum = cumulativeDistances(coords);
  const total = cum[cum.length - 1];
  const out = [];
  const headingAt = (d) => bearing(pointAlong(coords, cum, Math.max(0, d - 25)).point, pointAlong(coords, cum, Math.min(total, d + 25)).point);
  for (let d = spacing; d < total - spacing * 0.5; d += spacing) {
    let at = d;
    for (let k = 0; k < 4; k++) {
      const before = bearing(pointAlong(coords, cum, Math.max(0, at - 35)).point, pointAlong(coords, cum, at).point);
      const after = bearing(pointAlong(coords, cum, at).point, pointAlong(coords, cum, Math.min(total, at + 35)).point);
      if (Math.abs(angleDiff(before, after)) < 25) break;
      at += 45;
    }
    if (at >= total - 40) break;
    const p = pointAlong(coords, cum, at).point;
    out.push({ at: [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))], bearing: Math.round(headingAt(at)) });
  }
  return out;
}

export function enter(app) {
  R = { app, track: [], startedAt: Date.now(), lastFix: null, source: new GeoSource() };
  const nav = $('#nav');
  nav.hidden = false;
  nav.innerHTML = `
    <div class="banner-wrap hit">
      <div class="banner idle">
        <div class="icon">${icon('record')}</div>
        <div>
          <div class="dist" id="rc-dist">0<small>mi</small></div>
          <div class="text">Recording your drive</div>
          <div class="sub" id="rc-sub">Waiting for GPS…</div>
        </div>
      </div>
    </div>
    <div class="bottom-bar hit">
      <div class="speedo"><div class="v" id="rc-speed">–</div><div class="u">mph</div></div>
      <div class="eta"><div class="big" id="rc-time">0:00</div><div class="small">Drive the route, then tap Stop</div></div>
      <button class="end-btn" id="rc-stop" style="background:var(--accent)">Stop</button>
    </div>`;
  app.map.clearRoute();
  app.map.showOutline([]);
  app.map.setTrack([]);
  if (app.settings.keepAwake) app.wake.enable();
  R.source.on('fix', onFix);
  R.source.on('error', (err) => {
    if (err?.code === 1) toast('Location access is needed to record a drive.');
  });
  R.source.start();
  R.timer = setInterval(tickClock, 1000);
  $('#rc-stop').onclick = stop;
}

function tickClock() {
  if (!R) return;
  const s = Math.round((Date.now() - R.startedAt) / 1000);
  const el = $('#rc-time');
  if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function onFix(fix) {
  if (!R) return;
  const app = R.app;
  const p = [fix.lon, fix.lat];
  $('#rc-speed').textContent = fix.speed != null ? String(Math.round(mph(fix.speed))) : '–';
  $('#rc-sub').textContent = `GPS accuracy ±${Math.round(fix.accuracy)} m`;
  if (fix.accuracy <= 35) {
    const last = R.track[R.track.length - 1];
    if (!last || distance(last, p) >= 8) {
      R.track.push(p);
      app.map.setTrack(R.track);
      const total = cumulativeDistances(R.track).pop() || 0;
      const el = $('#rc-dist');
      const t = displayDistanceText(total, app.settings.units).split(' ');
      if (el) el.innerHTML = `${t[0]}<small>${t[1]}</small>`;
    }
  }
  app.map.setPuck(p, fix.heading ?? 0);
  app.map.follow({ center: p, bearing: 0, zoom: 16, pitch: 0, padding: { top: 120, bottom: 120, left: 0, right: 0 } });
}

async function stop() {
  if (!R) return;
  const app = R.app;
  const total = R.track.length > 1 ? cumulativeDistances(R.track).pop() : 0;
  if (total < 800) {
    const v = await confirmDialog('Stop recording?', 'This drive is too short to save as a route.', 'Stop', 'danger');
    if (v) app.back();
    return;
  }
  R.source.stop();
  const name = await promptDialog('Save this drive as a route', { value: `Recorded drive ${new Date().toLocaleDateString('en-GB')}`, okLabel: 'Save route' });
  if (!name) {
    const discard = await choose({ title: 'Discard this recording?', buttons: [{ label: 'Discard', value: true, kind: 'danger' }, { label: 'Keep recording', value: false }] });
    if (discard) app.back();
    else R.source.start();
    return;
  }
  const centre = app.centre;
  const first = R.track[0];
  const last = R.track[R.track.length - 1];
  const route = {
    id: newId('route'),
    name,
    description: `Recorded on ${new Date().toLocaleString('en-GB')}.`,
    tags: ['Recorded'],
    waypoints: waypointsFromTrack(R.track),
  };
  if (distance(first, centre.location) > 300) route.start = [Number(first[0].toFixed(6)), Number(first[1].toFixed(6))];
  if (distance(last, centre.location) > 300) route.end = [Number(last[0].toFixed(6)), Number(last[1].toFixed(6))];
  saveCustomRoute(centre.id, route);
  toast('Route saved');
  app.history = [];
  app.show('preview', { routeId: route.id }, { replace: true });
}

export function leave(app) {
  if (R) {
    clearInterval(R.timer);
    R.source.stop();
  }
  R = null;
  app.wake.disable();
  app.map.setTrack([]);
  app.map.hidePuck();
  const nav = $('#nav');
  nav.innerHTML = '';
  nav.hidden = true;
}
