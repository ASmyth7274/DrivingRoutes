// Renders icons/icon.svg to the PNG sizes the app and iOS need.
// Usage: node tools/make-icons.mjs   (needs Playwright + Chromium)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(path.join(root, 'icons/icon.svg'), 'utf8');

const outputs = [
  { file: 'icon-192.png', size: 192, radius: 0.22, pad: 0 },
  { file: 'icon-512.png', size: 512, radius: 0.22, pad: 0 },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, pad: 0.1 },
  { file: 'apple-touch-icon.png', size: 180, radius: 0, pad: 0 },
];

const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
for (const o of outputs) {
  const inner = Math.round(o.size * (1 - o.pad * 2));
  await page.setViewportSize({ width: o.size, height: o.size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:${o.size}px;height:${o.size}px;display:grid;place-items:center;background:${o.pad ? '#0a3a8c' : 'transparent'}">
      <div style="width:${inner}px;height:${inner}px;border-radius:${o.radius * 100}%;overflow:hidden">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
    </div></body></html>`);
  await page.screenshot({ path: path.join(root, 'icons', o.file), omitBackground: true });
  console.log('wrote', o.file);
}
await browser.close();
