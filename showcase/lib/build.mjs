// Build one creator's publishable folder: index.html (the dial), one
// <station>/index.html per station, a public copy of the report summary, and the
// img/ files the capture step wrote. The build refuses to write anything that
// carries a secret or an identity, or a code that is not an OSE /q or /s URL.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPages } from './render.mjs';
import { creatorProblems } from './schema.mjs';
import { publicReport, findSecrets, findIdentities } from './showcase.mjs';
import { codeUrlProblem, qrPath } from './codes.mjs';

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

/**
 * Problems with the codes on one page. Every code is an OSE /q or /s URL on the
 * origin the build read, its link carries exactly that URL, and its QR code
 * encodes it. A form path or a form query never shows as a code.
 */
export function codeProblems(label, html, origin) {
  const out = [];
  for (const [, url, inner] of html.matchAll(/<figure class="code" data-code-url="([^"]*)">([\s\S]*?)<\/figure>/g)) {
    const raw = url.replaceAll('&amp;', '&');
    const bad = origin ? codeUrlProblem(raw, origin) : 'a code on a page built without OSE';
    if (bad) out.push(`${label}: code refused (${bad})`);
    const hrefs = [...inner.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)];
    if (hrefs.length !== 1 || hrefs[0][1] !== url || hrefs[0][2] !== url) out.push(`${label}: the link for ${raw} does not carry exactly that URL`);
    const d = inner.match(/<path class="qr-ink" d="([^"]*)"/)?.[1];
    if (!bad && d !== qrPath(raw).d) out.push(`${label}: the QR code for ${raw} does not encode it`);
  }
  if (/\/forms?\/|[?&]type=(register|checkin|survey|email)/i.test(html.match(/data-code-url="[^"]*"/g)?.join(' ') ?? '')) {
    out.push(`${label}: a form is shown as a code`);
  }
  return out;
}

/**
 * Render, check and write one creator's folder.
 * `ose` is what lib/ose.mjs read: `{ origin, linked }`. A creator with no linked
 * events needs none.
 */
export function buildShowcase({ creator, reports = { reports: [] }, outDir, catalog = loadCatalog(), theme = loadTheme(), ose = { origin: null, linked: [] }, now = Date.now() }) {
  const problems = creatorProblems(creator, catalog);
  if (problems.length) throw new Error(`creator file refused:\n  ${problems.join('\n  ')}`);
  // Whole documents, so each page stands alone (head and body tags are optional in HTML).
  const pages = Object.fromEntries(
    Object.entries(renderPages({ creator, catalog: catalog.categories, reports, theme, ose, now })).map(([path, body]) => [
      path,
      `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${body}</html>\n`,
    ]),
  );
  const shipped = JSON.stringify({ seededAt: reports.seededAt ?? null, reports: (reports.reports ?? []).map(publicReport) }, null, 2);
  const refused = [
    ...Object.entries(pages).flatMap(([path, html]) => [...publishProblems(path, html), ...codeProblems(path, html, ose.origin)]),
    ...publishProblems('reports.json', shipped),
  ];
  if (refused.length) throw new Error(`publish refused:\n  ${refused.join('\n  ')}`);
  for (const [path, html] of Object.entries(pages)) {
    mkdirSync(dirname(join(outDir, path)), { recursive: true });
    writeFileSync(join(outDir, path), html);
  }
  writeFileSync(join(outDir, 'reports.json'), shipped);
  const missing = (reports.reports ?? [])
    .flatMap((r) => Object.values(publicReport(r).images ?? {}))
    .filter((img) => !existsSync(join(outDir, img)));
  return { html: pages['index.html'], pages, missing };
}
