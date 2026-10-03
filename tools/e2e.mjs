// End-to-end smoke test in Chromium at iPhone 17 size, with the map, routing
// and OpenStreetMap services replaced by local fakes (so it runs offline).
//
//   node tools/e2e.mjs [outDir]
//
// Saves screenshots to outDir (default: ./e2e-output) and exits non-zero on
// any page error or failed check.

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePolyline } from '../js/lib/polyline.js';
import { bearing, destination, distance } from '../js/lib/geo.js';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.resolve(process.argv[2] || path.join(root, 'e2e-output'));
await mkdir(outDir, { recursive: true });

// ---------- static server ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root)) throw new Error('bad path');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---------- fake services ----------
let osrmCalls = 0;
let overpassCalls = 0;
let rerouteCalls = 0;

function fakeOverpass(body) {
  overpassCalls++;
  const q = decodeURIComponent(body.replace(/^data=/, '').replace(/\+/g, ' '));
  const elements = [];
  let id = 1;
  const re = /way\(around:(\d+),([\d.-]+),([\d.-]+)\)\["highway"\]\["(name|ref)"~"([^"]+)",i\]/g;
  let m;
  while ((m = re.exec(q))) {
    const lat = Number(m[2]);
    const lon = Number(m[3]);
    let value = m[5];
    const tags = { highway: 'primary' };
    if (m[4] === 'ref') tags.ref = value.replace('(^|;) ?', '').replace('(;|$)', '');
    else tags.name = value.replace(/^\^|\$$/g, "").replace(/'\?/g, '').replace(/\\/g, '');
    elements.push({
      type: 'way', id: id++, tags,
      nodes: [id * 10, id * 10 + 1, id * 10 + 2],
      geometry: [{ lat, lon: lon - 0.003 }, { lat, lon }, { lat, lon: lon + 0.003 }],
    });
  }
  return { elements };
}

function fakeOsrmRoute(url) {
  osrmCalls++;
  const coords = decodeURIComponent(url.pathname.split('/driving/')[1]).split(';').map((s) => s.split(',').map(Number));
  if (url.search.includes('bearings=') && coords.length && rerouteCalls >= 0) rerouteCalls++;
  const legs = [];
  const names = ['Eldon Road', 'Barton Lane', 'Nottingham Road', 'High Road', 'Stapleford Lane', 'Brian Clough Way', 'Toton Lane', 'Chilwell Road'];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const brg = bearing(a, b);
    const d = Math.max(distance(a, b), 1);
    const mid = destination(destination(a, brg, d / 2), brg + 90, Math.min(120, d / 4));
    const steps = [];
    const name1 = names[(2 * i) % names.length];
    const name2 = names[(2 * i + 1) % names.length];
    const d1 = distance(a, mid);
    const d2 = distance(mid, b);
    steps.push({ geometry: { type: 'LineString', coordinates: [a, mid] }, maneuver: { type: 'depart', location: a, bearing_before: 0, bearing_after: Math.round(bearing(a, mid)) }, name: name1, distance: d1, duration: d1 / 12, driving_side: 'left', intersections: [{ location: a, bearings: [Math.round(bearing(a, mid))], entry: [true], out: 0 }] });
    const rb = i % 3 === 1;
    steps.push({
      geometry: { type: 'LineString', coordinates: [mid, b] },
      maneuver: rb
        ? { type: 'roundabout', exit: 2, modifier: 'straight', location: mid, bearing_before: Math.round(bearing(a, mid)), bearing_after: Math.round(bearing(mid, b)) }
        : { type: 'turn', modifier: i % 2 ? 'right' : 'left', location: mid, bearing_before: Math.round(bearing(a, mid)), bearing_after: Math.round(bearing(mid, b)) },
      name: name2, ref: rb ? 'A52' : undefined, distance: d2, duration: d2 / 12, driving_side: 'left',
      intersections: [{ location: mid, bearings: [0, 90, 180, 270], entry: [true, true, true, true], in: 2, out: 1, lanes: rb ? undefined : [{ indications: ['left'], valid: i % 2 === 0 }, { indications: ['straight', 'right'], valid: i % 2 === 1 }] }],
    });
    steps.push({ geometry: { type: 'LineString', coordinates: [b, b] }, maneuver: { type: 'arrive', location: b, bearing_before: 0, bearing_after: 0 }, name: name2, distance: 0, duration: 0, driving_side: 'left', intersections: [{ location: b, bearings: [0], entry: [true], in: 0 }] });
    legs.push({ steps, distance: d1 + d2, duration: (d1 + d2) / 12 });
  }
  const total = legs.reduce((s, l) => s + l.distance, 0);
  return {
    code: 'Ok',
    routes: [{ legs, distance: total, duration: total / 12 }],
    waypoints: coords.map((c) => ({ location: c, name: 'x', distance: 1 })),
  };
}

