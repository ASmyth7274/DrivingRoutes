// Turns a route definition (waypoints) into a ready-to-drive RouteData,
// cached on the device so routes work offline once prepared.

import { distance } from '../lib/geo.js';
import { idbDelete, idbGet, idbKeys, idbSet } from '../lib/idb.js';
import { isUturnStep, ROUTE_DATA_VERSION } from '../nav/route-model.js';
import { resolveWaypoints } from './snapper.js';
import { fetchSpeedLimits } from './speedlimits.js';
import { routeAvoidingUturns } from './uturns.js';

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function routeEndpoints(centre, route) {
  const start = route.start || centre.start || centre.location;
  const end = route.end || centre.end || start;
  return { start, end };
}

export function routeKey(centre, route, version = ROUTE_DATA_VERSION) {
  const { start, end } = routeEndpoints(centre, route);
  const sig = JSON.stringify({ v: version, start, end, sb: centre.startBearing ?? null, w: route.waypoints || [] });
  return `${centre.id}/${route.id}/${hashString(sig)}`;
}

// Oldest saved route format the current navigation code can still drive.
const OLDEST_USABLE_VERSION = 2;

/** This route as saved by an earlier version of the app, if it's still on the phone. */
export async function olderCompiled(centre, route) {
  for (let v = ROUTE_DATA_VERSION - 1; v >= OLDEST_USABLE_VERSION; v--) {
    try {
      const data = await idbGet('routes', routeKey(centre, route, v));
      if (data?.coords?.length && data.steps?.length) return data;
    } catch {
      return null;
    }
  }
  return null;
}

async function dropOlder(centre, route) {
  for (let v = ROUTE_DATA_VERSION - 1; v >= OLDEST_USABLE_VERSION; v--) {
    await idbDelete('routes', routeKey(centre, route, v)).catch(() => {});
  }
}

export async function getCompiled(centre, route) {
  const data = await idbGet('routes', routeKey(centre, route));
  return data && data.version === ROUTE_DATA_VERSION ? data : null;
}

export async function clearCompiled(centre, route) {
  if (!route) {
    const keys = await idbKeys('routes');
    await Promise.all(keys.filter((k) => String(k).startsWith(`${centre.id}/`)).map((k) => idbDelete('routes', k)));
    return;
  }
  const keys = await idbKeys('routes');
  await Promise.all(keys.filter((k) => String(k).startsWith(`${centre.id}/${route.id}/`)).map((k) => idbDelete('routes', k)));
}

/** Sanity checks that flag waypoints which probably need moving. */
export function qualityWarnings(data, resolved = []) {
  const out = [];
  data.steps.filter(isUturnStep).forEach((s) => {
    out.push(`Includes a U-turn${s.name ? ` on ${s.name}` : ''} that couldn't be designed out. Use "Edit a copy" to move the waypoints nearby.`);
  });
  const missing = resolved.filter((r) => r.status === 'missing');
  if (missing.length) {
    out.push(`Couldn't find ${missing.map((r) => `"${r.road}"`).join(', ')} on the map, so ${missing.length === 1 ? 'that waypoint was' : 'those waypoints were'} skipped.`);
  }
  if (resolved.some((r) => r.status === 'raw')) {
    out.push('The road-matching service was unavailable, so waypoints were used as plotted. Try "Recalculate route" later.');
  }
  return out;
}

/**
 * @param {object} centre
 * @param {object} route definition { id, waypoints: [{ at, road?, ref?, bearing? }] }
 * @param {{ force?: boolean, onProgress?: (msg: string) => void, signal?: AbortSignal }} opts
 */
export async function compileRoute(centre, route, opts = {}) {
  const key = routeKey(centre, route);
  if (!opts.force) {
    const cached = await idbGet('routes', key);
    if (cached && cached.version === ROUTE_DATA_VERSION) return cached;
  }
  const progress = opts.onProgress || (() => {});
  const { start, end } = routeEndpoints(centre, route);

  // After an app update, routes are worked out again. Until that can happen
  // (no signal, or the map services are down) the previous copy is used.
  const previous = async () => (opts.force ? null : olderCompiled(centre, route));

  let resolved;
  let best;
  try {
    progress('Finding the roads…');
    resolved = await resolveWaypoints(route.waypoints || [], { signal: opts.signal });

    progress('Working out the route…');
    const points = [
      { lon: start[0], lat: start[1], bearing: route.startBearing ?? centre.startBearing ?? null },
      ...resolved.filter((r) => r.status !== 'missing').map((r) => ({ lon: r.lon, lat: r.lat, bearing: r.bearing })),
      { lon: end[0], lat: end[1] },
    ];
    // Drop consecutive duplicates; routers dislike zero-length legs.
    const clean = points.filter((p, i) => i === 0 || distance([p.lon, p.lat], [points[i - 1].lon, points[i - 1].lat]) > 3);
    if (clean.length < 2) clean.push(points[points.length - 1]);
    // Avoids U-turns in the road where it can (tries a few waypoint tweaks).
    best = await routeAvoidingUturns(clean, { signal: opts.signal });
  } catch (err) {
    const old = err?.name === 'AbortError' ? null : await previous();
    if (old) return old;
    throw err;
  }
  // Road lookups failed, so the waypoints are only roughly placed: the previous copy is better.
  const raw = resolved.some((r) => r.status === 'raw');
  if (raw) {
    const old = await previous();
    if (old) return old;
  }
  const data = best.data;

  data.warnings = qualityWarnings(data, resolved);
  data.key = key;
  data.centreId = centre.id;
  data.routeId = route.id;

  progress('Adding speed limits…');
  try {
    data.speedLimits = await fetchSpeedLimits(data.coords, { signal: opts.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    console.warn('Speed limits unavailable', err);
    data.speedLimits = null;
  }

  await idbSet('routes', key, data);
  if (!raw) await dropOlder(centre, route);
  return data;
}
