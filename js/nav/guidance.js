// Decides what the banner shows and when to speak, like a sat nav:
// an early prompt ("In 200 yards, turn left"), a prompt at the junction
// ("Turn left onto Barton Lane"), "then ..." chaining for close manoeuvres
// and an extra early prompt on fast roads.

import { clamp } from '../lib/geo.js';
import { spokenDistance } from '../lib/units.js';
import { examinerText, instructionText, lowerFirst, shortThen, spokenRef } from './instructions.js';

export class Guidance {
  /**
   * @param {RouteModel} model
   * @param {{style?: 'satnav'|'examiner', units?: 'imperial'|'metric', destination?: string}} opts
   */
  constructor(model, opts = {}) {
    this.model = model;
    this.style = opts.style || 'satnav';
    this.units = opts.units || 'imperial';
    this.destination = opts.destination || null;
    this.spoken = new Set();
    this.lastNextIndex = -1;
  }

  _key(step, phase) {
    return `${step.index}:${phase}`;
  }

  _done(step, phase) {
    return this.spoken.has(this._key(step, phase));
  }

  _mark(step, ...phases) {
    for (const p of phases) this.spoken.add(this._key(step, p));
  }

  text(step, spoken = false) {
    return instructionText(step, { spoken, destination: this.destination });
  }

  examiner(step, along) {
    let ordinalOnSide = null;
    const mod = step.modifier || '';
    const side = mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : null;
    if (step.type === 'turn' && side) {
      ordinalOnSide = this.model.sideRoadsBetween(along, step.along, side) + 1;
    }
    return examinerText(step, { ordinalOnSide, destination: this.destination });
  }

  /** The prompt to speak when guidance starts (or restarts after a reroute). */
  startSpeech(along = 0) {
    const first = this.model.steps[0];
    const next = this.model.nextAnnounced(along);
    if (this.style === 'examiner') {
      if (!next) return 'Follow the road ahead.';
      const d = next.along - along;
      if (d < 250) {
        this._mark(next, 'far', 'mid');
        return this.examiner(next, along);
      }
      return 'Follow the road ahead, please.';
    }
    let s = first && first.type === 'depart' ? this.text(first, true) : '';
    if (next) {
      const d = next.along - along;
      if (d < 400) {
        this._mark(next, 'far', 'mid');
        s += `${s ? ', then' : ''} ${s ? lowerFirst(this.text(next, true)) : this.text(next, true)}`;
      } else {
        this._mark(next, 'follow');
        s += `${s ? '. ' : ''}Continue for ${spokenDistance(d, this.units)}`;
      }
    }
    return s.trim() + '.';
  }

  /** Banner information without speaking or marking anything as spoken. */
  peek(along) {
    const next = this.model.nextAnnounced(along);
    if (!next) return { next: null, distance: 0, then: null, speech: null };
    const after = this.model.nextAnnounced(along, 1);
    const then = after && after.along - next.along <= 120 ? after : null;
    return { next, distance: next.along - along, then, speech: null };
  }

  /**
   * @param {number} along current position along the route (m)
   * @param {number} speed current speed (m/s)
   * @returns {{ next, distance, then, speech: string|null }}
   */
  update(along, speed) {
    const model = this.model;
    const next = model.nextAnnounced(along);
    if (!next) return { next: null, distance: 0, then: null, speech: null };
    const d = next.along - along;
    const after = model.nextAnnounced(along, 1);
    const roadSpeed = model.roadSpeedAt(next.along - 1) || 0;
    const v = Math.max(speed || 0, roadSpeed * 0.8, 6);

    const nearD = clamp(v * 3.5, 25, 110);
    const midD = v < 17 ? clamp(v * 14, 120, 320) : v < 24 ? 500 : 800;
    const farD = v >= 22 ? 1609 : null;

    const gapToAfter = after ? after.along - next.along : Infinity;
    const thenStep = after && gapToAfter <= Math.max(120, v * 8) ? after : null;

    let speech = null;
    const examiner = this.style === 'examiner';

    if (next.type === 'arrive') {
      if (d <= Math.max(nearD, 60) && !this._done(next, 'near')) {
        this._mark(next, 'near', 'mid', 'far');
        speech = examiner
          ? this.examiner(next, along)
          : this.destination ? `You have arrived at ${this.destination}.` : 'You have arrived at your destination.';
      } else if (!examiner && d <= midD && d > nearD + 40 && !this._done(next, 'mid')) {
        this._mark(next, 'mid', 'far');
        speech = `In ${spokenDistance(d, this.units)}, ${lowerFirst(this.text(next, true))}.`;
      }
      return { next, distance: d, then: null, speech };
    }

    if (examiner) {
      // Examiners give one clear direction in good time, without distances.
      const giveAt = clamp(v * 11, 90, 260);
      if (d <= giveAt && !this._done(next, 'mid')) {
        const ord = next.type === 'turn' ? this.model.sideRoadsBetween(along, next.along, next.modifier?.includes('left') ? 'left' : 'right') + 1 : null;
        // Avoid "take the fourth road on the left": wait until it's the next or second road.
        if (ord == null || ord <= 2 || d <= nearD * 1.5) {
          this._mark(next, 'mid', 'far', 'near');
          speech = this.examiner(next, along);
        }
      }
      return { next, distance: d, then: thenStep, speech };
    }

    if (d <= nearD) {
      if (!this._done(next, 'near')) {
        this._mark(next, 'near', 'mid', 'far');
        speech = this.text(next, true);
        if (thenStep && !this._done(thenStep, 'near')) {
          speech += `, then ${shortThen(thenStep)}`;
          this._mark(thenStep, 'mid', 'far');
        }
        speech += '.';
      }
    } else if (d <= midD) {
      if (!this._done(next, 'mid') && d > nearD + 25) {
        this._mark(next, 'mid', 'far');
        speech = `In ${spokenDistance(d, this.units)}, ${lowerFirst(this.text(next, true))}`;
        if (thenStep && gapToAfter < 80 && !this._done(thenStep, 'mid')) {
          speech += `, then ${shortThen(thenStep)}`;
        }
        speech += '.';
      }
    } else if (farD && d <= farD) {
      if (!this._done(next, 'far') && d > midD + 250) {
        this._mark(next, 'far');
        speech = `In ${spokenDistance(d, this.units)}, ${lowerFirst(this.text(next, true))}.`;
      }
    } else if (d > 2400 && this.lastNextIndex !== next.index && !this._done(next, 'follow')) {
      // Just passed a manoeuvre and the next one is a long way off.
      this._mark(next, 'follow');
      const road = model.steps[model.stepIndexAt(along)];
      const label = road && (road.name || road.ref) ? ` on ${road.ref ? `the ${spokenRef(road.ref)}` : road.name}` : '';
      speech = `Continue${label} for ${spokenDistance(d, this.units)}.`;
    }
    this.lastNextIndex = next.index;
    return { next, distance: d, then: thenStep, speech };
  }
}
