import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance } from '../js/lib/geo.js';
import { normalizeOsrmRoute } from '../js/nav/route-model.js';
import { routeAvoidingUturns, uturnSteps } from '../js/services/uturns.js';
import { ll } from './helpers.mjs';

// A fake router on a straight east-west road. A waypoint that has to be
// driven westbound while the route carries on east forces a U-turn there.
function fakeRouter(calls) {
  return async (points, opts = {}) => {
    calls.push({ points, opts });
    const steps = [];
    let prevDir = null;
    for (let i = 0; i < points.length - 1; i++) {
      const a = [points[i].lon, points[i].lat];
      const b = [points[i + 1].lon, points[i + 1].lat];
      const goingEast = b[0] > a[0];
      const wanted = points[i + 1].bearing;
      const forcedWest = wanted != null && wanted > 180 && goingEast;
      const dir = goingEast ? 90 : 270;
      const turnRound = prevDir != null && prevDir !== dir;
      steps.push({
        geometry: { type: 'LineString', coordinates: [a, b] },
        maneuver: i === 0
          ? { type: 'depart', location: a, bearing_after: dir }
          : turnRound
            ? { type: 'continue', modifier: 'uturn', location: a, bearing_before: prevDir, bearing_after: dir }
            : { type: 'new name', modifier: 'straight', location: a, bearing_before: prevDir, bearing_after: dir },
        name: 'Long Road', distance: distance(a, b), duration: distance(a, b) / 13,
      });
      prevDir = forcedWest ? 270 : dir;
      if (forcedWest) {
        // drive past, turn round to pass the waypoint westbound, turn round again
        steps.push({
          geometry: { type: 'LineString', coordinates: [b, b] },
          maneuver: { type: 'continue', modifier: 'uturn', location: b, bearing_before: 90, bearing_after: 270 },
          name: 'Long Road', distance: 30, duration: 10,
        });
      }
    }
    const end = [points[points.length - 1].lon, points[points.length - 1].lat];
    steps.push({ geometry: { type: 'LineString', coordinates: [end, end] }, maneuver: { type: 'arrive', location: end }, name: '', distance: 0, duration: 0 });
    const total = steps.reduce((s, x) => s + x.distance, 0);
    return normalizeOsrmRoute({ legs: [{ steps }], distance: total, duration: total / 13 }, { vias: points.slice(1, -1).map((p) => [p.lon, p.lat]) });
  };
}

const pts = [
  { lon: ll([0, 0])[0], lat: ll([0, 0])[1] },
  { lon: ll([1000, 0])[0], lat: ll([1000, 0])[1], bearing: 270 }, // wrong way round
  { lon: ll([2000, 0])[0], lat: ll([2000, 0])[1] },
];

test('counts U-turns but not roundabouts', () => {
  const data = normalizeOsrmRoute({
    legs: [{
      steps: [
        { geometry: { type: 'LineString', coordinates: [ll([0, 0]), ll([0, 100])] }, maneuver: { type: 'depart', location: ll([0, 0]) }, distance: 100, duration: 8 },
        { geometry: { type: 'LineString', coordinates: [ll([0, 100]), ll([0, 50])] }, maneuver: { type: 'roundabout', modifier: 'uturn', exit: 4, location: ll([0, 100]) }, distance: 50, duration: 8 },
        { geometry: { type: 'LineString', coordinates: [ll([0, 50]), ll([0, 80])] }, maneuver: { type: 'turn', modifier: 'uturn', location: ll([0, 50]) }, distance: 30, duration: 8 },
        { geometry: { type: 'LineString', coordinates: [ll([0, 80]), ll([0, 80])] }, maneuver: { type: 'arrive', location: ll([0, 80]) }, distance: 0, duration: 0 },
      ],
    }],
    distance: 180,
    duration: 24,
  });
  assert.equal(uturnSteps(data).length, 1);
});

test('repairs a U-turn by relaxing the waypoint direction', async () => {
  const calls = [];
  const best = await routeAvoidingUturns(pts, { router: fakeRouter(calls) });
  assert.equal(best.uturns, 0);
  assert.equal(best.points.length, 3, 'kept the waypoint');
  assert.equal(best.points[1].bearing, null, 'but dropped its direction');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].opts.strict, true);
});

test('leaves a clean route alone', async () => {
  const calls = [];
  const clean = pts.map((p) => ({ ...p, bearing: null }));
  const best = await routeAvoidingUturns(clean, { router: fakeRouter(calls) });
  assert.equal(best.uturns, 0);
  assert.equal(calls.length, 1);
});

test('gives up gracefully when nothing helps', async () => {
  const calls = [];
  const stubborn = async (points, opts) => {
    const data = await fakeRouter([])(points.map((p, i) => (i === 1 ? { ...p, bearing: 270 } : p)), opts);
    calls.push(points.length);
    return data;
  };
  const best = await routeAvoidingUturns(pts, { router: stubborn, rounds: 2 });
  assert.ok(best.uturns >= 1);
  assert.ok(calls.length <= 1 + 3 * 2);
});

test('a U-turn just after the start is fixed by setting off the other way', async () => {
  // Router that only avoids the U-turn when told which way to set off.
  const router = async (points) => {
    const a = [points[0].lon, points[0].lat];
    const mid = ll([0, 60]);
    const end = [points[points.length - 1].lon, points[points.length - 1].lat];
    const startsSouth = points[0].bearing != null && Math.abs(points[0].bearing - 180) < 30;
    const steps = startsSouth
      ? [
        { geometry: { type: 'LineString', coordinates: [a, end] }, maneuver: { type: 'depart', location: a, bearing_after: 180 }, distance: 500, duration: 40 },
      ]
      : [
        { geometry: { type: 'LineString', coordinates: [a, mid] }, maneuver: { type: 'depart', location: a, bearing_after: 0 }, distance: 60, duration: 6 },
        { geometry: { type: 'LineString', coordinates: [mid, end] }, maneuver: { type: 'turn', modifier: 'uturn', location: mid, bearing_before: 0, bearing_after: 180 }, distance: 560, duration: 45 },
      ];
    steps.push({ geometry: { type: 'LineString', coordinates: [end, end] }, maneuver: { type: 'arrive', location: end }, distance: 0, duration: 0 });
    const total = steps.reduce((t, x) => t + x.distance, 0);
    return normalizeOsrmRoute({ legs: [{ steps }], distance: total, duration: total / 12 }, { vias: [] });
  };
  const best = await routeAvoidingUturns([
    { lon: ll([0, 0])[0], lat: ll([0, 0])[1] },
    { lon: ll([0, -500])[0], lat: ll([0, -500])[1] },
  ], { router });
  assert.equal(best.uturns, 0);
  assert.equal(best.points[0].bearing, 180);
});
