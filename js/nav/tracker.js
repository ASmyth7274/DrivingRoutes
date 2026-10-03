// Matches GPS fixes to the route, tracks progress and detects leaving the route.
//
// States:
//   approach – navigation started but the car has not reached the route yet
//   on       – following the route
//   off      – off the route (caller should reroute)

import { angleDiff, clamp, distance, projectOnSegment, segmentIndexAt } from '../lib/geo.js';

const DEFAULTS = {
  onRouteMin: 22,        // metres: always on route within this distance
  onRouteMax: 50,        // cap for the accuracy-scaled on-route threshold
  offRouteMargin: 12,    // extra metres beyond the on-route threshold before counting as off
  offFixes: 3,           // consecutive off fixes needed
  offMillis: 2000,       // ...spanning at least this long
  farOff: 80,            // metres: two fixes this far away is enough
  wrongWayFixes: 4,      // fixes driving against the route direction
  maxAccuracy: 65,       // ignore off-route evidence from fixes worse than this
  approachTravel: 350,   // metres driven without joining before treating as off route
  approachWindow: 800,   // metres from the route start considered while approaching
  arriveDistance: 25,
};

export class Tracker {
  constructor(model, opts = {}) {
    this.model = model;
    this.o = { ...DEFAULTS, ...opts };
    this.state = opts.initialState || 'approach';
    this.along = opts.initialAlong || 0;
    this.offCount = 0;
    this.offSince = 0;
    this.wrongWay = 0;
    this.travelled = 0;
    this.lastFix = null;
    this.lastMatch = null;
    this.arrived = false;
  }

  /** Search segments covering along-range [from, to] for the best match. */
  match(p, from, to, heading, speed) {
    const { coords, cum, segBearing, length } = this.model;
    if (coords.length < 2) return null;
    const i0 = segmentIndexAt(cum, clamp(from, 0, length));
    const i1 = segmentIndexAt(cum, clamp(to, 0, length));
    const useHeading = heading != null && speed != null && speed > 3;
    let best = null;
    for (let i = i0; i <= i1; i++) {
      const pr = projectOnSegment(p, coords[i], coords[i + 1]);
      let cost = pr.distance;
      let hd = null;
      if (useHeading) {
        hd = Math.abs(angleDiff(segBearing[i], heading));
        if (hd > 110) cost += 60;
        else if (hd > 60) cost += ((hd - 60) / 50) * 15;
      }
      if (!best || cost < best.cost) {
        best = {
          cost,
          distance: pr.distance,
          along: cum[i] + pr.t * (cum[i + 1] - cum[i]),
          index: i,
          point: pr.point,
          headingDiff: hd,
        };
      }
    }
    return best;
  }

  /** Find the best match anywhere on the route (used to rejoin after going off). */
  matchAnywhere(p) {
    return this.match(p, 0, this.model.length, null, null);
  }

  update(fix) {
    const p = [fix.lon, fix.lat];
    const speed = fix.speed ?? 0;
    const heading = fix.heading ?? null;
    const acc = fix.accuracy ?? 20;
    const now = fix.time ?? Date.now();
    const dt = this.lastFix ? Math.max(0, (now - this.lastFix.time) / 1000) : 1;
    if (this.lastFix) this.travelled += distance(p, [this.lastFix.lon, this.lastFix.lat]);
    this.lastFix = { ...fix, time: now };

    const prevState = this.state;
    const L = this.model.length;
    let from;
    let to;
    if (this.state === 'approach') {
      from = 0;
      to = Math.min(L, this.o.approachWindow);
    } else if (this.state === 'off') {
      from = this.along - 150;
      to = this.along + 2000 + speed * dt * 2;
    } else {
      from = this.along - 30;
      to = this.along + Math.max(220, speed * 12) + speed * Math.max(0, dt - 1) * 1.5;
    }
    const m = this.match(p, from, to, heading, speed);
    this.lastMatch = m;

    const onThresh = clamp(acc * 0.9, this.o.onRouteMin, this.o.onRouteMax);
    const offThresh = onThresh + this.o.offRouteMargin;
    const goodFix = acc <= this.o.maxAccuracy;
    const againstRoute = !!(m && m.headingDiff != null && m.headingDiff > 135 && speed > 4);

    let event = null;
    if (m && m.distance <= onThresh && !againstRoute) {
      // On the route.
      if (this.state !== 'on') {
        this.along = m.along;
        event = prevState === 'off' ? 'rejoined' : 'joined';
      } else if (m.along > this.along) {
        this.along = m.along;
      }
      this.state = 'on';
      this.offCount = 0;
      this.wrongWay = 0;
    } else {
      if (againstRoute && m.distance <= offThresh) this.wrongWay++;
      else this.wrongWay = 0;

      const clearlyOff = !m || m.distance > offThresh;
      if ((clearlyOff || this.wrongWay > 0) && goodFix) {
        if (this.offCount === 0) this.offSince = now;
        this.offCount++;
      } else if (!clearlyOff) {
        // In the hysteresis band: keep following, but don't trust it for progress.
        this.offCount = Math.max(0, this.offCount - 1);
        if (this.state === 'on' && m.along > this.along && m.along - this.along < 60) this.along = m.along;
      }

      if (this.state === 'on') {
        const offLongEnough = (this.offCount >= this.o.offFixes && now - this.offSince >= this.o.offMillis) ||
          (this.offCount >= 2 && m && m.distance > Math.max(this.o.farOff, offThresh * 2));
        if ((clearlyOff && offLongEnough) || this.wrongWay >= this.o.wrongWayFixes) {
          this.state = 'off';
          event = this.wrongWay >= this.o.wrongWayFixes ? 'wrongway' : 'offroute';
        }
      } else if (this.state === 'approach') {
        if (this.travelled > this.o.approachTravel && clearlyOff && this.offCount >= this.o.offFixes) {
          this.state = 'off';
          event = 'offroute';
        }
      }
    }

    if (this.state === 'on' && !this.arrived && L - this.along <= this.o.arriveDistance) {
      this.arrived = true;
      event = 'arrived';
    }

    return {
      state: this.state,
      event,
      along: this.along,
      distanceFromRoute: m ? m.distance : Infinity,
      matchPoint: m ? m.point : null,
      matchAlong: m ? m.along : null,
      accuracy: acc,
    };
  }
}
