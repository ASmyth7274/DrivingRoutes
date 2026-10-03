// Turn-by-turn navigation screen.

import { GeoSource, Simulator } from '../device/gps.js';
import { angleDiff, distance, lerpBearing } from '../lib/geo.js';
import { recordDrive } from '../lib/storage.js';
import { displayDistance, formatClock, formatDuration, mph, spokenDistance } from '../lib/units.js';
import { instructionText, lowerFirst } from '../nav/instructions.js';
import { NavSession } from '../nav/session.js';
import { route as routeRequest } from '../services/router.js';
import { fetchSpeedLimits } from '../services/speedlimits.js';
import { $, choose, confirmDialog, icon, toast } from './dom.js';
import { directionArrow, lanesHtml, maneuverIcon } from './icons.js';

export const fullscreen = true;

let S = null;

const MOCK_INTRO = "This is a mock driving test. I'd like you to follow the road ahead at all times, unless traffic signs direct you otherwise, or I ask you to turn.";
const MOCK_INDEPENDENT = "For the next part of the test, I'd like you to follow the sat nav directions until I tell you otherwise. If you go the wrong way, don't worry, the sat nav will get you back on track.";
const MOCK_BACK = 'Thank you. You can stop following the sat nav now. I will give you directions from here.';

function el(id) {
  return document.getElementById(id);
}

function buildDom(sim) {
  const nav = $('#nav');
  nav.innerHTML = `
    <div class="banner-wrap hit" id="nv-bannerwrap">
      <div class="banner" id="nv-banner" role="button" aria-label="Repeat the last direction">
        <div class="icon" id="nv-icon"></div>
        <div>
          <div class="dist" id="nv-dist"></div>
          <div class="text" id="nv-text">Waiting for GPS…</div>
          <div class="sub" id="nv-sub"></div>
        </div>
        <div class="lanes" id="nv-lanes"></div>
      </div>
      <div class="then" id="nv-then" hidden></div>
    </div>
    <div class="status-pill hit" id="nv-status" hidden></div>
    <div class="fabs hit">
      <button class="fab" id="nv-mute" aria-label="Mute voice">${icon('volume')}</button>
      <button class="fab" id="nv-view" aria-label="Show whole route">${icon('overview')}</button>
    </div>
    ${sim ? `
    <div class="sim-bar hit">
      <button class="pill-btn" id="nv-sim-pause">${icon('pause')}<span>Pause</span></button>
      <button class="pill-btn" id="nv-sim-speed">${icon('sim')}<span>1×</span></button>
      <button class="pill-btn warn" id="nv-sim-wrong">${icon('wrong')}<span>Wrong turn</span></button>
    </div>` : ''}
    <div class="bottom-bar hit" id="nv-bottom">
      <div class="speedo" id="nv-speedo"><div class="v" id="nv-speed">–</div><div class="u">mph</div></div>
      <div class="limit" id="nv-limit" hidden></div>
      <div class="eta">
        <div class="big" id="nv-eta">--:--</div>
        <div class="small" id="nv-remain"></div>
        <div class="tiny" id="nv-awake"></div>
      </div>
      <button class="end-btn" id="nv-end">End</button>
    </div>`;
  nav.hidden = false;
}

function setText(id, value) {
  const e = el(id);
  if (e && e.textContent !== value) e.textContent = value;
}

function setHtml(id, value) {
  const e = el(id);
  if (e && e._html !== value) {
    e.innerHTML = value;
    e._html = value;
  }
}

function measure() {
  const b = el('nv-bannerwrap');
  const bottom = el('nv-bottom');
  const root = document.documentElement;
  if (b) root.style.setProperty('--banner-h', `${b.getBoundingClientRect().height}px`);
  if (bottom) root.style.setProperty('--bottom-h', `${bottom.getBoundingClientRect().height}px`);
}

function landscape() {
  return window.innerWidth > window.innerHeight && window.innerHeight < 540;
}

function followPadding() {
  const h = window.innerHeight;
  const bottomH = el('nv-bottom')?.getBoundingClientRect().height || 100;
  if (landscape()) {
    const w = el('nv-bannerwrap')?.getBoundingClientRect().width || 360;
    return { top: Math.round(h * 0.42), bottom: 10, left: Math.round(w), right: 10 };
  }
  return { top: Math.round(h * 0.44 + bottomH * 0.6), bottom: Math.round(bottomH), left: 0, right: 0 };
}

