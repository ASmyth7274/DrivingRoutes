// Converts router responses into compact RouteData and wraps RouteData in a
// RouteModel with the lookups the navigator needs.
//
// RouteData (serialisable, cached in IndexedDB):
// {
//   version, provider, createdAt,
//   coords: [[lon, lat], ...],
//   distance, duration,
//   steps: [{ type, modifier, exit, name, ref, destinations, rotaryName,
//             location, bearingBefore, bearingAfter, drivingSide,
//             start (coord index), distance, duration, intersections }],
//   vias: [{ location, index }],           // waypoints the route passes through
//   speedLimits: [{ from, to, mph }] | null, // coordinate index ranges
//   warnings: [string]
// }

import {
  angleDiff, bearing, cumulativeDistances, distance, nearestOnLine, pointAlong,
  round6, segmentBearings, segmentIndexAt,
} from '../lib/geo.js';
import { decodePolyline } from '../lib/polyline.js';

export const ROUTE_DATA_VERSION = 3;

export const ROUNDABOUT_TYPES = new Set(['roundabout', 'rotary', 'roundabout turn']);

/** Typical turn angle for each OSRM direction modifier (negative = left). */
export const MOD_ANGLE = {
  'straight': 0,
  'slight right': 40,
  'right': 90,
  'sharp right': 140,
  'uturn': 180,
  'slight left': -40,
  'left': -90,
  'sharp left': -140,
};

/** Exit direction of a roundabout step relative to the way in (negative = left). */
export function roundaboutAngle(step) {
  if (step.exitAngle != null) return step.exitAngle;
  if (MOD_ANGLE[step.modifier] != null) return MOD_ANGLE[step.modifier];
  if (step.exit) return [-90, 0, 90, 180][Math.min(3, step.exit - 1)];
  return 0;
}

/** A step that asks the driver to turn round in the road (not a roundabout). */
export function isUturnStep(step) {
  return step.modifier === 'uturn' && !ROUNDABOUT_TYPES.has(step.type) &&
    step.type !== 'arrive' && step.type !== 'depart' && !String(step.type).startsWith('exit ');
}

/**
 * Direction of the road you leave a roundabout on, found from the route's
 * shape: going round the ring keeps turning one way (right, clockwise, when
 * driving on the left) and leaving it is a turn the other way.
 * Returns a bearing in degrees, or null if the exit can't be seen.
 */
export function roundaboutExitBearing(coords, from, to, drivingSide = 'left') {
  const ring = drivingSide === 'right' ? -1 : 1;
  const pts = [];
  let d = 0;
  for (let i = from; i <= Math.min(to, coords.length - 1); i++) {
    if (pts.length) {
      const seg = distance(pts[pts.length - 1].p, coords[i]);
      if (seg < 0.3) continue;
      d += seg;
    }
    pts.push({ p: coords[i], d });
    if (d > 800) break;
  }
  if (pts.length < 3) return null;
  for (let k = 1; k < pts.length - 1; k++) {
    if (pts[k].d < 6) continue;
    const bIn = bearing(pts[k - 1].p, pts[k].p);
    let j = k + 1;
    while (j < pts.length - 1 && pts[j].d - pts[k].d < 25) j++;
    const turn = angleDiff(bIn, bearing(pts[k].p, pts[j].p)) * ring;
    if (turn < -30) {
      // The exit is the sharpest turn away from the ring in this stretch.
      let best = k;
      let bestTurn = 0;
      for (let v = k; v < j; v++) {
        const t = angleDiff(bearing(pts[v - 1].p, pts[v].p), bearing(pts[v].p, pts[v + 1].p)) * ring;
        if (t < bestTurn) {
          bestTurn = t;
          best = v;
        }
      }
      let e = best + 1;
      while (e < pts.length - 1 && pts[e].d - pts[best].d < 30) e++;
      return bearing(pts[best].p, pts[e].p);
    }
  }
  return null;
}

function stepGeometry(geometry, precision) {
  if (!geometry) return [];
  if (typeof geometry === 'string') return decodePolyline(geometry, precision);
  if (Array.isArray(geometry.coordinates)) return geometry.coordinates;
  return [];
}

function compactIntersections(list) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => {
    const o = {
      location: x.location ? round6(x.location) : null,
      bearings: x.bearings || [],
      entry: x.entry || [],
      in: x.in ?? null,
      out: x.out ?? null,
    };
    if (Array.isArray(x.lanes) && x.lanes.length) {
      o.lanes = x.lanes.map((l) => ({ indications: l.indications || [], valid: !!l.valid, active: l.active }));
    }
    return o;
  });
}

const MERGE_INTO_PREVIOUS = new Set(['exit roundabout', 'exit rotary', 'notification', 'use lane']);

/**
 * Normalise an OSRM-style route object (OSRM itself, or Valhalla with
 * format=osrm). Multi-leg routes are stitched into one continuous list of
 * manoeuvres so that waypoints do not produce "you have arrived" prompts.
 */
