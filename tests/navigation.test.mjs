import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination } from '../js/lib/geo.js';
import { Guidance } from '../js/nav/guidance.js';
import { normalizeOsrmRoute, RouteModel } from '../js/nav/route-model.js';
import { NavSession } from '../js/nav/session.js';
import { Tracker } from '../js/nav/tracker.js';
import { driveAlong, ll, osrmRoute, sampleRoute } from './helpers.mjs';

function model() {
  return new RouteModel(normalizeOsrmRoute(sampleRoute()));
}

test('tracker follows the route with GPS noise and never goes backwards', () => {
  const m = model();
  const t = new Tracker(m);
  let last = -1;
  let i = 0;
  for (const fix of driveAlong(m, { step: 12 })) {
    // +-8 m alternating sideways noise
    const noisy = { ...fix, ...(() => { const p = destination([fix.lon, fix.lat], (i++ * 97) % 360, 8); return { lon: p[0], lat: p[1] }; })() };
    const r = t.update(noisy);
    assert.notEqual(r.state, 'off', `went off route at ${fix.time}`);
    assert.ok(r.along >= last, 'along must not decrease');
    last = r.along;
  }
  assert.ok(t.arrived, 'should arrive');
  assert.ok(m.length - last < 30);
});

test('tracker detects leaving the route after a few fixes, then rejoining', () => {
  const m = model();
  const t = new Tracker(m);
  let time = 0;
  for (const fix of driveAlong(m, { to: 300 })) { t.update(fix); time = fix.time; }
  assert.equal(t.state, 'on');
  // Drive off to the east at 13 m/s (the route continues north).
  let p = [ll([0, 300])[0], ll([0, 300])[1]];
  const events = [];
  for (let k = 1; k <= 10; k++) {
    p = destination(p, 90, 13);
    time += 1000;
    const r = t.update({ lon: p[0], lat: p[1], speed: 13, heading: 90, accuracy: 6, time });
    if (r.event) events.push([k, r.event]);
  }
  assert.ok(events.length >= 1 && events[0][1] === 'offroute', JSON.stringify(events));
  assert.ok(events[0][0] >= 3 && events[0][0] <= 5, `off route detected after ${events[0][0]} fixes`);
  // Come back onto the route further along.
  const back = m.pointAt(450).point;
  const r = t.update({ lon: back[0], lat: back[1], speed: 10, heading: 270, accuracy: 6, time: time + 1000 });
  assert.equal(r.event, 'rejoined');
  assert.ok(Math.abs(r.along - 450) < 5);
});

test('tracker ignores a single bad GPS jump', () => {
  const m = model();
  const t = new Tracker(m);
  let time = 0;
  for (const fix of driveAlong(m, { to: 200 })) { t.update(fix); time = fix.time; }
  const far = destination(m.pointAt(210).point, 90, 120);
  const r1 = t.update({ lon: far[0], lat: far[1], speed: 13, heading: 0, accuracy: 6, time: time + 1000 });
  assert.equal(r1.state, 'on');
  const ok = m.pointAt(225).point;
  const r2 = t.update({ lon: ok[0], lat: ok[1], speed: 13, heading: 0, accuracy: 6, time: time + 2000 });
  assert.equal(r2.state, 'on');
  assert.equal(r2.event, null);
});

test('tracker detects driving the wrong way along the route', () => {
  const m = model();
  const t = new Tracker(m);
  let time = 0;
  for (const fix of driveAlong(m, { to: 700 })) { t.update(fix); time = fix.time; }
  let event = null;
  for (let d = 690; d > 500 && !event; d -= 13) {
    const pt = m.pointAt(d);
    time += 1000;
    const r = t.update({ lon: pt.point[0], lat: pt.point[1], speed: 13, heading: (pt.bearing + 180) % 360, accuracy: 5, time });
    event = r.event;
  }
  assert.equal(event, 'wrongway');
});

