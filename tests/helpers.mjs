// Builders for synthetic routes in a local metric frame near Chilwell.

import { bearing, distance } from '../js/lib/geo.js';

export const ORIGIN = [-1.2383, 52.9047];

export function ll([x, y], origin = ORIGIN) {
  const lat = origin[1] + y / 111320;
  const lon = origin[0] + x / (111320 * Math.cos((origin[1] * Math.PI) / 180));
  return [lon, lat];
}

function pathLength(coords) {
  let d = 0;
  for (let i = 1; i < coords.length; i++) d += distance(coords[i - 1], coords[i]);
  return d;
}

/**
 * steps: [{ pts: [[x, y], ...], type, modifier?, exit?, name?, ref?, intersections? }]
 * Each step's first point is its manoeuvre location; consecutive steps share
 * their joining point (pass it as the first point of the next step).
 */
export function osrmRoute(stepDefs, { speed = 13, legs = null } = {}) {
  const mk = (def, i, all) => {
    const coords = def.pts.map((p) => ll(p));
    const prev = all[i - 1];
    const prevCoords = prev ? prev.pts.map((p) => ll(p)) : null;
    const bBefore = prevCoords && prevCoords.length > 1
      ? bearing(prevCoords[prevCoords.length - 2], prevCoords[prevCoords.length - 1]) : 0;
    const bAfter = coords.length > 1 ? bearing(coords[0], coords[1]) : 0;
    const dist = pathLength(coords);
    return {
      geometry: { type: 'LineString', coordinates: coords.length > 1 ? coords : [coords[0], coords[0]] },
      maneuver: {
        type: def.type,
        modifier: def.modifier,
        exit: def.exit,
        location: coords[0],
        bearing_before: Math.round(bBefore),
        bearing_after: Math.round(bAfter),
      },
      name: def.name || '',
      ref: def.ref,
      distance: dist,
      duration: dist / speed,
      driving_side: 'left',
      // Intersection definitions use local metres in `at`.
      intersections: def.intersections
        ? def.intersections.map(({ at, ...x }) => ({ ...x, location: ll(at) }))
        : [{ location: coords[0], bearings: [Math.round(bAfter)], entry: [true], out: 0 }],
    };
  };
  const groups = legs || [stepDefs];
  const legObjs = groups.map((g) => {
    const steps = g.map((d, i) => mk(d, i, g));
    return { steps, distance: steps.reduce((a, s) => a + s.distance, 0), duration: steps.reduce((a, s) => a + s.duration, 0) };
  });
  return {
    legs: legObjs,
    distance: legObjs.reduce((a, l) => a + l.distance, 0),
    duration: legObjs.reduce((a, l) => a + l.duration, 0),
  };
}

/**
 * A simple L-shaped test route:
 *   depart north on Eldon Road for 400 m,
 *   turn left (west) onto Barton Lane for 600 m,
 *   roundabout 2nd exit continuing west for 500 m,
 *   turn right (north) onto Swiney Way for 300 m, arrive.
 */
export function sampleRoute() {
  return osrmRoute([
    { pts: [[0, 0], [0, 200], [0, 400]], type: 'depart', name: 'Eldon Road' },
    { pts: [[0, 400], [-300, 400], [-600, 400]], type: 'turn', modifier: 'left', name: 'Barton Lane' },
    { pts: [[-600, 400], [-620, 410], [-640, 400], [-900, 400], [-1100, 400]], type: 'roundabout', modifier: 'straight', exit: 2, name: 'Nottingham Road', ref: 'A6005' },
    { pts: [[-1100, 400], [-1100, 550], [-1100, 700]], type: 'turn', modifier: 'right', name: 'Swiney Way' },
    { pts: [[-1100, 700], [-1100, 700]], type: 'arrive', name: 'Swiney Way' },
  ]);
}

/** Fixes every `step` metres along a RouteModel at `speed` m/s. */
export function* driveAlong(model, { from = 0, to = model.length, step = 13, speed = 13, t0 = 1_000_000, offset = 0 } = {}) {
  let t = t0;
  for (let d = from; d <= to; d += step) {
    const pt = model.pointAt(d);
    let p = pt.point;
    if (offset) {
      // shift sideways (to the right of travel) by `offset` metres
      const rad = ((pt.bearing + 90) * Math.PI) / 180;
      p = [p[0] + (Math.sin(rad) * offset) / (111320 * Math.cos((p[1] * Math.PI) / 180)), p[1] + (Math.cos(rad) * offset) / 111320];
    }
    yield { lon: p[0], lat: p[1], speed, heading: pt.bearing, accuracy: 6, time: t };
    t += (step / speed) * 1000;
  }
}