export function normalizeOsrmRoute(route, { provider = 'osrm', precision = 5, vias = [] } = {}) {
  const coords = [];
  const steps = [];
  const legs = route.legs || [];

  const append = (g) => {
    for (const p of g) {
      const last = coords[coords.length - 1];
      if (last && Math.abs(last[0] - p[0]) < 1e-7 && Math.abs(last[1] - p[1]) < 1e-7) continue;
      coords.push(round6(p));
    }
  };

  let arriveBearing = null;
  legs.forEach((leg, li) => {
    const lastLeg = li === legs.length - 1;
    (leg.steps || []).forEach((s) => {
      const g = stepGeometry(s.geometry, precision);
      let start = coords.length ? coords.length - 1 : 0;
      if (g.length && coords.length) {
        const last = coords[coords.length - 1];
        if (distance(last, g[0]) > 1) start = coords.length; // geometry does not join; new start point
      }
      append(g);
      const m = s.maneuver || {};
      const type = m.type || 'turn';
      const prev = steps[steps.length - 1];

      if (type === 'arrive' && !lastLeg) {
        arriveBearing = m.bearing_before ?? null;
        return;
      }
      // The router turned round at a waypoint: make that a real, announced U-turn.
      const reversedAtVia = type === 'depart' && li > 0 && arriveBearing != null && m.bearing_after != null &&
        Math.abs(angleDiff(arriveBearing, m.bearing_after)) > 150;
      if (reversedAtVia) {
        steps.push({
          type: 'continue',
          modifier: 'uturn',
          exit: null,
          bearingBefore: arriveBearing,
          bearingAfter: m.bearing_after,
          location: round6(m.location || g[0] || [0, 0]),
          name: (s.name || '').trim(),
          ref: (s.ref || '').trim(),
          destinations: '',
          rotaryName: '',
          drivingSide: s.driving_side || 'left',
          start: Math.min(start, Math.max(0, coords.length - 1)),
          distance: s.distance || 0,
          duration: s.duration || 0,
          intersections: compactIntersections(s.intersections).slice(1),
          atWaypoint: true,
        });
        return;
      }
      if ((type === 'depart' && li > 0 && prev) || (MERGE_INTO_PREVIOUS.has(type) && prev)) {
        prev.distance += s.distance || 0;
        prev.duration += s.duration || 0;
        const ints = compactIntersections(s.intersections);
        prev.intersections.push(...(type === 'depart' ? ints.slice(1) : ints));
        return;
      }
      steps.push({
        type,
        modifier: m.modifier || null,
        exit: m.exit ?? null,
        bearingBefore: m.bearing_before ?? null,
        bearingAfter: m.bearing_after ?? null,
        location: round6(m.location || g[0] || [0, 0]),
        name: (s.name || '').trim(),
        ref: (s.ref || '').trim(),
        destinations: s.destinations || '',
        rotaryName: s.rotary_name || '',
        drivingSide: s.driving_side || 'left',
        start: Math.min(start, Math.max(0, coords.length - 1)),
        distance: s.distance || 0,
        duration: s.duration || 0,
        intersections: compactIntersections(s.intersections),
      });
    });
  });

  return {
    version: ROUTE_DATA_VERSION,
    provider,
    createdAt: Date.now(),
    coords,
    distance: route.distance ?? 0,
    duration: route.duration ?? 0,
    steps,
    vias: vias.map((v, i) => ({ location: round6(v), index: i })),
    speedLimits: null,
    warnings: [],
  };
}

/** Steps that deserve a banner and a voice prompt. */
export function isAnnounced(step) {
  switch (step.type) {
    case 'depart':
      return false;
    case 'new name':
      return ['left', 'right', 'sharp left', 'sharp right', 'uturn'].includes(step.modifier);
    case 'continue':
      return step.modifier != null && step.modifier !== 'straight';
    default:
      return true;
  }
}

export class RouteModel {
  constructor(data) {
    this.data = data;
    this.coords = data.coords;
    this.cum = cumulativeDistances(this.coords);
    this.length = this.cum[this.cum.length - 1] || 0;
    this.segBearing = segmentBearings(this.coords);
    this.steps = (data.steps || []).map((s, i) => ({
      ...s,
      index: i,
      along: this.cum[Math.min(s.start ?? 0, this.coords.length - 1)] || 0,
    }));
    // Each step spans from its manoeuvre to the next manoeuvre.
    for (let i = 0; i < this.steps.length; i++) {
      const next = this.steps[i + 1];
      this.steps[i].end = next ? next.along : this.length;
      this.steps[i].geomLength = Math.max(0, this.steps[i].end - this.steps[i].along);
    }
    // Which way each roundabout really goes (OSRM's bearing_after only says
    // which way you turn onto the ring, so it can't be used for that).
    for (let i = 0; i < this.steps.length; i++) {
      const st = this.steps[i];
      if (!ROUNDABOUT_TYPES.has(st.type)) continue;
      const toIdx = this.steps[i + 1]?.start ?? this.coords.length - 1;
      const exitBrg = st.bearingBefore != null
        ? roundaboutExitBearing(this.coords, st.start ?? 0, toIdx, st.drivingSide)
        : null;
      if (exitBrg != null) st.exitAngle = angleDiff(st.bearingBefore, exitBrg);
      else if (MOD_ANGLE[st.modifier] != null) st.exitAngle = MOD_ANGLE[st.modifier];
      else if (st.exit) st.exitAngle = [-90, 0, 90, 180][Math.min(3, st.exit - 1)];
      else st.exitAngle = 0;
    }
    this.announced = this.steps.filter(isAnnounced);
    this.vias = this._projectVias(data.vias || []);
    this.limits = this._buildLimits(data.speedLimits);
    this.sideRoads = this._buildSideRoads();
  }

