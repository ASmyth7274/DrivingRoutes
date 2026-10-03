// Resolves route waypoints written like an examiner's route card:
//   { road: 'Barton Lane', from: 'Eldon Road', to: 'Nottingham Road', near: [lon, lat] }
// means "a point on Barton Lane between its junctions with Eldon Road and
// Nottingham Road", and { ref: 'A52', near, bearing: 80 } means "the
// eastbound A52 near here". Road data comes from OpenStreetMap via the
// Overpass API, so `near` only has to be roughly right (within `radius`).

import { angleDiff, bearing, distance, projectOnSegment, round6 } from '../lib/geo.js';
import { fetchJson, NetError } from '../lib/net.js';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const DEFAULT_RADIUS = 700;
const REF_RE = /^[ABM]\d+[A-Z]?$/i;

/** 'A52' -> { ref: 'A52' }, 'Barton Lane' -> { road: 'Barton Lane' } */
export function selector(s) {
  if (!s) return null;
  if (typeof s === 'object') return s;
  return REF_RE.test(s.trim()) ? { ref: s.trim().toUpperCase() } : { road: s.trim() };
}

function nearOf(w) {
  return w.near || w.at;
}

function regexFor(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '\\"');
  // Allow "Queens Road" to match "Queen's Road" and vice versa.
  return esc.replace(/'/g, '').replace(/s\b/g, "'?s");
}

function normName(s) {
  return (s || '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
}

function filterFor(sel) {
  if (sel.ref) return `["ref"~"(^|;) ?${sel.ref}(;|$)",i]`;
  return `["name"~"^${regexFor(sel.road)}$",i]`;
}

export function buildQuery(waypoints) {
  const seen = new Set();
  const parts = [];
  const add = (sel, near, r) => {
    if (!sel || !near) return;
    const part = `way(around:${r},${near[1].toFixed(5)},${near[0].toFixed(5)})["highway"]${filterFor(sel)};`;
    if (!seen.has(part)) {
      seen.add(part);
      parts.push(part);
    }
  };
  for (const w of waypoints) {
    const sel = selector(w.ref ? { ref: w.ref } : w.road ? { road: w.road } : null);
    if (!sel) continue;
    const r = w.radius || DEFAULT_RADIUS;
    const near = nearOf(w);
    add(sel, near, r);
    add(selector(w.from), near, r + 300);
    add(selector(w.to), near, r + 300);
  }
  if (!parts.length) return null;
  return `[out:json][timeout:30];(${parts.join('')});out body geom;`;
}

export function wayMatches(el, sel) {
  if (!sel) return false;
  const t = el.tags || {};
  if (sel.ref) return (t.ref || '').split(';').map((s) => s.trim().toUpperCase()).includes(sel.ref.toUpperCase());
  return normName(t.name) === normName(sel.road);
}

function waysFor(elements, sel) {
  return elements.filter((el) => el.type === 'way' && Array.isArray(el.geometry) && wayMatches(el, sel));
}

function onewayDirection(tags) {
  const ow = tags.oneway;
  if (ow === '-1') return -1;
  if (ow === 'yes' || ow === 'true' || ow === '1') return 1;
  if (tags.junction === 'roundabout' || tags.junction === 'circular' || tags.highway === 'motorway') return 1;
  return 0;
}

/**
 * Where two roads meet: a shared OSM node, or failing that (e.g. they meet
 * at a roundabout) the midpoint of their closest approach within 150 m.
 * With several candidates, the one nearest `near` wins.
 */
export function junctionOf(waysA, waysB, near) {
  const pos = new Map();
  for (const w of waysA) {
    (w.nodes || []).forEach((id, i) => {
      const g = w.geometry[i];
      if (g) pos.set(id, [g.lon, g.lat]);
    });
  }
  let best = null;
  for (const w of waysB) {
    for (const id of w.nodes || []) {
      const p = pos.get(id);
      if (!p) continue;
      const d = distance(p, near);
      if (!best || d < best.d) best = { p, d };
    }
  }
  if (best) return best.p;

  let pair = null;
  for (const a of waysA) {
    for (const ga of a.geometry) {
      const pa = [ga.lon, ga.lat];
      for (const b of waysB) {
        for (const gb of b.geometry) {
          const pb = [gb.lon, gb.lat];
          const d = distance(pa, pb);
          if (d > 150) continue;
          const mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
          const score = d + 0.05 * distance(mid, near);
          if (!pair || score < pair.score) pair = { score, mid };
        }
      }
    }
  }
  return pair ? pair.mid : null;
}

/** Choose the best point on the given ways for a target point. */
export function snapToWays(target, ways, { radius = DEFAULT_RADIUS, wantBearing = null, tolerance = 80 } = {}) {
  const limit = radius * 1.25;
  let best = null;
  for (const el of ways) {
    const g = el.geometry.map((n) => [n.lon, n.lat]);
    const dir = onewayDirection(el.tags || {});
    for (let i = 0; i < g.length - 1; i++) {
      const pr = projectOnSegment(target, g[i], g[i + 1]);
      if (pr.distance > limit) continue;
      let segBrg = bearing(g[i], g[i + 1]);
      if (dir === -1) segBrg = (segBrg + 180) % 360;
      let cost = pr.distance;
      let useBearing = null;
      if (wantBearing != null) {
        const diffFwd = Math.abs(angleDiff(segBrg, wantBearing));
        if (dir !== 0) {
          // One-way carriageway: must run the way we want to drive.
          if (diffFwd > tolerance) continue;
          useBearing = segBrg;
        } else {
          const diffRev = Math.abs(angleDiff((segBrg + 180) % 360, wantBearing));
          useBearing = diffFwd <= diffRev ? segBrg : (segBrg + 180) % 360;
          if (Math.min(diffFwd, diffRev) > tolerance) cost += 150;
        }
      }
      if (!best || cost < best.cost) {
        best = { cost, point: round6(pr.point), bearing: useBearing, name: el.tags?.name || el.tags?.ref || '' };
      }
    }
  }
  return best;
}

/** Resolve one waypoint against Overpass elements. */
export function resolveOne(w, elements) {
  const near = nearOf(w);
  const sel = selector(w.ref ? { ref: w.ref } : { road: w.road });
  const ways = waysFor(elements, sel);
  if (!ways.length) return null;
  const radius = w.radius || DEFAULT_RADIUS;

  if (w.from && w.to) {
    const j1 = junctionOf(ways, waysFor(elements, selector(w.from)), near);
    const j2 = junctionOf(ways, waysFor(elements, selector(w.to)), near);
    if (j1 && j2 && distance(j1, j2) > 40) {
      const mid = [(j1[0] + j2[0]) / 2, (j1[1] + j2[1]) / 2];
      const hit = snapToWays(mid, ways, {
        radius: distance(j1, j2) / 2 + 60,
        wantBearing: w.bearing ?? bearing(j1, j2),
        tolerance: 100,
      });
      if (hit) return { ...hit, method: 'junctions' };
    }
  }
  const hit = snapToWays(near, ways, { radius, wantBearing: w.bearing ?? null });
  return hit ? { ...hit, method: 'nearest' } : null;
}

async function queryOverpass(query, { signal } = {}) {
  let lastErr = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      return await fetchJson(url, {
        signal,
        timeout: 35000,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        },
      });
    } catch (err) {
      if (err?.name === 'AbortError' || err?.code === 'offline') throw err;
      lastErr = err;
    }
  }
  throw lastErr || new NetError('Map data service unavailable');
}