function speakWrapper(app) {
  return (text, opts) => {
    if (!S) return;
    S.lastSpoken = text;
    S.lastSpokenAt = Date.now();
    app.voice.say(text, opts);
  };
}

export async function enter(app, params) {
  const route = app.route(params.routeId);
  if (!route) {
    app.goHome();
    return;
  }
  let data;
  try {
    data = await app.compile(route);
  } catch (err) {
    toast(`Couldn't load the route: ${err.message}`);
    app.back();
    return;
  }
  const centre = app.centre;
  const destination = centre.destinationName || 'the test centre';
  const notes = [...(centre.hotspots || []), ...(route.notes || [])];
  const mock = !!params.mock;

  S = {
    app,
    route,
    params,
    mock,
    simulate: !!params.simulate,
    follow: true,
    overview: false,
    snap: null,
    snapAt: 0,
    disp: { along: 0, point: null, bearing: 0, zoom: 16.5, version: 0, raw: null },
    lastProgressDraw: 0,
    lastArrowStep: null,
    startedAt: Date.now(),
    totalDuration: data.duration,
    phase: mock ? 'examiner' : null,
    firstFix: true,
    ended: false,
  };

  const session = new NavSession({
    data,
    rerouter: (points, opts) => routeRequest(points, opts),
    speak: speakWrapper(app),
    settings: {
      voiceStyle: mock ? 'examiner' : app.settings.voiceStyle,
      units: app.settings.units,
      speedWarnings: app.settings.speedWarnings,
      speedTolerance: app.settings.speedTolerance,
      spokenNotes: app.settings.spokenNotes && !mock,
      autoReroute: app.settings.autoReroute,
    },
    notes,
    destination,
  });
  S.session = session;

  buildDom(S.simulate);
  app.map.showOutline([]);
  app.map.showRoute(session.model, { notes });
  app.map.setNotes(notes);
  requestAnimationFrame(measure);

  if (app.settings.keepAwake) app.wake.enable();
  S.offWake = app.wake.on('change', () => renderAwake());
  renderAwake();

  session.on('update', (snap) => {
    S.snap = snap;
    S.snapAt = performance.now();
    if (S.mock) mockPhases(snap);
    renderPanel(snap);
  });
  session.on('rerouted', () => {
    app.map.showRoute(session.model, { notes });
    app.map.setNotes(notes);
    S.lastArrowStep = null;
    toast('New route found', { top: true, ms: 2000 });
    // New routes arrive without speed limits; fetch them in the background.
    const model = session.model;
    fetchSpeedLimits(model.coords)
      .then((ranges) => { if (ranges && S?.session.model === model) model.setSpeedLimits(ranges); })
      .catch(() => {});
  });
  session.on('offroute', () => {
    if (!app.settings.autoReroute) toast('Off route – head back to the blue line', { top: true });
  });
  session.on('note', (n) => toast(n.text, { top: true, ms: 7000 }));
  session.on('arrived', () => onArrived());

  const source = S.simulate
    ? new Simulator(() => S?.session.model, { speedFactor: app.settings.simSpeed || 1 })
    : new GeoSource();
  S.source = source;
  source.on('fix', (fix) => onFix(fix));
  source.on('error', (err) => onGpsError(err));

  if (mock) speakWrapper(app)(MOCK_INTRO, { priority: 'high' });
  source.start();
  bindControls();
  app.map.on('usermove', S.onUserMove = () => {
    if (!S || S.ended) return;
    S.follow = false;
    S.overview = false;
    updateViewButton();
    clearTimeout(S.refollow);
    S.refollow = setTimeout(() => { if (S) { S.follow = true; updateViewButton(); } }, 12000);
  });
  S.raf = requestAnimationFrame(frame);
  S.onResize = () => { measure(); };
  window.addEventListener('resize', S.onResize);
}

