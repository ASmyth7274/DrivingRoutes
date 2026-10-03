import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idbGet, idbSet } from '../js/lib/idb.js';
import { ROUTE_DATA_VERSION } from '../js/nav/route-model.js';
import { compileRoute, routeKey } from '../js/services/compiler.js';
import { ll, sampleRoute } from './helpers.mjs';

// Node has no IndexedDB, so idb.js keeps everything in memory here.

const centre = { id: 'compiler-test', location: ll([0, 0]) };
const def = (id) => ({ id, waypoints: [{ road: 'Barton Lane', near: ll([-300, 400]) }] });
const previousCopy = () => ({
  version: ROUTE_DATA_VERSION - 1,
  coords: [ll([0, 0]), ll([0, 400])],
  steps: [{ type: 'depart' }, { type: 'arrive' }],
  previous: true,
});

async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const originalWarn = console.warn;
  globalThis.fetch = handler;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
    console.warn = originalWarn;
  }
}

const offline = async () => {
  throw new TypeError('Failed to fetch');
};

function services({ overpass = true } = {}) {
  return async (url) => {
    const host = new URL(String(url)).hostname;
    if (host === 'router.project-osrm.org') {
      return new Response(JSON.stringify({ code: 'Ok', routes: [sampleRoute()], waypoints: [] }));
    }
    if (overpass && host === 'overpass-api.de') return new Response(JSON.stringify({ elements: [] }));
    return new Response('{"error":"unavailable"}', { status: 503 });
  };
}

test('with no signal after an update, the copy saved by the previous version is used', async () => {
  const route = def('offline-update');
  await idbSet('routes', routeKey(centre, route, ROUTE_DATA_VERSION - 1), previousCopy());
  const data = await withFetch(offline, () => compileRoute(centre, route));
  assert.equal(data.previous, true);
});

test('Recalculate with no signal still reports the failure', async () => {
  const route = def('offline-recalc');
  await idbSet('routes', routeKey(centre, route, ROUTE_DATA_VERSION - 1), previousCopy());
  await withFetch(offline, () => assert.rejects(compileRoute(centre, route, { force: true })));
});

test('with no signal and no saved copy, preparing the route fails', async () => {
  await withFetch(offline, () => assert.rejects(compileRoute(centre, def('offline-new'))));
});

test('when road lookups are down, the previous copy beats roughly placed waypoints', async () => {
  const route = def('overpass-down');
  await idbSet('routes', routeKey(centre, route, ROUTE_DATA_VERSION - 1), previousCopy());
  const data = await withFetch(services({ overpass: false }), () => compileRoute(centre, route));
  assert.equal(data.previous, true);
  assert.equal(await idbGet('routes', routeKey(centre, route)), undefined, 'nothing saved, so it is tried again later');
});

test('a fresh route replaces the previous copy', async () => {
  const route = def('fresh');
  const oldKey = routeKey(centre, route, ROUTE_DATA_VERSION - 1);
  await idbSet('routes', oldKey, previousCopy());
  const data = await withFetch(services(), () => compileRoute(centre, route));
  assert.equal(data.version, ROUTE_DATA_VERSION);
  assert.ok(!data.previous);
  assert.ok(await idbGet('routes', routeKey(centre, route)));
  assert.equal(await idbGet('routes', oldKey), undefined);
});
