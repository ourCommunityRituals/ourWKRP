// Build a creator showcase page.
//   node showcase/build-page.mjs <creator.json>
// Reads:  the creator file, showcase/categories.json, showcase/theme.css, and
//         showcase/work/<slug>/reports.json when the seed has run (private: it
//         holds signed report links).
// Writes: showcase/out/<slug>/index.html and a public reports.json beside the
//         img/ files the capture step wrote. Only out/<slug>/ is ever published.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildShowcase, readJson, SHOWCASE } from './lib/build.mjs';

const creatorPath = process.argv[2];
if (!creatorPath) {
  console.error('usage: node showcase/build-page.mjs <creator.json>');
  process.exit(2);
}
const creator = readJson(resolve(creatorPath));
const reportsFile = join(SHOWCASE, 'work', creator.slug, 'reports.json');
const reports = existsSync(reportsFile) ? readJson(reportsFile) : { reports: [] };
const outDir = join(SHOWCASE, 'out', creator.slug);
const { missing } = buildShowcase({ creator, reports, outDir });
if (missing.length) {
  console.error(`missing report images in ${outDir}: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`built ${join('showcase', 'out', creator.slug, 'index.html')} (${creator.stations.length} stations, ${reports.reports.length} reports)`);
