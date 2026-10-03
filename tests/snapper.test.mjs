import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance } from '../js/lib/geo.js';
import { buildQuery, junctionOf, resolveOne, selector } from '../js/services/snapper.js';
import { ll } from './helpers.mjs';

let nextNode = 1;
const nodeAt = new Map();
function node(x, y) {
  const key = `${x},${y}`;
  if (!nodeAt.has(key)) nodeAt.set(key, nextNode++);
  return nodeAt.get(key);
}

function way(id, pts, tags) {
  return {
    type: 'way',
    id,
    nodes: pts.map(([x, y]) => node(x, y)),
    geometry: pts.map((p) => { const [lon, lat] = ll(p); return { lon, lat }; }),
    tags: { highway: 'residential', ...tags },
  };
}

// A little road network (metres):
//   Nottingham Road runs east-west along y=400.
//   Barton Lane runs north from Eldon Road (y=0) to Nottingham Road (y=400) at x=0.
//   Eldon Road runs east from Barton Lane along y=0.
//   A52 dual carriageway along y=2000: eastbound at y=1990, westbound at y=2010.
const elements = [
  way(1, [[-800, 400], [0, 400], [800, 400]], { name: 'Nottingham Road', ref: 'A6005', highway: 'primary' }),
  way(2, [[0, 0], [0, 200]], { name: 'Barton Lane' }),
  way(3, [[0, 200], [0, 400]], { name: 'Barton Lane' }),
  way(4, [[0, 0], [300, 0]], { name: 'Eldon Road' }),
  way(5, [[-1000, 1990], [1000, 1990]], { name: 'Brian Clough Way', ref: 'A52', oneway: 'yes', highway: 'trunk' }),
  way(6, [[1000, 2010], [-1000, 2010]], { name: 'Brian Clough Way', ref: 'A52', oneway: 'yes', highway: 'trunk' }),
  way(7, [[500, 600], [500, 900]], { name: "Queen's Road West" }),
];

test('selector distinguishes refs from names', () => {
  assert.deepEqual(selector('A52'), { ref: 'A52' });
  assert.deepEqual(selector('b6003'), { ref: 'B6003' });
  assert.deepEqual(selector('Barton Lane'), { road: 'Barton Lane' });
});

test('query covers the road and both junction roads', () => {
  const q = buildQuery([{ road: 'Barton Lane', from: 'Eldon Road', to: 'A6005', near: ll([0, 300]) }]);
  assert.match(q, /Barton Lane/);
  assert.match(q, /Eldon Road/);
  assert.match(q, /"ref"~"\(\^\|;\) \?A6005/);
  assert.match(q, /out body geom/);
});

test('finds junctions by shared nodes', () => {
  const barton = elements.filter((e) => e.tags.name === 'Barton Lane');
  const eldon = elements.filter((e) => e.tags.name === 'Eldon Road');
  const j = junctionOf(barton, eldon, ll([0, 100]));
  assert.ok(distance(j, ll([0, 0])) < 1);
});

test('places a between-junctions waypoint mid-way along the stretch', () => {
  // `near` deliberately 250 m off; the junctions decide the spot.
  const r = resolveOne({ road: 'Barton Lane', from: 'Eldon Road', to: 'A6005', near: ll([250, 50]) }, elements);
  assert.equal(r.method, 'junctions');
  assert.ok(distance(r.point, ll([0, 200])) < 2, `got ${r.point}`);
  assert.ok(Math.abs(r.bearing - 0) < 2 || Math.abs(r.bearing - 360) < 2, `bearing ${r.bearing}`);
});

test('chooses the carriageway going the right way', () => {
  const east = resolveOne({ ref: 'A52', near: ll([0, 2015]), bearing: 90 }, elements);
  assert.ok(distance(east.point, ll([0, 1990])) < 2, 'eastbound carriageway');
  const west = resolveOne({ ref: 'A52', near: ll([0, 1985]), bearing: 270 }, elements);
  assert.ok(distance(west.point, ll([0, 2010])) < 2, 'westbound carriageway');
});

test('matches names ignoring apostrophes and case', () => {
  const r = resolveOne({ road: 'queens road west', near: ll([450, 700]) }, elements);
  assert.ok(r && distance(r.point, ll([500, 700])) < 2);
});

test('returns null when the road is not there', () => {
  assert.equal(resolveOne({ road: 'Imaginary Avenue', near: ll([0, 0]) }, elements), null);
});
