// Build the fictional fixture into showcase/.e2e/site: the creator page and one
// page per station, with placeholder report images drawn by the browser (so no
// binary lives in the repo) and OSE answered by the stand-in built from the seed
// plan (tests/fake-ose.mjs). The pages, links, codes and layout are the real
// build's (build-site.mjs); the integration job runs the same build against a
// real local worker.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { seededReports } from '../checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  const site = join(HERE, '..', '..', '.e2e', 'site');
  rmSync(site, { recursive: true, force: true });
  mkdirSync(join(site, 'img'), { recursive: true });
  const reports = seededReports();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const r of reports.reports) {
      for (const [view, size] of [['card', [960, 950]], ['desktop', [1280, 1600]], ['phone', [390, 844]]]) {
        await page.setViewportSize({ width: size[0], height: size[1] });
        await page.setContent(`<body style="margin:0;display:grid;place-items:center;height:100vh;font:24px system-ui;background:Canvas;color:CanvasText">Placeholder: ${r.title} (${view})</body>`);
        await page.screenshot({ path: join(site, r.images[view]), type: 'jpeg', quality: 60 });
      }
    }
  } finally {
    await browser.close();
  }
  execFileSync(process.execPath, [join(HERE, 'build-site.mjs'), site], { stdio: 'inherit' });
}
