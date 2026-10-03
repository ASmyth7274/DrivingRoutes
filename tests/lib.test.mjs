import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  angleDiff, bearing, cumulativeDistances, destination, distance, pointAlong,
  projectOnSegment, simplifyIndices, sliceLine,
} from '../js/lib/geo.js';
import { decodePolyline, encodePolyline } from '../js/lib/polyline.js';
import { displayDistance, ordinal, spokenDistance, ukLimitFromKph } from '../js/lib/units.js';
import { ll } from './helpers.mjs';

test('distance and bearing', () => {
  const a = ll([0, 0]);
  const b = ll([0, 1000]);
  assert.ok(Math.abs(distance(a, b) - 1000) < 2);
  assert.ok(Math.abs(bearing(a, b)) < 0.5 || Math.abs(bearing(a, b) - 360) < 0.5);
  assert.ok(Math.abs(bearing(a, ll([1000, 0])) - 90) < 0.5);
  const c = destination(a, 90, 500);
  assert.ok(Math.abs(distance(a, c) - 500) < 0.5);
});

test('angleDiff is signed and wraps', () => {
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), -20);
  assert.equal(angleDiff(0, 180), 180);
  assert.equal(angleDiff(90, 0), -90);
});

test('projectOnSegment', () => {
  const a = ll([0, 0]);
  const b = ll([0, 100]);
  const pr = projectOnSegment(ll([10, 50]), a, b);
  assert.ok(Math.abs(pr.t - 0.5) < 0.01);
  assert.ok(Math.abs(pr.distance - 10) < 0.2);
  const end = projectOnSegment(ll([0, 150]), a, b);
  assert.equal(end.t, 1);
});

test('pointAlong and sliceLine', () => {
  const coords = [ll([0, 0]), ll([0, 100]), ll([100, 100])];
  const cum = cumulativeDistances(coords);
  assert.ok(Math.abs(cum[2] - 200) < 0.5);
  const p = pointAlong(coords, cum, 150);
  assert.equal(p.index, 1);
  assert.ok(distance(p.point, ll([50, 100])) < 0.5);
  const s = sliceLine(coords, cum, 50, 150);
  assert.equal(s.length, 3);
  assert.ok(distance(s[0], ll([0, 50])) < 0.5);
  assert.ok(distance(s[2], ll([50, 100])) < 0.5);
});

test('simplifyIndices keeps corners', () => {
  const coords = [ll([0, 0]), ll([0, 50]), ll([0.5, 100]), ll([0, 150]), ll([100, 150])];
  const idx = simplifyIndices(coords, 2);
  assert.deepEqual(idx, [0, 3, 4]);
});

test('polyline round trip at precision 5 and 6', () => {
  const coords = [[-1.2383, 52.9047], [-1.2391, 52.9061], [-1.2412, 52.9077]];
  for (const p of [5, 6]) {
    const back = decodePolyline(encodePolyline(coords, p), p);
    back.forEach((c, i) => {
      assert.ok(Math.abs(c[0] - coords[i][0]) < 1e-5);
      assert.ok(Math.abs(c[1] - coords[i][1]) < 1e-5);
    });
  }
  // Known example from the polyline spec
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
});

test('spoken distances follow UK sat nav phrasing', () => {
  assert.equal(spokenDistance(183), '200 yards');
  assert.equal(spokenDistance(70), '80 yards');
  assert.equal(spokenDistance(400), 'a quarter of a mile');
  assert.equal(spokenDistance(805), 'half a mile');
  assert.equal(spokenDistance(1609), '1 mile');
  assert.equal(spokenDistance(4800), '3 miles');
  assert.equal(spokenDistance(300, 'metric'), '300 metres');
});

test('display distances', () => {
  assert.deepEqual(displayDistance(100), { value: '110', unit: 'yd' });
  assert.deepEqual(displayDistance(800), { value: '0.5', unit: 'mi' });
  assert.deepEqual(displayDistance(800, 'metric'), { value: '800', unit: 'm' });
});

test('ordinals and speed limit snapping', () => {
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ukLimitFromKph(48), 30);
  assert.equal(ukLimitFromKph(64), 40);
  assert.equal(ukLimitFromKph(113), 70);
  assert.equal(ukLimitFromKph(0), null);
});
