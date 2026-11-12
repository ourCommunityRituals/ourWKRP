// Build one creator's publishable folder: index.html, a public copy of the
// report summary, and the img/ files the capture step wrote. The build refuses
// to write anything that carries a secret or an identity.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage } from './render.mjs';
import { creatorProblems } from './schema.mjs';
import { publicReport, findSecrets, findIdentities } from './showcase.mjs';

export const SHOWCASE = join(dirname(fileURLToPath(import.meta.url)), '..');

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\s+/, '')); // \s covers a byte-order mark

export function loadCatalog() {
  return readJson(join(SHOWCASE, 'categories.json'));
}

export function loadTheme() {
  return readFileSync(join(SHOWCASE, 'theme.css'), 'utf8');
}

/** Every text file in a folder, recursively, as [path, text]. Images are skipped. */
export function publishedTexts(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...publishedTexts(p));
    else if (!/\.(jpe?g|png)$/i.test(name)) out.push([p, readFileSync(p, 'utf8')]);
  }
  return out;
}

/** Problems with a would-be published text: secrets first, then identities. */
export function publishProblems(label, text) {
  return [
    ...findSecrets(text).map((k) => `${label}: carries a ${k}`),
    ...findIdentities(text).map((k) => `${label}: carries an ${k}`),
  ];
}

export function buildShowcase({ creator, reports = { reports: [] }, outDir, catalog = loadCatalog(), theme = loadTheme() }) {
  const problems = creatorProblems(creator, catalog);
  if (problems.length) throw new Error(`creator file refused:\n  ${problems.join('\n  ')}`);
  // A whole document, so the page stands alone (head and body tags are optional in HTML).
  const html = `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${renderPage({ creator, catalog: catalog.categories, reports, theme })}</html>\n`;
  const shipped = JSON.stringify({ seededAt: reports.seededAt ?? null, reports: (reports.reports ?? []).map(publicReport) }, null, 2);
  const refused = [...publishProblems('index.html', html), ...publishProblems('reports.json', shipped)];
  if (refused.length) throw new Error(`publish refused:\n  ${refused.join('\n  ')}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  writeFileSync(join(outDir, 'reports.json'), shipped);
  const missing = (reports.reports ?? [])
    .flatMap((r) => Object.values(publicReport(r).images ?? {}))
    .filter((img) => !existsSync(join(outDir, img)));
  return { html, missing };
}