async function onFix(fix) {
  if (!S || S.ended) return;
  if (S.firstFix) {
    S.firstFix = false;
    if (!S.simulate) {
      const d = S.session.distanceToStart([fix.lon, fix.lat]);
      const near = S.session.tracker.match([fix.lon, fix.lat], 0, S.session.model.length, null, null);
      if (d > 250 && (!near || near.distance > 60)) {
        S.session.handleFix(fix);
        const miles = spokenDistance(d, S.app.settings.units);
        const v = await choose({
          title: 'You are away from the route',
          message: `The start of this route is ${miles} away.`,
          buttons: [
            { label: 'Drive to the start, then do the route', value: 'start', kind: 'primary' },
            { label: 'Join the route nearest to me', value: 'nearest' },
            { label: 'Just show the route', value: 'none' },
          ],
        });
        if (!S || S.ended) return;
        if (v === 'start' || v === 'nearest') {
          const last = S.session.lastFix || fix;
          const ok = await S.session.reroute(last, v);
          if (!ok) toast("Couldn't plan a route from here. Check your signal.");
        }
        return;
      }
    }
  }
  S.session.handleFix(fix);
}

function onGpsError(err) {
  if (!S) return;
  if (err?.code === 1) {
    choose({
      title: 'Location is switched off',
      message: 'Directions need your location. On iPhone go to Settings › Privacy & Security › Location Services, turn it on and allow Safari Websites "While Using the App", then come back.',
      buttons: [{ label: 'OK', value: true, kind: 'primary' }],
    });
  } else {
    setText('nv-sub', 'Searching for GPS signal…');
  }
}

function mockPhases(snap) {
  const total = S.totalDuration || 1;
  const done = 1 - Math.min(1, snap.remainingDuration / total);
  const say = speakWrapper(S.app);
  if (S.phase === 'examiner' && done > 0.22 && done < 0.6 && snap.status === 'on') {
    S.phase = 'independent';
    S.session.setSettings({ voiceStyle: 'satnav' });
    say(MOCK_INDEPENDENT, { priority: 'high' });
  } else if (S.phase === 'independent' && done >= 0.75 && snap.status === 'on') {
    S.phase = 'final';
    S.session.setSettings({ voiceStyle: 'examiner' });
    say(MOCK_BACK);
  }
}

function renderAwake() {
  if (!S) return;
  const mode = S.app.wake.mode;
  setHtml('nv-awake', mode === 'off'
    ? `${icon('sun')}<span>Screen may sleep – tap here</span>`
    : `${icon('sun')}<span>Screen stays on</span>`);
}

function bannerFor(snap) {
  const app = S.app;
  const units = app.settings.units;
  const dest = app.centre.destinationName || 'the test centre';
  const heading = S.disp.bearing || 0;
  const examinerPhase = S.session.settings.voiceStyle === 'examiner';
  if (snap.status === 'approach' && snap.target && snap.target.distance > 35) {
    const d = displayDistance(snap.target.distance, units);
    return {
      cls: 'idle',
      icon: directionArrow(angleDiff(heading, snap.target.bearing)),
      dist: `${d.value}<small>${d.unit}</small>`,
      text: 'Head to the start of the route',
      sub: 'Guidance starts when you reach the blue line',
    };
  }
  if (snap.status === 'off' || snap.status === 'rerouting') {
    const t = snap.target;
    const d = t ? displayDistance(t.distance, units) : null;
    return {
      cls: 'off',
      icon: t ? directionArrow(angleDiff(heading, t.bearing)) : '',
      dist: d ? `${d.value}<small>${d.unit}</small>` : '',
      text: snap.status === 'rerouting' ? 'Finding a way back…' : 'Off route',
      sub: snap.status === 'rerouting' ? '' : (S.app.settings.autoReroute ? 'No connection for a new route. Head back to the blue line.' : 'Head back to the blue line'),
    };
  }
  if (snap.status === 'arrived') {
    return { cls: '', icon: maneuverIcon({ type: 'arrive' }), dist: '', text: `You've arrived at ${dest}`, sub: '' };
  }
  const next = snap.next;
  if (!next) return { cls: '', icon: maneuverIcon(null), dist: '', text: 'Follow the road', sub: '' };
  const dist = snap.nextDistance ?? (next.along - snap.along);
  const d = displayDistance(dist, units);
  if (S.mock && examinerPhase) {
    // On a real test there's no screen to read: show what the examiner said.
    const recent = S.lastSpoken && Date.now() - S.lastSpokenAt < 25000 ? S.lastSpoken : 'Follow the road ahead unless signs direct you otherwise';
    return { cls: 'idle', icon: icon('info'), dist: '', text: recent, sub: 'Examiner directions' };
  }
  return {
    cls: '',
    icon: maneuverIcon(next),
    dist: `${d.value}<small>${d.unit}</small>`,
    text: instructionText(next, { destination: dest }),
    sub: next.type !== 'arrive' && next.destinations ? `towards ${next.destinations.split(',')[0]}` : '',
  };
}

