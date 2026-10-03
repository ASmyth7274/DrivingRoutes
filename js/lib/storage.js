// Settings, user-created centres/routes and practice history (localStorage).

const KEY = 'dtr:v1';

export const DEFAULT_SETTINGS = {
  voice: true,
  voiceName: null,
  voiceRate: 1,
  voiceStyle: 'satnav',     // 'satnav' | 'examiner'
  units: 'imperial',        // 'imperial' | 'metric'
  speedWarnings: true,
  speedTolerance: 2,        // mph over the limit before warning
  spokenNotes: true,        // read out hotspot tips
  keepAwake: true,
  mapTheme: 'auto',         // 'auto' | 'light' | 'dark'
  autoReroute: true,
  simSpeed: 1,
  mapPitch: true,
};

function blank() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    activeCentreId: null,
    customCentres: [],
    customRoutes: {},   // centreId -> [route]
    hiddenRoutes: {},   // centreId -> [routeId]
    history: {},        // `${centreId}/${routeId}` -> { count, last, completed }
  };
}

let state = null;

function load() {
  if (state) return state;
  state = blank();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...blank(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) } };
    }
  } catch (err) {
    console.warn('Could not read saved data', err);
  }
  return state;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save data', err);
  }
}

export function getSettings() {
  return load().settings;
}

export function setSettings(patch) {
  load();
  state.settings = { ...state.settings, ...patch };
  save();
  return state.settings;
}

export function getActiveCentreId() {
  return load().activeCentreId;
}

export function setActiveCentreId(id) {
  load().activeCentreId = id;
  save();
}

export function getCustomCentres() {
  return load().customCentres;
}

export function saveCustomCentre(centre) {
  load();
  const i = state.customCentres.findIndex((c) => c.id === centre.id);
  if (i >= 0) state.customCentres[i] = centre; else state.customCentres.push(centre);
  save();
}

export function deleteCustomCentre(id) {
  load();
  state.customCentres = state.customCentres.filter((c) => c.id !== id);
  delete state.customRoutes[id];
  delete state.hiddenRoutes[id];
  if (state.activeCentreId === id) state.activeCentreId = null;
  save();
}

export function getCustomRoutes(centreId) {
  return load().customRoutes[centreId] || [];
}

export function saveCustomRoute(centreId, route) {
  load();
  const list = state.customRoutes[centreId] || (state.customRoutes[centreId] = []);
  const i = list.findIndex((r) => r.id === route.id);
  if (i >= 0) list[i] = route; else list.push(route);
  save();
}

export function deleteCustomRoute(centreId, routeId) {
  load();
  state.customRoutes[centreId] = (state.customRoutes[centreId] || []).filter((r) => r.id !== routeId);
  save();
}

export function getHiddenRoutes(centreId) {
  return load().hiddenRoutes[centreId] || [];
}

export function setRouteHidden(centreId, routeId, hidden) {
  load();
  const set = new Set(state.hiddenRoutes[centreId] || []);
  if (hidden) set.add(routeId); else set.delete(routeId);
  state.hiddenRoutes[centreId] = [...set];
  save();
}

export function getHistory(centreId, routeId) {
  return load().history[`${centreId}/${routeId}`] || null;
}

export function recordDrive(centreId, routeId, { completed = false } = {}) {
  load();
  const k = `${centreId}/${routeId}`;
  const h = state.history[k] || { count: 0, completed: 0, last: 0 };
  h.count++;
  if (completed) h.completed++;
  h.last = Date.now();
  state.history[k] = h;
  save();
}

/** Everything the user created, for backup or moving to another phone. */
export function exportData() {
  load();
  return {
    app: 'driving-test-routes',
    version: 1,
    exportedAt: new Date().toISOString(),
    customCentres: state.customCentres,
    customRoutes: state.customRoutes,
    hiddenRoutes: state.hiddenRoutes,
    history: state.history,
    settings: state.settings,
  };
}

/** Merge an export (or a single centre / route file) into local data. */
export function importData(obj) {
  load();
  if (!obj || typeof obj !== 'object') throw new Error('Not a valid file');
  let added = 0;
  if (obj.app === 'driving-test-routes') {
    for (const c of obj.customCentres || []) { saveCustomCentre(c); added++; }
    for (const [cid, routes] of Object.entries(obj.customRoutes || {})) {
      for (const r of routes) { saveCustomRoute(cid, r); added++; }
    }
    state.hiddenRoutes = { ...state.hiddenRoutes, ...(obj.hiddenRoutes || {}) };
    state.history = { ...obj.history, ...state.history };
    save();
    return added;
  }
  if (Array.isArray(obj.routes) && obj.location) {
    // A centre file in the same format as data/centres/*.json
    saveCustomCentre({ ...obj, id: obj.id || `custom-${Date.now()}`, custom: true });
    return 1;
  }
  throw new Error('File not recognised');
}

export function resetAll() {
  state = blank();
  save();
}
