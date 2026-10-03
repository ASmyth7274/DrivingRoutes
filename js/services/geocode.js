// Place search for adding test centres (OpenStreetMap Nominatim).

import { fetchJson } from '../lib/net.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org';

export async function searchPlaces(query, { signal } = {}) {
  const q = encodeURIComponent(query.trim());
  const json = await fetchJson(`${NOMINATIM}/search?format=jsonv2&countrycodes=gb&limit=8&q=${q}`, { signal, timeout: 15000 });
  return (Array.isArray(json) ? json : []).map((r) => ({
    name: r.name || r.display_name.split(',')[0],
    label: r.display_name,
    location: [Number(r.lon), Number(r.lat)],
  }));
}

export async function reverseGeocode(lon, lat, { signal } = {}) {
  const json = await fetchJson(`${NOMINATIM}/reverse?format=jsonv2&zoom=17&lon=${lon}&lat=${lat}`, { signal, timeout: 15000 });
  return json?.display_name || '';
}