function renderPanel(snap) {
  if (!S) return;
  const b = bannerFor(snap);
  const banner = el('nv-banner');
  if (banner) banner.className = `banner ${b.cls}`;
  setHtml('nv-icon', b.icon);
  setHtml('nv-dist', b.dist);
  setText('nv-text', b.text);
  setText('nv-sub', b.sub);

  const showGuidance = !b.cls && snap.next;
  setHtml('nv-lanes', showGuidance && snap.nextDistance != null && snap.nextDistance < 500 ? lanesHtml(snap.next) : '');
  const thenEl = el('nv-then');
  if (thenEl) {
    if (showGuidance && snap.then && !(S.mock && S.session.settings.voiceStyle === 'examiner')) {
      setHtml('nv-then', `Then ${maneuverIcon(snap.then)}`);
      thenEl.hidden = false;
    } else {
      thenEl.hidden = true;
    }
  }

  const status = el('nv-status');
  if (status) {
    if (snap.status === 'rerouting') {
      status.innerHTML = '<div class="spinner"></div>Rerouting';
      status.hidden = false;
    } else if (S.simulate) {
      status.textContent = S.mock ? 'Mock test · practice mode' : 'Practice mode · simulated drive';
      status.hidden = false;
    } else if (S.mock) {
      status.textContent = S.phase === 'independent' ? 'Independent driving' : 'Mock test';
      status.hidden = false;
    } else {
      status.hidden = true;
    }
  }

  const speed = snap.speed != null ? Math.round(mph(snap.speed)) : null;
  setText('nv-speed', speed != null ? String(speed) : '–');
  el('nv-speedo')?.classList.toggle('over', !!snap.overLimit);
  const limitEl = el('nv-limit');
  if (limitEl) {
    if (snap.speedLimit) {
      setText('nv-limit', String(snap.speedLimit));
      limitEl.hidden = false;
    } else {
      limitEl.hidden = true;
    }
  }
  const remain = snap.remainingDuration * 1.15;
  setText('nv-eta', formatClock(new Date(Date.now() + remain * 1000)));
  const rd = displayDistance(snap.remainingDistance, S.app.settings.units);
  setText('nv-remain', `${formatDuration(remain)} · ${rd.value} ${rd.unit}`);

  // Map extras
  if (snap.status === 'on' && snap.next && snap.next !== S.lastArrowStep) {
    S.lastArrowStep = snap.next;
    if (!(S.mock && S.session.settings.voiceStyle === 'examiner')) S.app.map.setManeuverArrow(snap.next);
    else S.app.map.setManeuverArrow(null);
  } else if (snap.status !== 'on' && S.lastArrowStep) {
    S.lastArrowStep = null;
    S.app.map.setManeuverArrow(null);
  }
  if ((snap.status === 'off' || snap.status === 'rerouting' || snap.status === 'approach') && snap.target && snap.position) {
    S.app.map.setOffRouteLine(snap.position, snap.target.point);
  } else {
    S.app.map.setOffRouteLine(null);
  }
  requestAnimationFrame(measure);
}

function targetZoom(speed, nextDist) {
  const v = speed || 0;
  let z = v < 8 ? 17.2 : v < 14 ? 16.8 : v < 20 ? 16.3 : 15.6;
  if (nextDist != null && nextDist < 250) z = Math.max(z, 16.9);
  return z;
}

