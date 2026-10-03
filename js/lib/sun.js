// Sunrise and sunset (Almanac for Computers algorithm), for automatic night map.

const RAD = Math.PI / 180;

function calc(date, lat, lon, rising) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const n = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  const lngHour = lon / 15;
  const t = n + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 282.634;
  L = ((L % 360) + 360) % 360;
  let RA = Math.atan(0.91764 * Math.tan(L * RAD)) / RAD;
  RA = ((RA % 360) + 360) % 360;
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;
  const sinDec = 0.39782 * Math.sin(L * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(90.833 * RAD) - sinDec * Math.sin(lat * RAD)) / (cosDec * Math.cos(lat * RAD));
  if (cosH > 1 || cosH < -1) return null;
  let H = rising ? 360 - Math.acos(cosH) / RAD : Math.acos(cosH) / RAD;
  H /= 15;
  const T = H + RA - 0.06571 * t - 6.622;
  const UT = (((T - lngHour) % 24) + 24) % 24;
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(d.getTime() + UT * 3600000);
}

export function sunTimes(date, lat, lon) {
  return { sunrise: calc(date, lat, lon, true), sunset: calc(date, lat, lon, false) };
}

/** True between sunset (plus a little dusk) and sunrise. */
export function isDark(date, lat, lon) {
  const { sunrise, sunset } = sunTimes(date, lat, lon);
  if (!sunrise || !sunset) return false;
  const t = date.getTime();
  return t < sunrise.getTime() - 15 * 60000 || t > sunset.getTime() + 20 * 60000;
}