test('a poor GPS fix does not trigger off route', () => {
  const m = model();
  const t = new Tracker(m);
  let time = 0;
  for (const fix of driveAlong(m, { to: 300 })) { t.update(fix); time = fix.time; }
  let p = ll([0, 300]);
  for (let k = 0; k < 8; k++) {
    p = destination(p, 90, 13);
    time += 1000;
    const r = t.update({ lon: p[0], lat: p[1], speed: 13, heading: 90, accuracy: 120, time });
    assert.notEqual(r.event, 'offroute');
  }
});

test('guidance speaks early and at-junction prompts in order', () => {
  const m = model();
  const g = new Guidance(m, { destination: 'the test centre' });
  const spoken = [];
  // Drive using the tracker so `along` comes from real matching.
  const t = new Tracker(m);
  for (const fix of driveAlong(m, { step: 6, speed: 13 })) {
    const r = t.update(fix);
    const out = g.update(r.along, 13);
    if (out.speech) spoken.push([Math.round(r.along), out.speech]);
  }
  const texts = spoken.map((s) => s[1]);
  const idx = (re) => texts.findIndex((t) => re.test(t));
  const midLeft = idx(/^In \d+ yards, turn left onto Barton Lane/);
  const nearLeft = idx(/^Turn left onto Barton Lane/);
  const midRb = idx(/^In .*at the roundabout, take the second exit/);
  const nearRb = idx(/^At the roundabout, take the second exit onto the A 6 oh oh 5, Nottingham Road/);
  const arrive = idx(/arrived at the test centre/);
  assert.ok(midLeft >= 0 && nearLeft > midLeft, texts.join(' | '));
  assert.ok(midRb > nearLeft && nearRb > midRb, texts.join(' | '));
  assert.ok(arrive === texts.length - 1, texts.join(' | '));
  // The early prompt for the left turn comes 150-300 m before it.
  const [alongMid] = spoken[midLeft];
  assert.ok(400 - alongMid >= 120 && 400 - alongMid <= 330, `mid prompt at ${400 - alongMid} m`);
  // Nothing is spoken twice.
  assert.equal(new Set(texts).size, texts.length);
});

test('close manoeuvres are chained with "then"', () => {
  const raw = osrmRoute([
    { pts: [[0, 0], [0, 400]], type: 'depart', name: 'Eldon Road' },
    { pts: [[0, 400], [-60, 400]], type: 'turn', modifier: 'left', name: 'Barton Lane' },
    { pts: [[-60, 400], [-60, 700]], type: 'turn', modifier: 'right', name: 'Swiney Way' },
    { pts: [[-60, 700], [-60, 700]], type: 'arrive' },
  ]);
  const m = new RouteModel(normalizeOsrmRoute(raw));
  const g = new Guidance(m);
  const t = new Tracker(m);
  const texts = [];
  for (const fix of driveAlong(m, { step: 5, speed: 10 })) {
    const r = t.update(fix);
    const out = g.update(r.along, 10);
    if (out.speech) texts.push(out.speech);
  }
  assert.ok(texts.some((s) => /^Turn left onto Barton Lane, then turn right/.test(s)), texts.join(' | '));
  assert.ok(!texts.some((s) => /^In \d+ yards, turn right onto Swiney Way/.test(s)), texts.join(' | '));
});

test('examiner style gives one direction per junction without distances', () => {
  const m = model();
  const g = new Guidance(m, { style: 'examiner', destination: 'the test centre' });
  const t = new Tracker(m);
  const texts = [];
  for (const fix of driveAlong(m, { step: 6, speed: 13 })) {
    const r = t.update(fix);
    const out = g.update(r.along, 13);
    if (out.speech) texts.push(out.speech);
  }
  assert.ok(texts.every((s) => !/yards|mile/.test(s)), texts.join(' | '));
  assert.ok(texts.includes('Take the next road on the left, please.'), texts.join(' | '));
  assert.ok(texts.some((s) => s.startsWith('At the roundabout, take the second exit.')), texts.join(' | '));
  assert.ok(texts.some((s) => /park in a bay/.test(s)), texts.join(' | '));
});