function frame(now) {
  if (!S || S.ended) return;
  S.raf = requestAnimationFrame(frame);
  const snap = S.snap;
  const dt = Math.min(0.1, (now - (S.lastFrame || now)) / 1000);
  S.lastFrame = now;
  if (!snap || !snap.fix) return;
  const d = S.disp;
  const model = S.session.model;
  const onRoute = snap.status === 'on' || snap.status === 'arrived';
  let point;
  let targetBearing;
  if (onRoute) {
    if (d.version !== snap.modelVersion || !d.point) {
      d.version = snap.modelVersion;
      d.along = snap.along;
    }
    const elapsed = (now - S.snapAt) / 1000;
    const v = snap.speed || 0;
    const target = snap.along + v * Math.min(elapsed, 1.3);
    if (target < d.along - 40 || target > d.along + 150) d.along = target;
    else d.along += (target - d.along) * Math.min(1, dt * 3.5);
    d.along = Math.max(0, Math.min(model.length, d.along));
    const pt = model.pointAt(d.along);
    point = pt.point;
    targetBearing = pt.bearing;
  } else {
    const raw = snap.position || [snap.fix.lon, snap.fix.lat];
    if (!d.point || distance(d.point, raw) > 200) d.point = raw;
    point = [d.point[0] + (raw[0] - d.point[0]) * Math.min(1, dt * 3), d.point[1] + (raw[1] - d.point[1]) * Math.min(1, dt * 3)];
    targetBearing = snap.fix.heading ?? d.bearing;
  }
  d.point = point;
  d.bearing = lerpBearing(d.bearing, targetBearing ?? d.bearing, Math.min(1, dt * 3));
  d.zoom += (targetZoom(snap.speed, snap.nextDistance) - d.zoom) * Math.min(1, dt * 1.2);

  const map = S.app.map;
  map.setPuck(point, d.bearing, { off: !onRoute });
  if (S.follow && !S.overview) {
    map.follow({
      center: point,
      bearing: d.bearing,
      zoom: d.zoom,
      pitch: S.app.settings.mapPitch ? 50 : 0,
      padding: followPadding(),
    });
  }
  if (onRoute && now - S.lastProgressDraw > 700) {
    S.lastProgressDraw = now;
    map.setProgress(d.along);
  }
}

function updateViewButton() {
  const b = el('nv-view');
  if (!b) return;
  const showingRecentre = !S.follow || S.overview;
  b.innerHTML = showingRecentre ? icon('locate') : icon('overview');
  b.setAttribute('aria-label', showingRecentre ? 'Re-centre' : 'Show whole route');
}

function bindControls() {
  const app = S.app;
  el('nv-end').onclick = () => endNavigation(true);
  const mute = el('nv-mute');
  const syncMute = () => {
    mute.innerHTML = app.voice.enabled ? icon('volume') : icon('mute');
    mute.classList.toggle('muted', !app.voice.enabled);
  };
  syncMute();
  mute.onclick = () => {
    app.updateSettings({ voice: !app.voice.enabled });
    if (!app.voice.enabled) app.voice.stop();
    syncMute();
    toast(app.voice.enabled ? 'Voice on' : 'Voice muted', { top: true, ms: 1500 });
  };
  el('nv-view').onclick = () => {
    if (!S.follow || S.overview) {
      S.follow = true;
      S.overview = false;
    } else {
      S.overview = true;
      const m = S.session.model;
      const pts = m.coords.slice();
      if (S.disp.point) pts.push(S.disp.point);
      const pad = landscape()
        ? { top: 30, bottom: 30, left: (el('nv-bannerwrap')?.getBoundingClientRect().width || 360) + 20, right: 80 }
        : { top: (el('nv-bannerwrap')?.getBoundingClientRect().height || 150) + 30, bottom: (el('nv-bottom')?.getBoundingClientRect().height || 100) + 30, left: 30, right: 80 };
      app.map.fit(pts, pad);
      clearTimeout(S.refollow);
      S.refollow = setTimeout(() => { if (S) { S.overview = false; S.follow = true; updateViewButton(); } }, 15000);
    }
    updateViewButton();
  };
  el('nv-banner').onclick = () => repeatInstruction();
  el('nv-awake').onclick = () => app.wake.enable();

  if (S.simulate) {
    const src = S.source;
    el('nv-sim-pause').onclick = (e) => {
      src.setPaused(!src.paused);
      e.currentTarget.innerHTML = src.paused ? `${icon('play')}<span>Resume</span>` : `${icon('pause')}<span>Pause</span>`;
    };
    el('nv-sim-speed').onclick = (e) => {
      const speeds = [1, 2, 4, 8];
      const i = (speeds.indexOf(src.speedFactor) + 1) % speeds.length;
      src.speedFactor = speeds[i];
      app.updateSettings({ simSpeed: speeds[i] });
      e.currentTarget.innerHTML = `${icon('sim')}<span>${speeds[i]}×</span>`;
    };
    el('nv-sim-speed').innerHTML = `${icon('sim')}<span>${src.speedFactor}×</span>`;
    el('nv-sim-wrong').onclick = () => {
      src.wrongTurn();
      toast('Taking a wrong turn…', { top: true, ms: 2000 });
    };
  }
}

