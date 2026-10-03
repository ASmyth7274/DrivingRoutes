// A navigation session: GPS fixes in, guidance state and voice prompts out.
// Handles leaving the route by rerouting back onto the remaining test route,
// and keeps guiding with a "head back to the route" arrow when offline.

import { bearing, distance } from '../lib/geo.js';
import { Emitter } from '../lib/events.js';
import { mph } from '../lib/units.js';
import { Guidance } from './guidance.js';
import { RouteModel } from './route-model.js';
import { Tracker } from './tracker.js';

const REROUTE_MIN_INTERVAL = 6000;
const REROUTE_RETRY = 15000;

export class NavSession extends Emitter {
  /**
   * @param {object} o
   * @param {object} o.data RouteData
   * @param {(points: Array, opts: object) => Promise<object>} o.rerouter
   * @param {(text: string, opts?: object) => void} o.speak
   * @param {object} [o.settings] { voiceStyle, units, speedWarnings, speedTolerance, spokenNotes, autoReroute }
   * @param {Array} [o.notes] [{ at: [lon, lat], text, radius }]
   * @param {string} [o.destination] e.g. "the test centre"
   */
  constructor(o) {
    super();
    this.rerouter = o.rerouter;
    this.speak = o.speak || (() => {});
    this.settings = {
      voiceStyle: 'satnav',
      units: 'imperial',
      speedWarnings: true,
      speedTolerance: 2,
      spokenNotes: true,
      autoReroute: true,
      ...(o.settings || {}),
    };
    this.destination = o.destination || null;
    this.parkAtDestination = o.parkAtDestination !== false;
    this.notes = (o.notes || []).map((n) => ({ radius: 180, ...n, alerted: false }));
    this.originalData = o.data;
    this.rerouteCount = 0;
    this.modelVersion = 0;
    this.status = 'approach';
    this.rerouting = false;
    this.lastRerouteAt = 0;
    this.retryTimer = null;
    this.lastFix = null;
    this.overSince = 0;
    this.lastSpeedWarning = 0;
    this.ended = false;
    this.joinedOnce = false;
    this._install(o.data);
  }

  _install(data, trackerOpts = {}) {
    this.lastResult = null;
    this.lastGuidance = null;
    this.model = new RouteModel(data);
    this.tracker = new Tracker(this.model, trackerOpts);
    this.guidance = new Guidance(this.model, {
      style: this.settings.voiceStyle,
      units: this.settings.units,
      destination: this.destination,
      parkAtDestination: this.parkAtDestination,
    });
    this.modelVersion++;
  }

  setSettings(patch) {
    Object.assign(this.settings, patch);
    if (this.guidance) {
      this.guidance.style = this.settings.voiceStyle;
      this.guidance.units = this.settings.units;
    }
  }

  /** Distance from a point to the start of the route. */
  distanceToStart(p) {
    return distance(p, this.model.start);
  }

  /**
   * Build a new route from `fix` that rejoins the test route.
   * mode 'continue' – rejoin at the next waypoint ahead of current progress
   * mode 'start'    – go to the route start and then drive the whole route
   * mode 'nearest'  – join at the waypoints after the nearest point on the route
   */
  async reroute(fix, mode = 'continue') {
    if (this.ended || this.rerouting || !this.rerouter) return false;
    const now = Date.now();
    if (now - this.lastRerouteAt < REROUTE_MIN_INTERVAL && mode === 'continue') {
      this._scheduleRetry(REROUTE_MIN_INTERVAL - (now - this.lastRerouteAt));
      return false;
    }
    clearTimeout(this.retryTimer);
    this.rerouting = true;
    this.lastRerouteAt = now;
    const prevStatus = this.status;
    this.status = 'rerouting';
    this._emitUpdate();

    const model = this.model;
    let fromAlong = this.tracker.along;
    if (mode === 'nearest') {
      const m = this.tracker.matchAnywhere([fix.lon, fix.lat]);
      fromAlong = m ? m.along : 0;
    }
    let vias = model.vias.filter((v) => v.along > fromAlong + 150).map((v) => v.location);
    if (mode === 'start') vias = [model.start, ...model.vias.map((v) => v.location)];
    const end = model.end;
    const heading = fix.heading != null && (fix.speed ?? 0) > 2 ? fix.heading : null;
    const points = [
      { lon: fix.lon, lat: fix.lat, bearing: heading },
      ...vias.map(([lon, lat]) => ({ lon, lat })),
      { lon: end[0], lat: end[1] },
    ];

    try {
      const data = await this.rerouter(points, { reason: mode });
      if (this.ended) return false;
      // If the driver found their own way back while we were waiting, keep the old route.
      if (mode === 'continue' && this.tracker.state === 'on') {
        this.status = 'on';
        this._emitUpdate();
        return false;
      }
      this.rerouteCount++;
      this._install(data, { initialState: 'approach', approachWindow: 300, approachTravel: 250 });
      this.status = 'approach';
      const startSpeech = this.guidance.startSpeech(0);
      this.speak(startSpeech, { priority: 'high' });
      this.emit('rerouted', { mode });
      this._emitUpdate();
      return true;
    } catch (err) {
      console.warn('Reroute failed', err);
      if (this.ended) return false;
      this.status = prevStatus === 'approach' && mode !== 'continue' ? 'approach' : 'off';
      this.rerouteError = err?.message || String(err);
      if (this.status === 'off') this._scheduleRetry(REROUTE_RETRY);
      this._emitUpdate();
      return false;
    } finally {
      this.rerouting = false;
    }
  }