function fakeTrace(url) {
  const req = JSON.parse(url.searchParams.get('json'));
  const pts = decodePolyline(req.encoded_polyline, 6);
  return {
    edges: [{ speed_limit: 48 }, { speed_limit: 64 }],
    matched_points: pts.map((_, i) => ({ edge_index: i < pts.length / 2 ? 0 : 1, type: 'matched' })),
  };
}

const STYLE = (bg) => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }] });

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(obj) });
  if (url.origin + '/' === base || req.url().startsWith(base)) return route.continue();
  switch (url.hostname) {
    case 'tiles.openfreemap.org':
      if (url.pathname.startsWith('/styles/dark')) return json(STYLE('#1d2433'));
      if (url.pathname.startsWith('/styles/')) return json(STYLE('#e8eaed'));
      return route.fulfill({ status: 404, body: '' });
    case 'router.project-osrm.org':
      if (url.pathname.startsWith('/nearest/')) {
        const [lon, lat] = url.pathname.split('/driving/')[1].split('?')[0].split(',').map(Number);
        return json({ code: 'Ok', waypoints: [{ location: [lon, lat], name: 'Mock Street', distance: 4 }] });
      }
      return json(fakeOsrmRoute(url));
    case 'valhalla1.openstreetmap.de':
      if (url.pathname.startsWith('/trace_attributes')) return json(fakeTrace(url));
      return json({ error: 'not in test' }, 500);
    case 'overpass-api.de':
      return json(fakeOverpass(req.postData() || ''));
    case 'nominatim.openstreetmap.org':
      return json([{ name: 'Colwick Driving Test Centre', display_name: 'Colwick Driving Test Centre, Nottingham', lon: '-1.0950', lat: '52.9560' }]);
    default:
      return route.fulfill({ status: 404, body: '' });
  }
}

// ---------- run ----------
const failures = [];
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.error('FAIL:', msg); } else console.log('ok:', msg); };

const browser = await playwright.chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 402, height: 874 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  geolocation: { latitude: 52.9047, longitude: -1.2383, accuracy: 8 },
  permissions: ['geolocation'],
  serviceWorkers: 'block',
  locale: 'en-GB',
  timezoneId: 'Europe/London',
});
await context.route('**/*', handle);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

await page.goto(base);
await page.waitForSelector('.route-card', { timeout: 15000 });
check((await page.locator('.route-card').count()) >= 7, 'home lists the Chilwell routes');
await page.waitForTimeout(1500);
await shot('01-home');

