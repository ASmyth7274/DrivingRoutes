// Test routes shouldn't ask you to turn round in the road. When a router
// answer contains a U-turn, try small changes to the waypoints and keep the
// best version:
//   1. set off the other way (for a U-turn straight after the start),
//   2. let a nearby waypoint be driven in either direction,
//   3. leave that waypoint out,
//   4. keep going past the turning point and find a way round.

import { destination } from '../lib/geo.js';
import { isUturnStep, RouteModel } from '../nav/route-model.js';
import { route as defaultRoute } from './router.js';

export function uturnSteps(data) {
  return (data.steps || []).filter(isUturnStep);
}

/** Alternative point lists that might avoid the first U-turn. */
export function uturnFixes(points, data) {
  const model = new RouteModel(data);
  const u = model.steps.find(isUturnStep);
  if (!u) return [];
  const out = [];
  // Turning round just after setting off: set off the other way instead.
  if (u.along < 250 && u.bearingAfter != null) {
    out.push({ why: 'start', points: points.map((p, i) => (i === 0 ? { ...p, bearing: u.bearingAfter, bearingRange: 60 } : p)) });
  }
  const nearby = model.vias
    .map((v) => ({ v, gap: v.along - u.along }))
    .filter(({ gap }) => gap > -700 && gap < 250)
    .sort((a, b) => Math.abs(a.gap) * (a.gap > 0 ? 1.5 : 1) - Math.abs(b.gap) * (b.gap > 0 ? 1.5 : 1));
  for (const { v } of nearby.slice(0, 2)) {
    const pi = v.index + 1; // points[0] is the start
    if (pi <= 0 || pi >= points.length - 1) continue;
    if (points[pi].bearing != null) {
      out.push({ why: 'relax', points: points.map((p, i) => (i === pi ? { ...p, bearing: null } : p)) });
    }
    out.push({ why: 'drop', points: points.filter((_, i) => i !== pi) });
  }
  const b = u.bearingBefore ?? model.bearingAt(Math.max(0, u.along - 10));
  const ahead = destination(u.location, b, 60);
  const insertAt = model.vias.filter((v) => v.along <= u.along).length + 1;
  out.push({
    why: 'ahead',
    points: [...points.slice(0, insertAt), { lon: ahead[0], lat: ahead[1], bearing: b, bearingRange: 35 }, ...points.slice(insertAt)],
  });
  return out;
}

/**
 * Route through `points`, repairing U-turns where possible.
 * Returns { data, points, uturns } – the chosen route, the waypoints used and
 * how many U-turns are left.
 */
export async function routeAvoidingUturns(points, {
  rounds = 4,
  maxExtra = 0.35,
  signal,
  router = defaultRoute,
} = {}) {
  const first = await router(points, { signal });
  let best = { points, data: first, uturns: uturnSteps(first).length };
  const limit = first.distance * (1 + maxExtra) + 1500;
  for (let round = 0; round < rounds && best.uturns > 0; round++) {
    let improved = false;
    for (const fix of uturnFixes(best.points, best.data)) {
      let data;
      try {
        data = await router(fix.points, { signal, strict: true });
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        continue;
      }
      const n = uturnSteps(data).length;
      if (n < best.uturns && data.distance <= limit) {
        best = { points: fix.points, data, uturns: n };
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return best;
}
