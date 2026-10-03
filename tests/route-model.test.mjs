import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance } from '../js/lib/geo.js';
import { normalizeOsrmRoute, RouteModel } from '../js/nav/route-model.js';
import { examinerText, instructionText, roundaboutDirection, spokenRef } from '../js/nav/instructions.js';
import { ll, osrmRoute, sampleRoute } from './helpers.mjs';

test('normalises a single-leg route', () => {
  const data = normalizeOsrmRoute(sampleRoute());
  assert.equal(data.steps.length, 5);
  assert.deepEqual(data.steps.map((s) => s.type), ['depart', 'turn', 'roundabout', 'turn', 'arrive']);
  const model = new RouteModel(data);
  assert.ok(Math.abs(model.length - (400 + 600 + 500 + 300 + 20)) < 30, `length ${model.length}`);
  // Each step's along-distance is at its manoeuvre location.
  for (const s of model.steps) {
    assert.ok(distance(model.pointAt(s.along).point, s.location) < 1, `step ${s.index}`);
  }
  assert.equal(model.announced.length, 4);
});

test('stitches multi-leg routes so waypoints are not announced', () => {
  const raw = osrmRoute(null, {
    legs: [
      [
        { pts: [[0, 0], [0, 300]], type: 'depart', name: 'Eldon Road' },
        { pts: [[0, 300], [-200, 300]], type: 'turn', modifier: 'left', name: 'Barton Lane' },
        { pts: [[-200, 300], [-200, 300]], type: 'arrive', name: 'Barton Lane' },
      ],
      [
        { pts: [[-200, 300], [-500, 300]], type: 'depart', name: 'Barton Lane' },
        { pts: [[-500, 300], [-500, 600]], type: 'turn', modifier: 'right', name: 'Swiney Way' },
        { pts: [[-500, 600], [-500, 600]], type: 'arrive', name: 'Swiney Way' },
      ],
    ],
  });
  const data = normalizeOsrmRoute(raw, { vias: [ll([-200, 300])] });
  assert.deepEqual(data.steps.map((s) => s.type), ['depart', 'turn', 'turn', 'arrive']);
  const barton = data.steps[1];
  assert.ok(Math.abs(barton.distance - 500) < 3, `merged distance ${barton.distance}`);
  const model = new RouteModel(data);
  assert.equal(model.vias.length, 1);
  assert.ok(Math.abs(model.vias[0].along - 500) < 3);
  assert.ok(Math.abs(model.steps[2].along - 800) < 3);
});

test('merges roundabout exit steps into the roundabout', () => {
  const raw = osrmRoute([
    { pts: [[0, 0], [0, 200]], type: 'depart', name: 'A' },
    { pts: [[0, 200], [10, 220]], type: 'roundabout', modifier: 'right', exit: 3, name: 'B' },
    { pts: [[10, 220], [200, 220]], type: 'exit roundabout', modifier: 'right', name: 'B' },
    { pts: [[200, 220], [200, 220]], type: 'arrive', name: 'B' },
  ]);
  const data = normalizeOsrmRoute(raw);
  assert.deepEqual(data.steps.map((s) => s.type), ['depart', 'roundabout', 'arrive']);
});

test('remaining duration falls as you progress', () => {
  const model = new RouteModel(normalizeOsrmRoute(sampleRoute()));
  const t0 = model.remainingDuration(0);
  const t1 = model.remainingDuration(900);
  assert.ok(t0 > t1 && t1 > 0);
  assert.ok(Math.abs(t0 - model.duration) < 1);
});

test('speed limit ranges map onto segments', () => {
  const data = normalizeOsrmRoute(sampleRoute());
  data.speedLimits = [{ from: 0, to: 2, mph: 30 }, { from: 2, to: data.coords.length - 1, mph: 40 }];
  const model = new RouteModel(data);
  assert.equal(model.speedLimitAt(100), 30);
  assert.equal(model.speedLimitAt(model.length - 10), 40);
});

test('sat nav instruction wording', () => {
  assert.equal(instructionText({ type: 'turn', modifier: 'left', name: 'Barton Lane' }), 'Turn left onto Barton Lane');
  assert.equal(instructionText({ type: 'turn', modifier: 'slight right', name: '' }), 'Bear right');
  assert.equal(instructionText({ type: 'end of road', modifier: 'right', name: 'High Road' }), 'At the end of the road, turn right onto High Road');
  assert.equal(
    instructionText({ type: 'roundabout', exit: 2, name: 'Brian Clough Way', ref: 'A52' }, { spoken: true }),
    'At the roundabout, take the second exit onto the A 52, Brian Clough Way',
  );
  assert.equal(instructionText({ type: 'roundabout', exit: 3, name: 'Toton Lane', ref: 'B6003' }), 'At the roundabout, take the 3rd exit onto B6003 Toton Lane');
  assert.equal(instructionText({ type: 'arrive' }, { destination: 'the test centre' }), 'Arrive at the test centre');
  assert.equal(spokenRef('B6003'), 'B 6 oh oh 3');
  assert.equal(spokenRef('A453'), 'A 4 5 3');
  assert.equal(spokenRef('M1'), 'M 1');
  assert.equal(spokenRef('A52;A6005'), 'A 52');
});

test('examiner wording', () => {
  assert.equal(examinerText({ type: 'turn', modifier: 'left' }, { ordinalOnSide: 1 }), 'Take the next road on the left, please.');
  assert.equal(examinerText({ type: 'turn', modifier: 'right' }, { ordinalOnSide: 2 }), 'Take the second road on the right.');
  assert.equal(examinerText({ type: 'end of road', modifier: 'left' }), 'At the end of the road, turn left, please.');
  const rb = { type: 'roundabout', exit: 3, bearingBefore: 0, bearingAfter: 90 };
  assert.equal(roundaboutDirection(rb), 'right');
  assert.equal(examinerText(rb), "At the roundabout, take the third exit. That's to the right.");
});

test('counts side roads for examiner directions', () => {
  // Driving north; two side roads on the left before turning left at the third.
  const raw = osrmRoute([
    {
      pts: [[0, 0], [0, 100], [0, 200], [0, 300]],
      type: 'depart',
      name: 'Long Lane',
      intersections: [
        { at: [0, 0], bearings: [0], entry: [true], out: 0 },
        { at: [0, 100], bearings: [0, 180, 270], entry: [true, false, true], in: 1, out: 0 },
        { at: [0, 200], bearings: [0, 90, 180, 270], entry: [true, true, false, true], in: 2, out: 0 },
      ],
    },
    { pts: [[0, 300], [-200, 300]], type: 'turn', modifier: 'left', name: 'Grove Road' },
    { pts: [[-200, 300], [-200, 300]], type: 'arrive' },
  ]);
  const model = new RouteModel(normalizeOsrmRoute(raw));
  assert.equal(model.sideRoads.length, 2);
  assert.equal(model.sideRoadsBetween(0, 300, 'left'), 2);
  assert.equal(model.sideRoadsBetween(0, 300, 'right'), 1);
  assert.equal(model.sideRoadsBetween(150, 300, 'left'), 1);
});
