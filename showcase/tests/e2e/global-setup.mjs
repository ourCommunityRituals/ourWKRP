// Build the fictional fixture page into showcase/.e2e/site, with placeholder
// report images drawn by the browser (so no binary lives in the repo). The
// page, its links and its layout are the real build's; only the pictures of
// the reports are stand-ins. The integration job captures real ones.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { buildShowcase, readJson, SHOWCASE } from '../../lib/build.mjs';
import { seededReports } from '../checks.mjs';

export default async function globalSetup() {
  const site = join(SHOWCASE, '.e2e', 'site');
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
  const { missing } = buildShowcase({ creator: readJson(join(SHOWCASE, 'fixtures', 'sample-creator.json')), reports, outDir: site });
  if (missing.length) throw new Error(`e2e setup: missing images ${missing.join(', ')}`);
  // PLANTED FAULT (born-red proof, reverted next commit): the teach images do not decode.
  for (const v of ['card', 'phone']) (await import('node:fs')).writeFileSync(join(site, `img/teach-${v}.jpg`), 'not an image');
}