function straightRouteFrom(points) {
  // Fake router: straight lines between the requested points.
  const steps = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = [points[i].lon, points[i].lat];
    const b = [points[i + 1].lon, points[i + 1].lat];
    steps.push({
      geometry: { type: 'LineString', coordinates: [a, b] },
      maneuver: { type: i === 0 ? 'depart' : 'turn', modifier: i === 0 ? undefined : 'left', location: a, bearing_before: 0, bearing_after: 0 },
      name: `Road ${i}`, distance: 300, duration: 25, intersections: [],
    });
  }
  const last = [points[points.length - 1].lon, points[points.length - 1].lat];
  steps.push({ geometry: { type: 'LineString', coordinates: [last, last] }, maneuver: { type: 'arrive', location: last }, name: '', distance: 0, duration: 0 });
  return normalizeOsrmRoute({ legs: [{ steps }], distance: 900, duration: 75 }, { vias: points.slice(1, -1).map((p) => [p.lon, p.lat]) });
}

test('session reroutes back onto the remaining route after going off route', async () => {
  const data = normalizeOsrmRoute(sampleRoute(), { vias: [ll([-300, 400]), ll([-900, 400])] });
  const requests = [];
  const spoken = [];
  const session = new NavSession({
    data,
    rerouter: async (points) => { requests.push(points); return straightRouteFrom(points); },
    speak: (t) => spoken.push(t),
    destination: 'the test centre',
  });
  let rerouted = false;
  session.on('rerouted', () => { rerouted = true; });
  let time = 0;
  for (const fix of driveAlong(session.model, { to: 320 })) { session.handleFix(fix); time = fix.time; }
  assert.equal(session.status, 'on');
  assert.ok(/^Head north on Eldon Road/.test(spoken[0]), spoken[0]);

  let p = ll([0, 320]);
  for (let k = 0; k < 8 && !rerouted; k++) {
    p = destination(p, 90, 13);
    time += 1000;
    session.handleFix({ lon: p[0], lat: p[1], speed: 13, heading: 90, accuracy: 6, time });
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.ok(rerouted, 'should have rerouted');
  assert.equal(requests.length, 1);
  // Rejoins at the remaining waypoints and finishes at the original end.
  const req = requests[0];
  assert.equal(req.length, 4, 'current position + 2 remaining waypoints + end');
  assert.ok(req[0].bearing === 90);
  assert.equal(session.modelVersion, 2);
  assert.equal(session.status, 'approach');
  // Driving the new route joins it straight away.
  const fix = driveAlong(session.model, { to: 30, t0: time + 1000 }).next().value;
  session.handleFix(fix);
  assert.equal(session.status, 'on');
  session.end();
});

test('session stays off route and retries when rerouting fails', async () => {
  const data = normalizeOsrmRoute(sampleRoute());
  let calls = 0;
  const session = new NavSession({
    data,
    rerouter: async () => { calls++; throw new Error('offline'); },
    speak: () => {},
  });
  let time = 0;
  for (const fix of driveAlong(session.model, { to: 320 })) { session.handleFix(fix); time = fix.time; }
  let p = ll([0, 320]);
  for (let k = 0; k < 8; k++) {
    p = destination(p, 90, 13);
    time += 1000;
    session.handleFix({ lon: p[0], lat: p[1], speed: 13, heading: 90, accuracy: 6, time });
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.equal(calls, 1);
  assert.equal(session.status, 'off');
  const snap = session.snapshot();
  assert.ok(snap.target && snap.target.distance > 30, 'points back to the route');
  // Driving back onto the route resumes guidance without a new route.
  const back = session.model.pointAt(500).point;
  session.handleFix({ lon: back[0], lat: back[1], speed: 10, heading: 270, accuracy: 5, time: time + 1000 });
  assert.equal(session.status, 'on');
  session.end();
});
