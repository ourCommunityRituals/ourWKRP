// Capture each station's real SharedReport page from the LOCAL worker.
//   node showcase/capture-reports.mjs <slug>
// Reads showcase/work/<slug>/reports.json (from seed-local.mjs). Writes
// showcase/out/<slug>/img/<station>-{card,desktop,phone}.jpg, and records the
// image paths and the page text back into the private work file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { assertLocalBase } from './lib/showcase.mjs';
import { SHOWCASE, readJson } from './lib/build.mjs';

const slug = process.argv[2];
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug ?? '')) {
  console.error('usage: node showcase/capture-reports.mjs <slug>');
  process.exit(2);
}
const workFile = join(SHOWCASE, 'work', slug, 'reports.json');
const data = readJson(workFile);
const base = assertLocalBase(data.base);
const outDir = join(SHOWCASE, 'out', slug);
mkdirSync(join(outDir, 'img'), { recursive: true });

const VIEWS = [
  { name: 'card', viewport: { width: 960, height: 950 }, fullPage: false },
  { name: 'desktop', viewport: { width: 1280, height: 860 }, fullPage: true },
  { name: 'phone', viewport: { width: 390, height: 844 }, fullPage: false, deviceScaleFactor: 2, isMobile: true },
];

const browser = await chromium.launch();
try {
  for (const r of data.reports) {
    r.images = {};
    for (const v of VIEWS) {
      const ctx = await browser.newContext({ viewport: v.viewport, colorScheme: 'dark', deviceScaleFactor: v.deviceScaleFactor ?? 1, isMobile: v.isMobile ?? false });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(base + r.reportPath, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const file = `img/${r.station}-${v.name}.jpg`;
      await page.screenshot({ path: join(outDir, file), fullPage: v.fullPage, type: 'jpeg', quality: 80 });
      r.images[v.name] = file;
      if (v.name === 'desktop') {
        r.pageText = (await page.locator('body').innerText()).slice(0, 4000);
        r.pageErrors = errors;
      }
      await ctx.close();
    }
    console.log(`${r.station}: captured (${r.pageErrors.length} page errors)`);
  }
} finally {
  await browser.close();
}
writeFileSync(workFile, JSON.stringify(data, null, 2));
