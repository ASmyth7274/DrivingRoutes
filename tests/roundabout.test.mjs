import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOsrmRoute, roundaboutAngle, RouteModel } from '../js/nav/route-model.js';
import { examinerText, roundaboutDirection } from '../js/nav/instructions.js';
import { maneuverIcon } from '../js/ui/icons.js';
import { osrmRoute } from './helpers.mjs';

/**
 * A UK roundabout of radius 20 m centred at (0, 20), entered from the south
 * heading north. Exits: 1st west, 2nd north, 3rd east, 4th back south.
 * Like OSRM, the roundabout step's bearing_after is the direction onto the
 * ring (west), not the exit direction.
 */
function roundaboutRoute(exit, { modifier } = {}) {
  const exitTheta = [270, 360, 450, 540][exit - 1];
  const ring = [];
  for (let t = 180; t <= exitTheta; t += 15) {
    const r = (t * Math.PI) / 180;
    ring.push([20 * Math.sin(r), 20 + 20 * Math.cos(r)]);
  }
  const last = ring[ring.length - 1];
  const out = (exitTheta * Math.PI) / 180;
  const exitRoad = [1, 2, 3, 4, 5].map((k) => [last[0] + Math.sin(out) * 30 * k, last[1] + Math.cos(out) * 30 * k]);
  const raw = osrmRoute([
    { pts: [[0, -200], [0, 0]], type: 'depart', name: 'Approach Road' },
    { pts: [...ring, ...exitRoad], type: 'roundabout', exit, modifier, name: 'Exit Road' },
    { pts: [exitRoad[4], exitRoad[4]], type: 'arrive' },
  ]);
  // The helper sets bearing_after from the first segment: the ring heading west.
  assert.ok(Math.abs(raw.legs[0].steps[1].maneuver.bearing_after - 270) < 10);
  return new RouteModel(normalizeOsrmRoute(raw));
}

test('roundabout exit direction comes from where you leave the ring', () => {
  const expected = { 1: -90, 2: 0, 3: 90, 4: 180 };
  for (const exit of [1, 2, 3, 4]) {
    const step = roundaboutRoute(exit).steps[1];
    const a = Math.abs(step.exitAngle) === 180 ? 180 : step.exitAngle;
    assert.ok(Math.abs(a - expected[exit]) < 12, `exit ${exit}: got ${step.exitAngle}`);
  }
});

test('third exit is described as a right turn, not the first exit', () => {
  const step = roundaboutRoute(3).steps[1];
  assert.equal(roundaboutDirection(step), 'right');
  assert.equal(examinerText(step), "At the roundabout, take the third exit. That's to the right.");
  assert.equal(roundaboutDirection(roundaboutRoute(1).steps[1]), 'left');
  assert.equal(roundaboutDirection(roundaboutRoute(2).steps[1]), 'straight');
  assert.equal(roundaboutDirection(roundaboutRoute(4).steps[1]), 'back');
});

test('roundabout icon shows the exit number and leaves on the correct side', () => {
  const svg3 = maneuverIcon(roundaboutRoute(3).steps[1]);
  assert.match(svg3, />3<\/text>/);
  // The arrowhead for a right-hand exit sits on the right of the 100x100 icon.
  const head = /<path d="M([\d.]+) ([\d.]+) L/.exec(svg3.split('</circle>').pop().split('L').slice(-3).join('L'));
  void head;
  const tips = [...svg3.matchAll(/<path d="M([\d.]+) ([\d.]+) L[\d. ]+L[\d. ]+Z"/g)].map((m) => Number(m[1]));
  assert.ok(tips.length && tips[tips.length - 1] > 70, `arrow tip x=${tips[tips.length - 1]}`);
  const svg1 = maneuverIcon(roundaboutRoute(1).steps[1]);
  const tips1 = [...svg1.matchAll(/<path d="M([\d.]+) ([\d.]+) L[\d. ]+L[\d. ]+Z"/g)].map((m) => Number(m[1]));
  assert.ok(tips1[tips1.length - 1] < 30, `first exit arrow tip x=${tips1[tips1.length - 1]}`);
});

test('falls back to the router direction, then the exit number', () => {
  assert.equal(roundaboutAngle({ type: 'roundabout', modifier: 'right', exit: 3 }), 90);
  assert.equal(roundaboutAngle({ type: 'roundabout', exit: 1 }), -90);
  assert.equal(roundaboutAngle({ type: 'roundabout', exit: 2 }), 0);
});

test('a router turning round at a waypoint becomes an announced U-turn', () => {
  const raw = osrmRoute(null, {
    legs: [
      [
        { pts: [[0, 0], [0, 300]], type: 'depart', name: 'Barton Lane' },
        { pts: [[0, 300], [0, 300]], type: 'arrive', name: 'Barton Lane' },
      ],
      [
        { pts: [[0, 300], [0, 0]], type: 'depart', name: 'Barton Lane' },
        { pts: [[0, 0], [-200, 0]], type: 'turn', modifier: 'right', name: 'Eldon Road' },
        { pts: [[-200, 0], [-200, 0]], type: 'arrive' },
      ],
    ],
  });
  const data = normalizeOsrmRoute(raw);
  const types = data.steps.map((s) => `${s.type}${s.modifier === 'uturn' ? ' uturn' : ''}`);
  assert.deepEqual(types, ['depart', 'continue uturn', 'turn', 'arrive']);
  const model = new RouteModel(data);
  assert.ok(model.announced.some((s) => s.modifier === 'uturn'));
});