  _scheduleRetry(ms) {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (!this.ended && this.status === 'off' && this.lastFix && this.settings.autoReroute) {
        this.reroute(this.lastFix, 'continue');
      }
    }, Math.max(1000, ms));
  }

  handleFix(fix) {
    if (this.ended) return;
    this.lastFix = fix;
    const r = this.tracker.update(fix);
    this.lastResult = r;

    switch (r.event) {
      case 'joined':
        this.status = 'on';
        if (!this.joinedOnce) {
          this.joinedOnce = true;
          if (this.modelVersion === 1) this.speak(this.guidance.startSpeech(r.along));
        }
        break;
      case 'rejoined':
        clearTimeout(this.retryTimer);
        this.status = 'on';
        this.speak('Back on route.', { priority: 'high' });
        break;
      case 'offroute':
      case 'wrongway':
        this.status = 'off';
        this.emit('offroute', { reason: r.event });
        if (this.settings.autoReroute) this.reroute(fix, 'continue');
        break;
      case 'arrived':
        break;
      default:
        if (!this.rerouting) {
          if (r.state === 'on') this.status = 'on';
          else if (r.state === 'off') this.status = 'off';
        }
    }

    if (r.state === 'on' || r.event === 'arrived') {
      const g = this.guidance.update(r.along, fix.speed ?? 0);
      this.lastGuidance = g;
      if (g.speech) this.speak(g.speech);
    } else if (r.state === 'approach') {
      this.lastGuidance = this.guidance.peek(0);
    }

    if (this.tracker.arrived) {
      this.status = 'arrived';
      if (!this.arrivedEmitted) {
        this.arrivedEmitted = true;
        this.emit('arrived', {});
      }
    }

    this._checkNotes(fix);
    this._checkSpeed(fix, r);
    this._emitUpdate();
  }

  _checkNotes(fix) {
    if (!this.settings.spokenNotes) return;
    const p = [fix.lon, fix.lat];
    for (const n of this.notes) {
      if (n.alerted) continue;
      const d = distance(p, n.at);
      if (d <= n.radius) {
        n.alerted = true;
        this.emit('note', n);
        this.speak(n.text);
      }
    }
  }

  _checkSpeed(fix, r) {
    if (!this.settings.speedWarnings || r.state !== 'on') {
      this.overSince = 0;
      return;
    }
    const limit = this.model.speedLimitAt(r.along);
    const v = mph(fix.speed);
    if (!limit || v == null) {
      this.overSince = 0;
      return;
    }
    const now = fix.time ?? Date.now();
    if (v > limit + this.settings.speedTolerance) {
      if (!this.overSince) this.overSince = now;
      if (now - this.overSince > 3000 && now - this.lastSpeedWarning > 45000) {
        this.lastSpeedWarning = now;
        this.speak(`Check your speed. The limit is ${limit}.`);
      }
    } else {
      this.overSince = 0;
    }
  }

  snapshot() {
    const r = this.lastResult;
    const fix = this.lastFix;
    const model = this.model;
    const along = this.tracker.along;
    const g = this.lastGuidance;
    const onRoute = this.status === 'on' || this.status === 'arrived';
    const snap = {
      status: this.status,
      modelVersion: this.modelVersion,
      model,
      along,
      length: model.length,
      remainingDistance: Math.max(0, model.length - along),
      remainingDuration: model.remainingDuration(along),
      next: g?.next || model.nextAnnounced(along),
      nextDistance: g?.next ? g.distance : null,
      then: g?.then || null,
      speed: fix?.speed ?? null,
      speedLimit: onRoute ? model.speedLimitAt(along) : null,
      overLimit: !!this.overSince,
      fix,
      rerouteCount: this.rerouteCount,
      rerouteError: this.rerouteError || null,
    };
    if (fix) {
      const p = [fix.lon, fix.lat];
      if (onRoute) {
        const pt = model.pointAt(along);
        snap.position = pt.point;
        snap.bearing = pt.bearing;
      } else {
        snap.position = p;
        snap.bearing = fix.heading;
      }
      if (this.status === 'approach') {
        const target = r?.matchPoint && r.distanceFromRoute < 400 ? r.matchPoint : model.start;
        snap.target = { point: target, distance: distance(p, target), bearing: bearing(p, target) };
      } else if (this.status === 'off' || this.status === 'rerouting') {
        const m = this.tracker.matchAnywhere(p);
        if (m) snap.target = { point: m.point, distance: m.distance, bearing: bearing(p, m.point) };
      }
    }
    return snap;
  }

  _emitUpdate() {
    this.emit('update', this.snapshot());
  }

  end() {
    this.ended = true;
    clearTimeout(this.retryTimer);
    this.status = 'ended';
  }
}