  get start() { return this.coords[0]; }
  get end() { return this.coords[this.coords.length - 1]; }
  get duration() { return this.data.duration || 0; }

  pointAt(along) {
    return pointAlong(this.coords, this.cum, along, this.segBearing);
  }

  bearingAt(along) {
    return this.segBearing[segmentIndexAt(this.cum, along)] ?? 0;
  }

  /** Index into this.steps of the step being driven at `along`. */
  stepIndexAt(along) {
    let lo = 0;
    let hi = this.steps.length - 1;
    if (hi < 0) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.steps[mid].along <= along) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /** Next announced step whose manoeuvre point is ahead of `along`. */
  nextAnnounced(along, skip = 0) {
    let seen = 0;
    for (const s of this.announced) {
      if (s.along > along + 2) {
        if (seen === skip) return s;
        seen++;
      }
    }
    return null;
  }

  /** Seconds remaining, using the router's per-step durations. */
  remainingDuration(along) {
    const idx = this.stepIndexAt(along);
    if (idx < 0) return 0;
    let total = 0;
    for (let i = idx; i < this.steps.length; i++) {
      const s = this.steps[i];
      if (i === idx) {
        const frac = s.geomLength > 0 ? Math.max(0, Math.min(1, (s.end - along) / s.geomLength)) : 0;
        total += s.duration * frac;
      } else {
        total += s.duration;
      }
    }
    return total;
  }

  /** Attach speed limits fetched after the route was built (e.g. after a reroute). */
  setSpeedLimits(ranges) {
    this.data.speedLimits = ranges;
    this.limits = this._buildLimits(ranges);
  }

  /** Speed limit in mph at `along`, or null if unknown. */
  speedLimitAt(along) {
    if (!this.limits) return null;
    const i = segmentIndexAt(this.cum, along);
    return this.limits[i] ?? null;
  }

  /** Typical router speed (m/s) for the step containing `along`. */
  roadSpeedAt(along) {
    const idx = this.stepIndexAt(along);
    const s = this.steps[idx];
    if (!s || !s.duration || !s.distance) return null;
    return s.distance / s.duration;
  }

  _projectVias(vias) {
    const out = [];
    let fromIdx = 0;
    for (const v of vias) {
      const near = nearestOnLine(this.coords, this.cum, v.location, fromIdx);
      if (!near) continue;
      out.push({ ...v, along: near.along, offset: near.distance });
      fromIdx = near.index;
    }
    return out;
  }

  _buildLimits(ranges) {
    if (!Array.isArray(ranges) || !ranges.length) return null;
    const n = Math.max(0, this.coords.length - 1);
    const limits = new Array(n).fill(null);
    for (const r of ranges) {
      for (let i = Math.max(0, r.from); i < Math.min(n, r.to); i++) limits[i] = r.mph;
    }
    return limits;
  }

  /**
   * Junctions passed between manoeuvres, with the number of enterable side
   * roads on each side. Used for examiner-style "take the second road on
   * the left" directions.
   */
  _buildSideRoads() {
    const out = [];
    for (let si = 0; si < this.steps.length; si++) {
      const s = this.steps[si];
      const ints = s.intersections || [];
      const startIdx = Math.min(s.start ?? 0, this.coords.length - 1);
      const endIdx = Math.min(this.steps[si + 1]?.start ?? this.coords.length - 1, this.coords.length - 1);
      for (let k = 1; k < ints.length; k++) {
        const x = ints[k];
        if (!x.location || x.out == null || !x.bearings.length) continue;
        const travel = x.in != null ? (x.bearings[x.in] + 180) % 360 : x.bearings[x.out];
        let left = 0;
        let right = 0;
        x.bearings.forEach((b, j) => {
          if (j === x.in || j === x.out || !x.entry[j]) return;
          const rel = angleDiff(travel, b);
          if (rel < -25 && rel > -155) left++;
          else if (rel > 25 && rel < 155) right++;
        });
        if (!left && !right) continue;
        const near = nearestOnLine(this.coords, this.cum, x.location, startIdx, Math.max(endIdx, startIdx + 1) + 1);
        if (!near) continue;
        out.push({ along: near.along, left, right });
      }
    }
    out.sort((a, b) => a.along - b.along);
    return out;
  }

  /** Number of side roads on `side` strictly between two along-distances. */
  sideRoadsBetween(fromAlong, toAlong, side) {
    let n = 0;
    for (const r of this.sideRoads) {
      if (r.along > fromAlong + 3 && r.along < toAlong - 8) n += side === 'left' ? r.left : r.right;
    }
    return n;
  }
}
