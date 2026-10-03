// Speed limits along a route from OpenStreetMap maxspeed data, via Valhalla's
// trace_attributes (map matching). Best effort: the app works without them.

import { cumulativeDistances, simplifyIndices } from '../lib/geo.js';
import { fetchJson } from '../lib/net.js';
import { encodePolyline } from '../lib/polyline.js';
import { ukLimitFromKph } from '../lib/units.js';
import { ENDPOINTS } from './router.js';

const CHUNK = 220;

async function traceChunk(points, { signal } = {}) {
  const req = {
    encoded_polyline: encodePolyline(points, 6),
    costing: 'auto',
    shape_match: 'map_snap',
    filters: { attributes: ['edge.speed_limit', 'matched.edge_index', 'matched.type'], action: 'include' },
  };
  const url = `${ENDPOINTS.valhalla}/trace_attributes?json=${encodeURIComponent(JSON.stringify(req))}`;
  const json = await fetchJson(url, { signal, timeout: 25000 });
  const edges = json.edges || [];
  return (json.matched_points || []).map((mp) => {
    const e = mp && mp.edge_index != null ? edges[mp.edge_index] : null;
    const kmh = e && typeof e.speed_limit === 'number' && e.speed_limit > 0 && e.speed_limit < 150 ? e.speed_limit : null;
    return ukLimitFromKph(kmh);
  });
}

/** Returns [{ from, to, mph }] ranges over coordinate indices (segment i = coords[i]..coords[i+1]). */
export async function fetchSpeedLimits(coords, opts = {}) {
  if (!coords || coords.length < 2) return null;
  let tol = 4;
  let idx = simplifyIndices(coords, tol);
  while (idx.length > 900 && tol < 50) {
    tol *= 1.5;
    idx = simplifyIndices(coords, tol);
  }
  const pts = idx.map((i) => coords[i]);
  const limits = [];
  for (let s = 0; s < pts.length - 1; s += CHUNK - 1) {
    const chunk = pts.slice(s, Math.min(pts.length, s + CHUNK));
    const res = await traceChunk(chunk, opts);
    for (let k = 0; k < chunk.length; k++) {
      if (s > 0 && k === 0) continue; // overlap point already filled
      limits.push(res[k] ?? null);
    }
  }
  if (limits.length !== pts.length) return null;

  // Spread the per-point limits onto the full geometry: each original segment
  // takes the limit of whichever simplified point is closer along the route.
  const cum = cumulativeDistances(coords);
  const segLimits = new Array(coords.length - 1).fill(null);
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k];
    const b = idx[k + 1];
    const mid = (cum[a] + cum[b]) / 2;
    for (let i = a; i < b; i++) {
      const centre = (cum[i] + cum[i + 1]) / 2;
      segLimits[i] = centre < mid ? (limits[k] ?? limits[k + 1]) : (limits[k + 1] ?? limits[k]);
    }
  }
  const ranges = [];
  let cur = null;
  segLimits.forEach((mph, i) => {
    if (cur && cur.mph === mph) {
      cur.to = i + 1;
    } else {
      if (cur && cur.mph != null) ranges.push(cur);
      cur = { from: i, to: i + 1, mph };
    }
  });
  if (cur && cur.mph != null) ranges.push(cur);
  return ranges.length ? ranges : null;
}
