// Geometry helpers. All points are [lon, lat] arrays (GeoJSON order).

export const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Great-circle distance in metres. */
export function distance(a, b) {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function normalizeBearing(b) {
  return ((b % 360) + 360) % 360;
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearing(a, b) {
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeBearing(Math.atan2(y, x) * DEG);
}

/** Signed smallest angle from `from` to `to` in (-180, 180]. Positive means clockwise (to the right). */
export function angleDiff(from, to) {
  let d = normalizeBearing(to - from);
  if (d > 180) d -= 360;
  return d;
}

/** Interpolate between two bearings taking the short way round. */
export function lerpBearing(from, to, t) {
  return normalizeBearing(from + angleDiff(from, to) * t);
}

export function destination(p, brg, dist) {
  const d = dist / EARTH_RADIUS;
  const t = brg * RAD;
  const lat1 = p[1] * RAD;
  const lon1 = p[0] * RAD;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t));
  const lon2 = lon1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [((lon2 * DEG + 540) % 360) - 180, lat2 * DEG];
}

/**
 * Project p onto segment a-b with a local flat-earth approximation
 * (accurate to centimetres over the segment lengths found in road data).
 */
export function projectOnSegment(p, a, b) {
  const ky = RAD * EARTH_RADIUS;
  const kx = Math.cos(((a[1] + b[1]) / 2) * RAD) * ky;
  const bx = (b[0] - a[0]) * kx;
  const by = (b[1] - a[1]) * ky;
  const px = (p[0] - a[0]) * kx;
  const py = (p[1] - a[1]) * ky;
  const len2 = bx * bx + by * by;
  let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
  t = clamp(t, 0, 1);
  const dx = px - t * bx;
  const dy = py - t * by;
  return {
    t,
    distance: Math.sqrt(dx * dx + dy * dy),
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  };
}

export function cumulativeDistances(coords) {
  const cum = new Array(coords.length);
  cum[0] = 0;
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + distance(coords[i - 1], coords[i]);
  return cum;
}

/** Bearing of each segment; zero-length segments inherit a neighbour's bearing. */
export function segmentBearings(coords) {
  const n = Math.max(0, coords.length - 1);
  const out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (distance(coords[i], coords[i + 1]) > 0.05) out[i] = bearing(coords[i], coords[i + 1]);
  }
  let last = null;
  for (let i = 0; i < n; i++) {
    if (out[i] == null) out[i] = last; else last = out[i];
  }
  last = null;
  for (let i = n - 1; i >= 0; i--) {
    if (out[i] == null) out[i] = last ?? 0; else last = out[i];
  }
  return out;
}

/** Largest i with cum[i] <= d, limited to a valid segment index. */
export function segmentIndexAt(cum, d) {
  const n = cum.length;
  if (n < 2) return 0;
  if (d <= 0) return 0;
  if (d >= cum[n - 1]) return n - 2;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  return Math.min(lo, n - 2);
}

/** Point at along-distance d. Returns { point, index, bearing }. */
export function pointAlong(coords, cum, d, bearings) {
  const n = coords.length;
  if (n === 0) return null;
  if (n === 1) return { point: coords[0], index: 0, bearing: 0 };
  const i = segmentIndexAt(cum, d);
  const len = cum[i + 1] - cum[i];
  const t = len > 0 ? clamp((d - cum[i]) / len, 0, 1) : 0;
  const a = coords[i];
  const b = coords[i + 1];
  return {
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    index: i,
    bearing: bearings ? bearings[i] : bearing(a, b),
  };
}

/** Coordinates of the line between along-distances d0 and d1. */
export function sliceLine(coords, cum, d0, d1) {
  const total = cum[cum.length - 1] || 0;
  d0 = clamp(d0, 0, total);
  d1 = clamp(d1, 0, total);
  if (coords.length < 2 || d1 <= d0) return [];
  const start = pointAlong(coords, cum, d0);
  const end = pointAlong(coords, cum, d1);
  const out = [start.point];
  for (let i = start.index + 1; i <= end.index; i++) out.push(coords[i]);
  out.push(end.point);
  return out;
}

/** Nearest point on a polyline, searching segments fromIdx..toIdx-1. */
export function nearestOnLine(coords, cum, p, fromIdx = 0, toIdx = coords.length - 1) {
  let best = null;
  const last = Math.min(toIdx, coords.length - 1);
  for (let i = Math.max(0, fromIdx); i < last; i++) {
    const pr = projectOnSegment(p, coords[i], coords[i + 1]);
    if (!best || pr.distance < best.distance) {
      best = {
        index: i,
        t: pr.t,
        distance: pr.distance,
        point: pr.point,
        along: cum ? cum[i] + pr.t * (cum[i + 1] - cum[i]) : undefined,
      };
    }
  }
  return best;
}

export function bbox(coords) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of coords) {
    if (c[0] < minX) minX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] > maxY) maxY = c[1];
  }
  return [minX, minY, maxX, maxY];
}

/** Ramer–Douglas–Peucker simplification. Returns the indices of kept points. */
export function simplifyIndices(coords, tolerance) {
  const n = coords.length;
  if (n <= 2) return coords.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = projectOnSegment(coords[i], coords[s], coords[e]).distance;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

export function round6(c) {
  return [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];
}

const CARDINALS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function cardinal(brg) {
  return CARDINALS[Math.round(normalizeBearing(brg) / 45) % 8];
}
