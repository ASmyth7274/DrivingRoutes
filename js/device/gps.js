// Position sources: the phone's GPS, and a simulator that drives the route
// (for previewing a route at home and for testing).

import { bearing, destination, distance } from '../lib/geo.js';
import { Emitter } from '../lib/events.js';

/** Fill in speed/heading from the previous fix when the device doesn't supply them. */
function enrich(fix, prev) {
  if (!prev) return fix;
  const dt = (fix.time - prev.time) / 1000;
  if (dt <= 0 || dt > 10) return fix;
  const d = distance([prev.lon, prev.lat], [fix.lon, fix.lat]);
  if (fix.speed == null) fix.speed = d / dt;
  if (fix.heading == null && d > 3 && (fix.speed ?? 0) > 1.5) fix.heading = bearing([prev.lon, prev.lat], [fix.lon, fix.lat]);
  return fix;
}

export class GeoSource extends Emitter {
  constructor() {
    super();
    this.watchId = null;
    this.last = null;
    this.kind = 'gps';
  }

  get supported() {
    return typeof navigator !== 'undefined' && 'geolocation' in navigator;
  }

  start() {
    if (!this.supported || this.watchId != null) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const fix = {
          lon: c.longitude,
          lat: c.latitude,
          accuracy: c.accuracy,
          speed: c.speed != null && c.speed >= 0 && !Number.isNaN(c.speed) ? c.speed : null,
          heading: c.heading != null && !Number.isNaN(c.heading) && c.heading >= 0 && (c.speed ?? 0) > 0.8 ? c.heading : null,
          time: pos.timestamp || Date.now(),
        };
        enrich(fix, this.last);
        this.last = fix;
        this.emit('fix', fix);
      },
      (err) => this.emit('error', err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  /** One-off position, resolves to a fix or rejects. */
  static current(timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Location is not available on this device'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lon: pos.coords.longitude, lat: pos.coords.latitude, accuracy: pos.coords.accuracy, time: pos.timestamp }),
        (err) => reject(err),
        { enableHighAccuracy: true, maximumAge: 10000, timeout },
      );
    });
  }
}

/**
 * Drives along whatever route the session is currently following.
 * getModel() must return the active RouteModel; when it changes (after a
 * reroute) the simulator continues on the new route from its start.
 */
export class Simulator extends Emitter {
  constructor(getModel, { speedFactor = 1, startAlong = 0, noise = 2 } = {}) {
    super();
    this.kind = 'sim';
    this.getModel = getModel;
    this.speedFactor = speedFactor;
    this.noise = noise;
    this.model = null;
    this.along = startAlong;
    this.speed = 0;
    this.timer = null;
    this.paused = false;
    this.detour = null;
    this.pos = null;
    this.heading = 0;
  }

  start() {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  setPaused(p) {
    this.paused = p;
  }

  /** Take a wrong turn: leave the route for a while to test rerouting. */
  wrongTurn() {
    if (!this.pos) return;
    const model = this.model;
    const brg = model ? model.bearingAt(this.along) : this.heading;
    this.detour = { heading: (brg + 75) % 360, remaining: 140, from: this.pos, model };
  }

  _targetSpeed(model) {
    const limit = model.speedLimitAt(this.along);
    const road = model.roadSpeedAt(this.along);
    let v = limit ? limit * 0.44704 * 0.95 : Math.min(road || 13, 31);
    const next = model.nextAnnounced(this.along);
    if (next) {
      const d = next.along - this.along;
      const slow = next.type === 'roundabout' || next.type === 'rotary' ? 7 : next.type === 'arrive' ? 3 : 6;
      if (d < 25) v = Math.min(v, slow);
      else if (d < 120) v = Math.min(v, slow + (d - 25) * 0.12);
    }
    return Math.max(v, 3);
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(2, (now - this.lastTick) / 1000) * this.speedFactor;
    this.lastTick = now;
    const model = this.getModel();
    if (!model) return;
    if (model !== this.model) {
      const firstModel = !this.model;
      this.model = model;
      if (!firstModel) {
        // A new route starts at the car's position; continue from its start.
        this.along = 0;
        this.detour = null;
      }
    }
    if (this.paused) {
      this.speed = 0;
    } else if (this.detour) {
      this.speed = Math.max(6, this.speed * 0.9);
      const step = this.speed * dt;
      this.pos = destination(this.pos, this.detour.heading, step);
      this.heading = this.detour.heading;
      this.detour.remaining -= step;
      if (this.detour.remaining <= 0) {
        // Waited long enough off route with no new route (e.g. offline): drive back.
        this.detour.waiting = (this.detour.waiting || 0) + dt;
        if (this.detour.waiting > 20) {
          this.detour = null;
        } else {
          this.speed = 0;
        }
      }
    } else {
      const target = this._targetSpeed(model);
      const accel = target > this.speed ? 1.8 : 3;
      this.speed += Math.max(-accel * dt, Math.min(accel * dt, target - this.speed));
      this.along = Math.min(model.length, this.along + this.speed * dt);
      const pt = model.pointAt(this.along);
      this.pos = pt.point;
      this.heading = pt.bearing;
      if (this.along >= model.length) this.speed = 0;
    }
    const jitter = () => (Math.random() - 0.5) * 2 * this.noise;
    const p = this.noise ? destination(this.pos, Math.random() * 360, Math.abs(jitter())) : this.pos;
    this.emit('fix', {
      lon: p[0],
      lat: p[1],
      accuracy: 5,
      speed: this.speed,
      heading: this.speed > 0.5 ? this.heading : null,
      time: now,
      simulated: true,
    });
  }
}
