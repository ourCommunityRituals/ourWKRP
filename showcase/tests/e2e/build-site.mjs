// Build the fixture's pages into a folder, reading OSE from the stand-in built
// from the seed plan. Run by global-setup.mjs as its own Node process, so the
// build (and OW's QR encoder, src/lib/qr.ts) loads exactly as build-page.mjs
// loads it, not through Playwright's module loader.
//   node showcase/tests/e2e/build-site.mjs <dir>
import { join } from 'node:path';
import { buildShowcase, readJson, SHOWCASE } from '../../lib/build.mjs';
import { readOse } from '../../lib/ose.mjs';
import { seededReports } from '../checks.mjs';
import { fakeOse, FAKE_ORIGIN, NOW } from '../fake-ose.mjs';

const site = process.argv[2];
const creator = readJson(join(SHOWCASE, 'fixtures', 'sample-creator.json'));
const ose = await readOse({ base: FAKE_ORIGIN, creator, fetch: fakeOse(), now: NOW });
const { missing, pages } = buildShowcase({ creator, reports: seededReports(), outDir: site, ose, now: NOW });
if (missing.length) {
  console.error(`e2e setup: missing images ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`e2e site: ${Object.keys(pages).join(', ')}`);
