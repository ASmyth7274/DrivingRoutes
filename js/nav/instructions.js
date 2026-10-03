// Turns manoeuvres into UK-style sat nav and examiner directions.

import { angleDiff, cardinal } from '../lib/geo.js';
import { ordinal, ordinalWord } from '../lib/units.js';

const MOD_WORD = {
  'uturn': 'U-turn',
  'sharp right': 'sharp right',
  'right': 'right',
  'slight right': 'slight right',
  'straight': 'straight on',
  'slight left': 'slight left',
  'left': 'left',
  'sharp left': 'sharp left',
};

function firstRef(ref) {
  return (ref || '').split(/[;,]/)[0].trim();
}

/**
 * Speakable form of a road number, the way people say them in the UK:
 * "A52" -> "A 52" (fifty-two), "A453" -> "A 4 5 3", "B6003" -> "B 6 oh oh 3".
 */
export function spokenRef(ref) {
  const r = firstRef(ref);
  const m = /^([A-Z]+)\s*(\d+)([A-Z]?)$/i.exec(r);
  if (!m) return r;
  const digits = m[2].length >= 3 ? m[2].split('').map((d) => (d === '0' ? 'oh' : d)).join(' ') : m[2];
  return `${m[1].toUpperCase()} ${digits}${m[3] ? ' ' + m[3] : ''}`;
}

/** Display or spoken label for the road a step leads onto. */
export function roadLabel(step, spoken = false) {
  const name = (step.name || '').trim();
  const ref = firstRef(step.ref);
  if (ref && name && name !== ref) return spoken ? `the ${spokenRef(ref)}, ${name}` : `${ref} ${name}`;
  if (ref) return spoken ? `the ${spokenRef(ref)}` : ref;
  return name;
}

function towards(step, spoken) {
  const d = (step.destinations || '').split(',')[0].trim();
  if (!d) return '';
  return spoken ? ` towards ${d}` : ` towards ${d}`;
}

/** Exit direction relative to the entry, for roundabouts: 'left' | 'straight' | 'right' | 'back'. */
export function roundaboutDirection(step) {
  if (step.bearingBefore == null || step.bearingAfter == null) return null;
  const a = angleDiff(step.bearingBefore, step.bearingAfter);
  if (Math.abs(a) > 150) return 'back';
  if (a < -45) return 'left';
  if (a > 45) return 'right';
  return 'straight';
}