/**
 * waypoints: [{ near|at: [lon, lat], road?, ref?, from?, to?, radius?, bearing? }]
 * Returns [{ lon, lat, bearing, status, road, index }] where status is
 *   'snapped'  – placed on the named road
 *   'exact'    – no road given; used as-is
 *   'missing'  – road not found; leave this waypoint out
 *   'raw'      – lookup service unavailable; used as-is
 */
export async function resolveWaypoints(waypoints, opts = {}) {
  const query = buildQuery(waypoints);
  let elements = [];
  let failed = false;
  if (query) {
    try {
      const json = await queryOverpass(query, opts);
      elements = json.elements || [];
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      console.warn('Overpass lookup failed; using waypoint coordinates as given', err);
      failed = true;
    }
  }
  return waypoints.map((w, index) => {
    const near = nearOf(w);
    const out = {
      lon: near[0],
      lat: near[1],
      bearing: w.bearing ?? null,
      status: 'exact',
      road: w.road || w.ref || '',
      index,
    };
    if (!w.road && !w.ref) return out;
    if (failed) {
      out.status = 'raw';
      return out;
    }
    const best = resolveOne(w, elements);
    if (best) {
      out.lon = best.point[0];
      out.lat = best.point[1];
      if (best.bearing != null) out.bearing = best.bearing;
      out.status = 'snapped';
      out.method = best.method;
    } else {
      out.status = 'missing';
    }
    return out;
  });
}
