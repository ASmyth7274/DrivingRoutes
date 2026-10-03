// App controller: shared state, screen switching and services.

import { ScreenWake } from './device/wakelock.js';
import { Voice } from './device/voice.js';
import { getActiveCentreId, getSettings, setActiveCentreId, setSettings } from './lib/storage.js';
import { isDark } from './lib/sun.js';
import { allCentres, findCentre, loadBuiltInCentres, routesFor } from './services/centres.js';
import { compileRoute, getCompiled } from './services/compiler.js';
import { $, toast } from './ui/dom.js';
import { MapView } from './ui/map.js';
import * as home from './ui/home.js';
import * as preview from './ui/preview.js';
import * as navigate from './ui/navigate.js';
import * as settingsPage from './ui/settings.js';
import * as centresPage from './ui/centres.js';
import * as editor from './ui/editor.js';
import * as record from './ui/record.js';
import { APP_VERSION } from './version.js';

const SCREENS = { home, preview, navigate, settings: settingsPage, centres: centresPage, editor, record };

export { APP_VERSION };

class App {
  constructor() {
    this.settings = getSettings();
    this.voice = new Voice();
    this.voice.enabled = this.settings.voice;
    this.voice.voiceName = this.settings.voiceName;
    this.voice.rate = this.settings.voiceRate;
    this.wake = new ScreenWake();
    this.centre = null;
    this.compiled = new Map();
    this.inflight = new Map();
    this.screen = null;
    this.screenName = null;
    this.history = [];
  }

  async init() {
    // iOS only allows speech after a tap; unlock it on the first one.
    const unlock = () => {
      this.voice.unlock();
      document.removeEventListener('touchend', unlock, true);
      document.removeEventListener('click', unlock, true);
    };
    document.addEventListener('touchend', unlock, true);
    document.addEventListener('click', unlock, true);

    this.map = new MapView($('#map'), { theme: this.themeFor() });
    this.map.on('stylefallback', () => toast('Using basic map tiles (the main map service is unavailable).'));
    await loadBuiltInCentres();
    const id = getActiveCentreId();
    this.centre = findCentre(id) || allCentres()[0] || null;
    if (this.centre && this.centre.id !== id) setActiveCentreId(this.centre.id);
    if (this.centre) this.map.flyTo(this.centre.location, 13);
    setInterval(() => this.applyTheme(), 5 * 60000);
    window.addEventListener('resize', () => this.map.resize());
    this.show('home');
    this.registerServiceWorker();
  }

  themeFor() {
    const t = this.settings.mapTheme;
    if (t === 'light' || t === 'dark') return t;
    const loc = this.centre?.location || [-1.2383, 52.9047];
    return isDark(new Date(), loc[1], loc[0]) ? 'dark' : 'light';
  }

  applyTheme() {
    this.map?.setTheme(this.themeFor());
  }

  updateSettings(patch) {
    this.settings = setSettings(patch);
    this.voice.enabled = this.settings.voice;
    this.voice.voiceName = this.settings.voiceName;
    this.voice.rate = this.settings.voiceRate;
    if ('mapTheme' in patch) this.applyTheme();
    this.emitSettings?.(this.settings);
  }

  setCentre(id) {
    const c = findCentre(id);
    if (!c) return;
    this.centre = c;
    setActiveCentreId(id);
    this.compiled.clear();
    this.map.clearRoute();
    this.map.showOutline([]);
    this.map.flyTo(c.location, 13);
    this.applyTheme();
  }

  refreshCentre() {
    if (this.centre) this.centre = findCentre(this.centre.id) || this.centre;
  }

  routes(opts) {
    return routesFor(this.centre, opts);
  }

  route(id) {
    return this.routes({ includeHidden: true }).find((r) => r.id === id) || null;
  }

  async cachedRoute(route) {
    const key = route.id;
    if (this.compiled.has(key)) return this.compiled.get(key);
    const data = await getCompiled(this.centre, route);
    if (data) this.compiled.set(key, data);
    return data;
  }

  /** Compile (or fetch from cache) a route's drivable data. De-duplicates concurrent calls. */
  async compile(route, opts = {}) {
    const key = `${this.centre.id}/${route.id}`;
    if (!opts.force) {
      const cached = await this.cachedRoute(route);
      if (cached) return cached;
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = compileRoute(this.centre, route, opts)
      .then((data) => {
        this.compiled.set(route.id, data);
        return data;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  show(name, params = {}, { replace = false } = {}) {
    const next = SCREENS[name];
    if (!next) return;
    try {
      this.screen?.leave?.(this);
    } catch (err) {
      console.error(err);
    }
    if (!replace && this.screenName && this.screenName !== name) this.history.push({ name: this.screenName, params: this.screenParams });
    this.screen = next;
    this.screenName = name;
    this.screenParams = params;
    $('#sheet').hidden = !!next.fullscreen;
    $('#page').hidden = true;
    $('#nav').hidden = true;
    next.enter(this, params);
  }

  back(fallback = 'home') {
    const prev = this.history.pop();
    if (prev) this.show(prev.name, prev.params, { replace: true });
    else this.show(fallback, {}, { replace: true });
  }

  goHome() {
    this.history = [];
    this.show('home', {}, { replace: true });
  }

  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            this.updateReady = w;
            if (this.screenName !== 'navigate') toast('An update is ready. It will be used next time you open the app.', { ms: 5000 });
          }
        });
      });
    }).catch((err) => console.warn('Service worker registration failed', err));
  }
}

export const app = new App();
window.__app = app;
app.init().catch((err) => {
  console.error(err);
  toast('Something went wrong starting the app. Try reloading.');
});
