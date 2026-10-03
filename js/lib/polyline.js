// Google encoded polyline format. Returns / accepts [lon, lat] pairs.

export function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision;
  const out = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let byte;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

function encodeValue(v) {
  v = v < 0 ? ~(v << 1) : v << 1;
  let s = '';
  while (v >= 0x20) {
    s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return s + String.fromCharCode(v + 63);
}

export function encodePolyline(coords, precision = 5) {
  const factor = 10 ** precision;
  let lastLat = 0;
  let lastLon = 0;
  let s = '';
  for (const [lon, lat] of coords) {
    const la = Math.round(lat * factor);
    const lo = Math.round(lon * factor);
    s += encodeValue(la - lastLat) + encodeValue(lo - lastLon);
    lastLat = la;
    lastLon = lo;
  }
  return s;
}
