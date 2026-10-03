// Distance, speed and time formatting with UK sat nav conventions.

export const M_PER_YARD = 0.9144;
export const M_PER_MILE = 1609.344;
export const MS_TO_MPH = 2.2369363;

export function mph(ms) {
  return ms == null ? null : ms * MS_TO_MPH;
}

export function kph(ms) {
  return ms == null ? null : ms * 3.6;
}

function roundTo(v, step) {
  return Math.round(v / step) * step;
}

/** Distance for on-screen display. Returns { value, unit }. */
export function displayDistance(m, units = 'imperial') {
  m = Math.max(0, m || 0);
  if (units === 'metric') {
    if (m < 1000) {
      const v = m < 100 ? roundTo(m, 5) : roundTo(m, 10);
      return { value: String(Math.max(v, 0)), unit: 'm' };
    }
    const km = m / 1000;
    return { value: km < 10 ? km.toFixed(1) : String(Math.round(km)), unit: 'km' };
  }
  const yd = m / M_PER_YARD;
  if (m < 0.1 * M_PER_MILE) {
    const v = yd < 20 ? roundTo(yd, 5) : roundTo(yd, 10);
    return { value: String(v), unit: 'yd' };
  }
  const mi = m / M_PER_MILE;
  return { value: mi < 10 ? mi.toFixed(1) : String(Math.round(mi)), unit: 'mi' };
}

export function displayDistanceText(m, units = 'imperial') {
  const d = displayDistance(m, units);
  return `${d.value} ${d.unit}`;
}

/** Distance phrase for voice prompts, e.g. "200 yards", "half a mile". */
export function spokenDistance(m, units = 'imperial') {
  m = Math.max(0, m || 0);
  if (units === 'metric') {
    if (m < 1000) {
      const v = m < 100 ? roundTo(m, 10) : roundTo(m, 50);
      return `${Math.max(v, 10)} metres`;
    }
    const km = m / 1000;
    if (km < 1.25) return '1 kilometre';
    if (km < 10) {
      const v = Math.round(km * 2) / 2;
      return `${v % 1 ? v.toFixed(1) : v} kilometres`;
    }
    return `${Math.round(km)} kilometres`;
  }
  const mi = m / M_PER_MILE;
  if (mi < 0.18) {
    const yd = m / M_PER_YARD;
    const v = yd < 100 ? roundTo(yd, 10) : roundTo(yd, 50);
    return `${Math.max(v, 10)} yards`;
  }
  if (mi < 0.375) return 'a quarter of a mile';
  if (mi < 0.625) return 'half a mile';
  if (mi < 0.875) return 'three quarters of a mile';
  if (mi < 1.25) return '1 mile';
  if (mi < 1.75) return 'one and a half miles';
  return `${Math.round(mi)} miles`;
}

export function formatDuration(seconds) {
  const mins = Math.max(0, Math.round((seconds || 0) / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function formatClock(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const ORD_WORDS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

export function ordinalWord(n) {
  return ORD_WORDS[n] || ordinal(n);
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Snap a km/h value from map data to the nearest UK limit in mph. */
export function ukLimitFromKph(kmh) {
  if (!kmh || kmh <= 0) return null;
  const v = kmh / 1.609344;
  const limits = [10, 20, 30, 40, 50, 60, 70];
  let best = limits[0];
  for (const l of limits) if (Math.abs(l - v) < Math.abs(best - v)) best = l;
  return best;
}