function lc(s) {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function uc(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Sat nav style instruction.
 * opts.spoken – wording for speech (road numbers spelt out etc.)
 * opts.short  – omit road names (used for "then ..." chaining)
 */
export function instructionText(step, opts = {}) {
  const spoken = !!opts.spoken;
  const short = !!opts.short;
  const road = short ? '' : roadLabel(step, spoken);
  const onto = road ? ` onto ${road}` : '';
  const mod = step.modifier || 'straight';
  const side = mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : null;
  const exit = step.exit;

  switch (step.type) {
    case 'depart': {
      const dir = step.bearingAfter != null ? cardinal(step.bearingAfter) : null;
      if (road) return dir ? `Head ${dir} on ${road}` : `Head along ${road}`;
      return dir ? `Head ${dir}` : 'Start driving';
    }
    case 'arrive':
      return opts.destination ? `Arrive at ${opts.destination}` : 'Arrive at your destination';
    case 'roundabout':
    case 'rotary': {
      const name = step.rotaryName && !short ? ` (${step.rotaryName})` : '';
      if (exit) {
        const nth = spoken ? ordinalWord(exit) : ordinal(exit);
        return `At the roundabout${spoken ? '' : name}, take the ${nth} exit${onto}`;
      }
      return `At the roundabout, take the exit${onto}`;
    }
    case 'roundabout turn':
      if (mod === 'straight') return `At the roundabout, go straight on${onto}`;
      if (mod === 'uturn') return `At the roundabout, turn back${onto}`;
      return `At the roundabout, turn ${side}${onto}`;
    case 'end of road':
      return `At the end of the road, turn ${side || 'left'}${onto}`;
    case 'fork':
      if (side) return `Keep ${side} at the fork${onto || towards(step, spoken)}`;
      return `Continue at the fork${onto}`;
    case 'merge':
      return side ? `Merge ${side}${onto}` : `Merge${onto}`;
    case 'on ramp':
      return side
        ? `Take the slip road on the ${side}${onto || towards(step, spoken)}`
        : `Take the slip road${onto || towards(step, spoken)}`;
    case 'off ramp': {
      const where = towards(step, spoken) || onto;
      return side ? `Take the exit on the ${side}${where}` : `Take the exit${where}`;
    }
    case 'continue':
      if (mod === 'uturn') return 'Make a U-turn when it is safe';
      if (mod.startsWith('slight')) return `Keep ${side}${road ? ` to stay on ${road}` : ''}`;
      if (side) return `Continue ${side}${road ? ` to stay on ${road}` : ''}`;
      return `Continue straight on${onto}`;
    case 'new name':
      if (mod === 'uturn') return 'Make a U-turn when it is safe';
      if (side) return `${mod.startsWith('slight') ? 'Bear' : 'Turn'} ${side}${onto}`;
      return `Continue${onto}`;
    case 'turn':
    default:
      if (mod === 'uturn') return `Make a U-turn when it is safe${onto}`;
      if (mod === 'straight') return `Go straight on${onto}`;
      if (mod.startsWith('slight')) return `Bear ${side}${onto}`;
      if (mod.startsWith('sharp')) return `Turn sharp ${side}${onto}`;
      return `Turn ${side || MOD_WORD[mod] || 'ahead'}${onto}`;
  }
}

/**
 * Driving examiner style direction, e.g. "Take the second road on the left"
 * or "At the roundabout, take the third exit. That's to the right."
 * `ordinalOnSide` is the 1-based count of side roads on the turn side up to
 * and including the turn, or null if unknown.
 */
export function examinerText(step, { ordinalOnSide = null, destination = null } = {}) {
  const mod = step.modifier || 'straight';
  const side = mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : null;

  switch (step.type) {
    case 'arrive':
      return destination
        ? `When you're ready, pull into ${destination} and park in a bay of your choice.`
        : 'Pull up on the left at a convenient place.';
    case 'roundabout':
    case 'rotary': {
      const dir = roundaboutDirection(step);
      const dirText = {
        left: "That's to the left.",
        straight: "That's following the road ahead.",
        right: "That's to the right.",
        back: "That's going back the way we came.",
      }[dir] || '';
      if (step.exit) return `At the roundabout, take the ${ordinalWord(step.exit)} exit. ${dirText}`.trim();
      return 'At the roundabout, follow the road ahead.';
    }
    case 'roundabout turn':
      if (mod === 'straight') return 'At the roundabout, follow the road ahead.';
      return `At the roundabout, turn ${side}.`;
    case 'end of road':
      return `At the end of the road, turn ${side || 'left'}, please.`;
    case 'fork':
      return `Keep to the ${side || 'left'} where the road splits.`;
    case 'merge':
    case 'on ramp':
      return `Follow the slip road and join the main road${side ? ` on the ${side}` : ''}.`;
    case 'off ramp':
      return `Take the next exit on the ${side || 'left'}.`;
    case 'continue':
    case 'new name':
      if (mod === 'uturn') return 'Turn the car around when it is safe.';
      if (side) return `Follow the road round to the ${side}.`;
      return 'Follow the road ahead.';
    case 'turn':
    default: {
      if (mod === 'uturn') return 'Turn the car around when it is safe.';
      if (mod === 'straight') return 'At the junction, go straight ahead.';
      if (!side) return 'Follow the road ahead.';
      if (ordinalOnSide === 1) return `Take the next road on the ${side}, please.`;
      if (ordinalOnSide === 2) return `Take the second road on the ${side}.`;
      if (ordinalOnSide != null && ordinalOnSide > 2) return `Take the ${ordinalWord(ordinalOnSide)} road on the ${side}.`;
      return `Turn ${side} at the junction ahead.`;
    }
  }
}

export function shortThen(step) {
  return lc(instructionText(step, { spoken: true, short: true }));
}

export { lc as lowerFirst, uc as upperFirst };
