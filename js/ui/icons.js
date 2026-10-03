// SVG manoeuvre arrows (UK: roundabouts go clockwise, U-turns swing right)
// and lane guidance arrows.

import { MOD_ANGLE, roundaboutAngle } from '../nav/route-model.js';

function pt(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function head(x, y, deg, size = 15) {
  const tip = pt(x, y, size * 0.9, deg);
  const l = pt(x, y, size * 0.75, deg - 140);
  const r = pt(x, y, size * 0.75, deg + 140);
  return `<path d="M${tip[0].toFixed(1)} ${tip[1].toFixed(1)} L${l[0].toFixed(1)} ${l[1].toFixed(1)} L${r[0].toFixed(1)} ${r[1].toFixed(1)} Z" fill="currentColor"/>`;
}

function svg(body, cls = '') {
  return `<svg class="mv ${cls}" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
}

/** Arrow turning by `deg` (0 = straight on, negative = left). */
export function turnArrow(deg, { faint = [] } = {}) {
  const jx = 50;
  const jy = deg === 0 ? 30 : 50;
  const armLen = Math.abs(deg) > 120 ? 26 : 30;
  const end = pt(jx, jy, armLen, deg);
  const stemTop = deg === 0 ? 22 : jy;
  let body = '';
  for (const f of faint) {
    const fe = pt(50, 50, 30, f);
    body += `<path d="M50 92 L50 50 L${fe[0].toFixed(1)} ${fe[1].toFixed(1)}" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (deg === 0) {
    body += `<path d="M50 92 L50 ${stemTop + 8}" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round"/>`;
    body += head(50, stemTop + 4, 0, 17);
  } else {
    body += `<path d="M50 92 L50 ${jy} L${end[0].toFixed(1)} ${end[1].toFixed(1)}" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`;
    const h = pt(jx, jy, armLen + 4, deg);
    body += head(h[0], h[1], deg, 17);
  }
  return svg(body);
}

/** U-turn for left-hand traffic: up, over to the right, and back down. */
export function uturnArrow() {
  const body = `<path d="M34 92 L34 42 A16 16 0 0 1 66 42 L66 62" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>${head(66, 70, 180, 17)}`;
  return svg(body);
}

/**
 * Roundabout diagram: enter from the bottom, go round clockwise (UK) and
 * leave at the exit's real angle, with the exit number in the middle.
 * Everything stays inside the 100x100 box so nothing is clipped.
 */
export function roundaboutArrow(exitAngle, exitNumber = null) {
  const cx = 50;
  const cy = 50;
  const r = 16;
  let theta = Number.isFinite(exitAngle) ? exitAngle : 0;
  if (theta <= -175) theta = 180;
  const back = Math.abs(theta) >= 160;
  // Going back the way you came you leave on the other side of the road.
  const entryAt = back ? 205 : 180;
  const leaveAt = back ? 140 : theta;
  const dir = back ? 180 : theta;
  const sweep = ((leaveAt - entryAt) % 360 + 360) % 360 || 360;
  const start = pt(cx, cy, r, entryAt);
  const exitP = pt(cx, cy, r, leaveAt);
  const armEnd = pt(exitP[0], exitP[1], 15, dir);
  const headP = pt(exitP[0], exitP[1], 19, dir);
  const f = (n) => n.toFixed(1);
  let arc;
  if (sweep >= 359) {
    const mid = pt(cx, cy, r, entryAt + 180);
    arc = `A${r} ${r} 0 0 1 ${f(mid[0])} ${f(mid[1])} A${r} ${r} 0 0 1 ${f(exitP[0])} ${f(exitP[1])}`;
  } else {
    arc = `A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${f(exitP[0])} ${f(exitP[1])}`;
  }
  const body = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="8"/>
    <path d="M${f(start[0])} 96 L${f(start[0])} ${f(start[1])} ${arc} L${f(armEnd[0])} ${f(armEnd[1])}"
      fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    ${head(headP[0], headP[1], dir, 15)}
    ${exitNumber ? `<text x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="central" font-size="18" font-weight="800" font-family="-apple-system, system-ui, sans-serif" fill="currentColor">${Number(exitNumber)}</text>` : ''}`;
  return svg(body);
}

export function arriveIcon() {
  const body = `
    <path d="M50 92 L50 64" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>
    <path d="M50 10c-14 0-24 10-24 23 0 17 24 37 24 37s24-20 24-37c0-13-10-23-24-23z" fill="currentColor"/>
    <circle cx="50" cy="33" r="9" fill="var(--banner-bg, #0d6b3c)"/>`;
  return svg(body);
}

export function directionArrow(relDeg) {
  // A chevron pointing relDeg degrees from straight up (for "head back to the route").
  const body = `<g transform="rotate(${relDeg.toFixed(0)} 50 50)"><path d="M50 8 L80 84 L50 66 L20 84 Z" fill="currentColor"/></g>`;
  return svg(body);
}

/** Icon for a route step. */
export function maneuverIcon(step) {
  if (!step) return turnArrow(0);
  const mod = step.modifier || 'straight';
  switch (step.type) {
    case 'arrive':
      return arriveIcon();
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return roundaboutArrow(roundaboutAngle(step), step.type === 'roundabout turn' ? null : step.exit);
    case 'fork':
    case 'off ramp':
    case 'on ramp': {
      const d = mod.includes('left') ? -38 : mod.includes('right') ? 38 : 0;
      return turnArrow(d, { faint: d ? [-d] : [] });
    }
    case 'merge': {
      const d = mod.includes('left') ? -30 : mod.includes('right') ? 30 : 0;
      return turnArrow(d);
    }
    default:
      if (mod === 'uturn') return uturnArrow();
      return turnArrow(MOD_ANGLE[mod] ?? 0);
  }
}

const LANE_ANGLE = { ...MOD_ANGLE, none: 0, uturn: 180, 'merge to left': -30, 'merge to right': 30 };

function laneArrow(indications, active) {
  const angles = (indications.length ? indications : ['straight'])
    .map((i) => LANE_ANGLE[i])
    .filter((a) => a != null);
  let body = '';
  for (const a of angles) {
    if (a === 180) {
      body += `<path d="M38 92 L38 46 A12 12 0 0 1 62 46 L62 60" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>${head(62, 66, 180, 14)}`;
    } else if (a === 0) {
      body += `<path d="M50 92 L50 30" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>${head(50, 24, 0, 15)}`;
    } else {
      const e = pt(50, 52, 26, a);
      const h = pt(50, 52, 30, a);
      body += `<path d="M50 92 L50 52 L${e[0].toFixed(1)} ${e[1].toFixed(1)}" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>${head(h[0], h[1], a, 15)}`;
    }
  }
  return `<svg class="lane ${active ? 'on' : 'off'}" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
}

/** Lane guidance row for a step, or '' if the router gave no lane data. */
export function lanesHtml(step) {
  const lanes = step?.intersections?.[0]?.lanes;
  if (!lanes || lanes.length < 2 || lanes.every((l) => l.valid)) return '';
  return lanes.map((l) => laneArrow(l.indications || [], l.valid)).join('');
}
