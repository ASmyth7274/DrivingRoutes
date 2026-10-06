import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function walk(dir) {
  return readdirSync(path.join(root, dir)).flatMap((f) => {
    const rel = `${dir}/${f}`;
    return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

function shellList() {
  const sw = readFileSync(path.join(root, 'sw.js'), 'utf8');
  const block = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('service worker precaches every app script and data file', () => {
  const shell = new Set(shellList());
  const needed = [...walk('js'), ...walk('data'), 'css/app.css', 'index.html', 'manifest.webmanifest'];
  const missing = needed.filter((f) => !shell.has(f));
  assert.deepEqual(missing, [], `add these to SHELL in sw.js: ${missing.join(', ')}`);
});

test('every precached file exists', () => {
  const absent = shellList().filter((f) => f !== './' && !existsSync(path.join(root, f)));
  assert.deepEqual(absent, []);
});

test('service worker and app versions match', () => {
  const sw = readFileSync(path.join(root, 'sw.js'), 'utf8');
  const v = readFileSync(path.join(root, 'js/version.js'), 'utf8');
  const swV = /const VERSION = '([^']+)'/.exec(sw)[1];
  const appV = /APP_VERSION = '([^']+)'/.exec(v)[1];
  assert.equal(swV, appV);
});

test('centre data is well formed', () => {
  const index = JSON.parse(readFileSync(path.join(root, 'data/centres/index.json'), 'utf8'));
  assert.ok(index.centres.length >= 1);
  for (const c of index.centres) {
    const centre = JSON.parse(readFileSync(path.join(root, 'data/centres', c.file), 'utf8'));
    assert.equal(centre.id, c.id);
    assert.ok(Array.isArray(centre.location) && centre.location.length === 2);
    const ids = new Set();
    for (const r of centre.routes) {
      assert.ok(!ids.has(r.id), `duplicate route id ${r.id}`);
      ids.add(r.id);
      assert.ok(r.name && r.waypoints.length >= 2, `route ${r.id} needs a name and waypoints`);
      for (const w of r.waypoints) {
        const p = w.near || w.at;
        assert.ok(Array.isArray(p) && Math.abs(p[0] - centre.location[0]) < 0.2 && Math.abs(p[1] - centre.location[1]) < 0.2, `waypoint in ${r.id} is far from the centre`);
        assert.ok(w.road || w.ref || w.at, `waypoint in ${r.id} needs a road, ref or exact point`);
        if (w.bearing != null) assert.ok(w.bearing >= 0 && w.bearing < 360);
        // An exact point on a dual carriageway needs a direction, or it can snap to the wrong side.
        if (w.at && !w.road && !w.ref) assert.ok(w.bearing != null, `exact waypoint in ${r.id} needs a bearing`);
      }
    }
    for (const h of centre.hotspots || []) {
      assert.ok(h.text && Array.isArray(h.at));
    }
  }
});

test('manifest has the icons iOS and Android need', () => {
  const m = JSON.parse(readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  for (const i of m.icons) assert.ok(existsSync(path.join(root, i.src)), i.src);
  assert.ok(existsSync(path.join(root, 'icons/apple-touch-icon.png')));
});
