// Routing via free public OpenStreetMap routers. OSRM first, Valhalla as backup.
// Both return OSRM-format JSON which normalizeOsrmRoute() understands.

import { normalizeBearing } from '../lib/geo.js';
import { fetchJson, NetError } from '../lib/net.js';
import { normalizeOsrmRoute } from '../nav/route-model.js';

export const ENDPOINTS = {
  osrm: 'https://router.project-osrm.org',
  valhalla: 'https://valhalla1.openstreetmap.de',
};

function fmt(n) {
  return Number(n).toFixed(6);
}

/** points: [{ lon, lat, bearing?, bearingRange? }] */
export async function routeOsrm(points, { signal } = {}) {
  const coords = points.map((p) => `${fmt(p.lon)},${fmt(p.lat)}`).join(';');
  let qs = 'overview=false&geometries=geojson&steps=true&continue_straight=true';
  if (points.some((p) => p.bearing != null)) {
    qs += '&bearings=' + points
      .map((p) => (p.bearing != null ? `${Math.round(normalizeBearing(p.bearing))},${p.bearingRange ?? 50}` : ''))
      .join(';');
  }
  const json = await fetchJson(`${ENDPOINTS.osrm}/route/v1/driving/${coords}?${qs}`, { signal, timeout: 20000 });
  if (json.code !== 'Ok' || !json.routes?.length) {
    throw new NetError(json.message || `Routing failed (${json.code})`, { code: json.code });
  }
  const vias = (json.waypoints || []).slice(1, -1).map((w) => w.location);
  return normalizeOsrmRoute(json.routes[0], {
    provider: 'osrm',
    precision: 5,
    vias: vias.length === points.length - 2 ? vias : points.slice(1, -1).map((p) => [p.lon, p.lat]),
  });
}

export async function routeValhalla(points, { signal } = {}) {
  const req = {
    locations: points.map((p, i) => {
      const loc = {
        lat: +fmt(p.lat),
        lon: +fmt(p.lon),
        type: i === 0 || i === points.length - 1 ? 'break' : 'through',
      };
      if (p.bearing != null) {
        loc.heading = Math.round(normalizeBearing(p.bearing));
        loc.heading_tolerance = p.bearingRange ?? 50;
      }
      return loc;
    }),
    costing: 'auto',
    format: 'osrm',
    shape_format: 'polyline6',
    directions_options: { units: 'kilometers', language: 'en-GB' },
  };
  const url = `${ENDPOINTS.valhalla}/route?json=${encodeURIComponent(JSON.stringify(req))}`;
  const json = await fetchJson(url, { signal, timeout: 25000 });
  if ((json.code && json.code !== 'Ok') || !json.routes?.length) {
    throw new NetError(json.message || 'Routing failed', { code: json.code || 'NoRoute' });
  }
  return normalizeOsrmRoute(json.routes[0], {
    provider: 'valhalla',
    precision: 6,
    vias: points.slice(1, -1).map((p) => [p.lon, p.lat]),
  });
}

const PROVIDERS = { osrm: routeOsrm, valhalla: routeValhalla };

/**
 * Try each provider in turn; retries without bearings if snapping failed
 * (unless opts.strict, used when testing alternative versions of a route).
 */
export async function route(points, opts = {}) {
  const order = opts.providers || ['osrm', 'valhalla'];
  let lastErr = null;
  for (const name of order) {
    const fn = PROVIDERS[name];
    try {
      return await fn(points, opts);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (err?.code === 'offline') throw err;
      lastErr = err;
      if (!opts.strict && points.some((p) => p.bearing != null)) {
        try {
          return await fn(points.map((p) => ({ ...p, bearing: null })), opts);
        } catch (err2) {
          lastErr = err2;
        }
      }
    }
  }
  throw lastErr || new NetError('No route found');
}

/** Nearest road to a point: { location, name } (OSRM nearest service). */
export async function nearestRoad(lon, lat, { signal } = {}) {
  const json = await fetchJson(`${ENDPOINTS.osrm}/nearest/v1/driving/${fmt(lon)},${fmt(lat)}?number=1`, { signal, timeout: 10000 });
  const w = json.waypoints?.[0];
  if (!w) throw new NetError('No road nearby', { code: 'NoSegment' });
  return { location: w.location, name: w.name || '', distance: w.distance };
}