function repeatInstruction() {
  const snap = S?.snap;
  if (!snap) return;
  const app = S.app;
  if (S.mock && S.session.settings.voiceStyle === 'examiner') {
    if (S.lastSpoken) app.voice.say(S.lastSpoken, { priority: 'high' });
    return;
  }
  if (snap.status === 'on' && snap.next) {
    const dest = app.centre.destinationName || 'the test centre';
    const d = snap.nextDistance ?? 0;
    const text = instructionText(snap.next, { spoken: true, destination: dest });
    app.voice.say(d > 60 ? `In ${spokenDistance(d, app.settings.units)}, ${lowerFirst(text)}.` : `${text}.`, { priority: 'high' });
  } else if (snap.status === 'off') {
    app.voice.say('You are off the route. Head back to the blue line when it is safe.', { priority: 'high' });
  }
}

async function onArrived() {
  if (!S || S.arrivedShown) return;
  S.arrivedShown = true;
  const app = S.app;
  recordDrive(app.centre.id, S.route.id, { completed: true });
  S.recorded = true;
  const mins = Math.round((Date.now() - S.startedAt) / 60000);
  if (S.mock) speakWrapper(app)("That's the end of your mock test. Well done.");
  const v = await choose({
    title: S.mock ? 'Mock test complete' : 'Route complete',
    message: `${S.mock ? `That was "${S.route.name}". ` : ''}Driving time ${mins} min${S.session.rerouteCount ? `, with ${S.session.rerouteCount} reroute${S.session.rerouteCount > 1 ? 's' : ''}` : ''}.`,
    buttons: [
      { label: 'Finish', value: 'done', kind: 'primary' },
      { label: 'Keep the map open', value: 'stay' },
    ],
  });
  if (v === 'done') endNavigation(false);
}

async function endNavigation(ask) {
  if (!S) return;
  if (ask && !S.arrivedShown) {
    const ok = await confirmDialog('End this route?', 'Guidance will stop.', 'End route', 'danger');
    if (!ok) return;
  }
  const app = S.app;
  if (!S.recorded && Date.now() - S.startedAt > 120000 && !S.simulate) recordDrive(app.centre.id, S.route.id, { completed: false });
  S.recorded = true;
  const routeId = S.route.id;
  cleanup();
  // Back to the route's preview (with its name shown, even after a mock test),
  // replacing the preview we came from so Back then goes home.
  const prev = app.history[app.history.length - 1];
  if (prev?.name === 'preview' && prev.params?.routeId === routeId) app.history.pop();
  app.show('preview', { routeId }, { replace: true });
}

function cleanup() {
  if (!S) return;
  const app = S.app;
  S.ended = true;
  cancelAnimationFrame(S.raf);
  clearTimeout(S.refollow);
  S.source?.stop();
  S.session?.end();
  S.offWake?.();
  app.map.off('usermove', S.onUserMove);
  window.removeEventListener('resize', S.onResize);
  app.wake.disable();
  app.voice.stop();
  app.map.hidePuck();
  app.map.setOffRouteLine(null);
  app.map.setManeuverArrow(null);
  $('#nav').innerHTML = '';
  $('#nav').hidden = true;
  S = null;
}

export function leave() {
  cleanup();
}

/** For tests and debugging. */
export function _state() {
  return S;
}
