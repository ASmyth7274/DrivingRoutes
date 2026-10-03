// Downloads map tiles, fonts and icons for the area around a test centre so
// the map keeps working with no signal. Stored in the same Cache Storage the
// service worker reads from.

export const MAP_CACHE = 'dtr-map-v1';

/** Must match tileCacheKey() in sw.js. */
export function tileCacheKey(url) {
  const m = /^(https:\/\/tiles\.openfreemap\.org\/planet)\/[^/]+\/(\d+\/\d+\/\d+\.pbf)/.exec(url);
  return m ? `${m[1]}/_/${m[2]}` : url;
}

function lon2tile(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

function lat2tile(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export function tilesForArea([lon, lat], radiusKm, minZ, maxZ) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const out = [];
  for (let z = minZ; z <= maxZ; z++) {
    const x0 = lon2tile(lon - dLon, z);
    const x1 = lon2tile(lon + dLon, z);
    const y0 = lat2tile(lat + dLat, z);
    const y1 = lat2tile(lat - dLat, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}

function collectFonts(style) {
  const fonts = new Set();
  for (const layer of style.layers || []) {
    const f = layer.layout?.['text-font'];
    if (Array.isArray(f) && f.every((s) => typeof s === 'string')) fonts.add(f.join(','));
    else if (f && Array.isArray(f.stops)) f.stops.forEach(([, v]) => Array.isArray(v) && fonts.add(v.join(',')));
  }
  return [...fonts];
}

async function collectStyleUrls(styleUrl, center, radiusKm) {
  const urls = new Set([styleUrl]);
  const tileUrls = new Set();
  const style = await (await fetch(styleUrl)).json();
  for (const src of Object.values(style.sources || {})) {
    if (src.type !== 'vector') continue;
    let tj = src;
    if (src.url) {
      urls.add(src.url);
      tj = await (await fetch(src.url)).json();
    }
    const template = tj.tiles?.[0];
    if (!template) continue;
    const maxZ = Math.min(tj.maxzoom ?? 14, 14);
    for (const [z, x, y] of tilesForArea(center, radiusKm, Math.max(tj.minzoom ?? 0, 9), maxZ)) {
      tileUrls.add(template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    }
  }
  if (style.glyphs) {
    for (const font of collectFonts(style)) {
      for (const range of ['0-255', '256-511', '8192-8447']) {
        urls.add(new URL(style.glyphs.replace('{fontstack}', font).replace('{range}', range)).href);
      }
    }
  }
  const sprites = typeof style.sprite === 'string' ? [style.sprite] : (style.sprite || []).map((s) => s.url);
  for (const s of sprites) {
    for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) urls.add(s + suffix);
  }
  return { urls: [...urls], tileUrls: [...tileUrls] };
}

/**
 * @param {string[]} styleUrls
 * @param {[number, number]} center
 * @param {number} radiusKm
 * @param {(done: number, total: number) => void} onProgress
 */
export async function downloadArea(styleUrls, center, radiusKm = 8, onProgress = () => {}, signal) {
  if (typeof caches === 'undefined') throw new Error('Offline storage is not available in this browser');
  const cache = await caches.open(MAP_CACHE);
  const all = new Map();
  for (const styleUrl of styleUrls) {
    const { urls, tileUrls } = await collectStyleUrls(styleUrl, center, radiusKm);
    for (const u of urls) all.set(u, u);
    for (const u of tileUrls) all.set(tileCacheKey(u), u);
  }
  const jobs = [...all.entries()];
  let done = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      if (signal?.aborted) return;
      const [key, url] = jobs[next++];
      try {
        const existing = await cache.match(key);
        if (!existing) {
          const res = await fetch(url, { mode: 'cors' });
          if (res.ok) await cache.put(key, res);
          else failed++;
        }
      } catch {
        failed++;
      }
      done++;
      onProgress(done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { total: jobs.length, failed };
}

export async function storageEstimate() {
  try {
    const est = await navigator.storage?.estimate?.();
    return est ? { usage: est.usage, quota: est.quota } : null;
  } catch {
    return null;
  }
}

export async function requestPersistentStorage() {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return false;
  }
}