// Wait for background preparation of all routes (fake services are instant).
await page.waitForFunction(() => !document.querySelector('#prep-status .spinner'), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
await shot('02-home-prepared');
check(overpassCalls >= 7, `routes resolved road names (${overpassCalls} Overpass calls)`);

// Open the first route
await page.locator('.route-card').first().click();
await page.waitForSelector('[data-act="drive"]', { timeout: 15000 });
await page.waitForTimeout(800);
await shot('03-preview');
check(await page.locator('.steps-list li').count() > 3, 'preview shows turn-by-turn list');

// Practice drive (simulated)
await page.locator('[data-act="sim"]').click();
await page.waitForSelector('#nv-banner', { timeout: 10000 });
await page.waitForTimeout(4500);
await shot('04-nav-sim');
const bannerText = await page.locator('#nv-text').textContent();
check(bannerText && bannerText.length > 3 && !/Waiting/.test(bannerText), `banner shows an instruction: "${bannerText}"`);
check((await page.locator('#nv-eta').textContent()) !== '--:--', 'ETA shown');

// Speed up and take a wrong turn
await page.locator('#nv-sim-speed').click();
await page.locator('#nv-sim-speed').click();
await page.waitForTimeout(3000);
const callsBefore = osrmCalls;
await page.locator('#nv-sim-wrong').click();
await page.waitForTimeout(2500);
await shot('05-nav-offroute');
await page.waitForFunction(() => window.__app && document.querySelector('#nv-banner') && !document.querySelector('#nv-banner').classList.contains('off'), null, { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(1500);
await shot('06-nav-rerouted');
check(osrmCalls > callsBefore, `rerouted after wrong turn (${osrmCalls - callsBefore} routing calls)`);

// Lanes and roundabout icons render at some point; check the speed limit sign appeared
const limitVisible = await page.locator('#nv-limit').isVisible();
check(limitVisible, 'speed limit sign visible');

// Landscape layout
await page.setViewportSize({ width: 874, height: 402 });
await page.waitForTimeout(1200);
await shot('07-nav-landscape');
await page.setViewportSize({ width: 402, height: 874 });
await page.waitForTimeout(500);

// End the route
await page.locator('#nv-end').click();
await page.locator('.modal .btn.danger').click();
await page.waitForSelector('[data-act="drive"]', { timeout: 10000 });
check(true, 'ended navigation back to preview');

// Settings page
await page.locator('[data-act="back"]').first().click();
await page.waitForSelector('[data-act="settings"]');
await page.locator('[data-act="settings"]').click();
await page.waitForSelector('.page-head');
await page.waitForTimeout(400);
await shot('08-settings');
await page.locator('[data-seg="voiceStyle"] button[data-v="examiner"]').click();
check(await page.evaluate(() => JSON.parse(localStorage.getItem('dtr:v1')).settings.voiceStyle) === 'examiner', 'settings saved');
await page.locator('[data-act="back"]').click();

// Centres page and add a centre via search
await page.waitForSelector('[data-act="centres"]');
await page.locator('.centre-chip').click();
await page.waitForSelector('#centre-q');
await page.fill('#centre-q', 'Colwick');
await page.press('#centre-q', 'Enter');
await page.waitForSelector('[data-pick="0"]');
await shot('09-centres');
await page.locator('[data-pick="0"]').click();
await page.waitForSelector('.modal input');
await page.locator('.modal button[type="submit"]').click();
await page.waitForSelector('.centre-chip');
await page.waitForTimeout(500);
const centreName = await page.locator('.centre-chip .name').textContent();
check(/Colwick/.test(centreName), `switched to new centre "${centreName}"`);
await shot('10-new-centre');

// Practice loop for the new centre
await page.locator('[data-act="loop"]').click();
await page.waitForSelector('[data-act="drive"]', { timeout: 15000 });
await page.waitForTimeout(600);
await shot('11-practice-loop');
check(true, 'generated a practice loop');

// Route editor
await page.locator('[data-act="back"]').first().click();
await page.waitForSelector('[data-act="create"]');
await page.locator('[data-act="create"]').click();
await page.waitForSelector('#ed-panel');
const mapBox = await page.locator('#map').boundingBox();
for (const [fx, fy] of [[0.3, 0.2], [0.6, 0.25], [0.5, 0.35]]) {
  await page.mouse.click(mapBox.x + mapBox.width * fx, mapBox.y + mapBox.height * fy);
  await page.waitForTimeout(300);
}
await page.waitForTimeout(1500);
await shot('12-editor');
check(await page.locator('.wp-list li').count() === 3, 'editor added three waypoints');
await page.fill('#ed-name', 'My test loop');
await page.locator('[data-act="save"]').click();
await page.waitForSelector('[data-act="drive"]', { timeout: 15000 });
check(/My test loop/.test(await page.locator('.preview-head h2').textContent()), 'saved custom route opens in preview');

// Switch back to Chilwell and run a mock test briefly
await page.locator('[data-act="back"]').first().click();
await page.waitForSelector('.centre-chip');
await page.locator('.centre-chip').click();
await page.locator('[data-centre="nottingham-chilwell"]').click();
await page.waitForSelector('[data-act="mock"]');
await page.locator('[data-act="mock"]').click();
await page.locator('.modal .btn', { hasText: 'Practice at home' }).click();
await page.waitForSelector('#nv-banner', { timeout: 15000 });
await page.waitForTimeout(3000);
await shot('13-mock-test');
check((await page.locator('#nv-status').textContent()).includes('Mock'), 'mock test status shown');

// ---------- offline: service worker serves the app with no network ----------
{
  const ctx = await browser.newContext({
    viewport: { width: 402, height: 874 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: 52.9047, longitude: -1.2383, accuracy: 8 },
    permissions: ['geolocation'],
    serviceWorkers: 'allow',
    locale: 'en-GB',
  });
  await ctx.route('**/*', handle);
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push(`offline pageerror: ${e.message}`));
  await p2.goto(base);
  await p2.waitForSelector('.route-card', { timeout: 15000 });
  await p2.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    }
  });
  check(await p2.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');
  // Let the app prepare (and cache) every route while "online".
  await p2.waitForFunction(() => !document.querySelector('#prep-status .spinner'), null, { timeout: 30000 }).catch(() => {});
  await p2.waitForTimeout(1000);
  await ctx.setOffline(true);
  await p2.reload();
  await p2.waitForSelector('.route-card', { timeout: 15000 });
  check((await p2.locator('.route-card').count()) >= 7, 'app opens offline with all routes');
  await p2.locator('.route-card').nth(1).click();
  await p2.waitForSelector('[data-act="drive"]', { timeout: 10000 });
  check(await p2.locator('.steps-list li').count() > 3, 'saved route opens offline');
  await p2.locator('[data-act="sim"]').click();
  await p2.waitForSelector('#nv-banner', { timeout: 10000 });
  await p2.waitForTimeout(3000);
  await p2.screenshot({ path: path.join(outDir, '14-offline-nav.png') });
  check(!/Waiting/.test(await p2.locator('#nv-text').textContent()), 'navigation runs offline');
  await ctx.close();
}

await browser.close();
server.close();

for (const e of errors) console.error(e);
const realErrors = errors.filter((e) => !/Failed to load resource/.test(e));
if (realErrors.length) failures.push(`${realErrors.length} page errors`);
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL CHECKS PASSED');
console.log(`Screenshots in ${outDir}`);
process.exit(failures.length ? 1 : 0);
