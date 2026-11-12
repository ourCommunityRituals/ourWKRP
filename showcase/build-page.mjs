// Build a creator showcase: the creator page and one page per station.
//   node showcase/build-page.mjs <creator.json> [--ose <base>]
// Reads:  the creator file, showcase/categories.json, showcase/theme.css,
//         showcase/work/<slug>/reports.json when the seed has run (private: it
//         holds signed report links), and, when the creator links OSE events,
//         OSE's public API at <base>: a local worker (127.0.0.1 / localhost) or
//         OSE staging, never production. Without --ose, OSE_BASE or the local
//         worker's showcase/local-ose.env.json gives the base.
// Writes: showcase/out/<slug>/index.html, out/<slug>/<station>/index.html and a
//         public reports.json beside the img/ files the capture step wrote.
//         Only out/<slug>/ is ever published.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildShowcase, readJson, SHOWCASE } from './lib/build.mjs';
import { readOse } from './lib/ose.mjs';
import { createPacer } from './lib/showcase.mjs';

const args = process.argv.slice(2);
const creatorPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--ose');
if (!creatorPath) {
  console.error('usage: node showcase/build-page.mjs <creator.json> [--ose <base>]');
  process.exit(2);
}
const creator = readJson(resolve(creatorPath));
const reportsFile = join(SHOWCASE, 'work', creator.slug, 'reports.json');
const reports = existsSync(reportsFile) ? readJson(reportsFile) : { reports: [] };
const outDir = join(SHOWCASE, 'out', creator.slug);

let ose = { origin: null, linked: [] };
if ((creator.events ?? []).length) {
  const envFile = join(SHOWCASE, 'local-ose.env.json');
  const flag = args.indexOf('--ose');
  const base = (flag >= 0 ? args[flag + 1] : null) || process.env.OSE_BASE || (existsSync(envFile) ? readJson(envFile).base : null);
  // OSE counts about 60 public reads a minute from one caller; stay under it.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  ose = await readOse({ base, creator, paced: createPacer({ sleep }) });
  for (const d of ose.dropped) console.warn(`dropped ${d.link.frequency}: ${d.link.oseEventId} (${d.reason})`);
}

const { missing, pages } = buildShowcase({ creator, reports, outDir, ose });
if (missing.length) {
  console.error(`missing report images in ${outDir}: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(
  `built ${join('showcase', 'out', creator.slug)} (${Object.keys(pages).length} pages, ${reports.reports.length} reports, ${ose.linked.length} OSE events${ose.origin ? ` from ${ose.origin}` : ''})`,
);
