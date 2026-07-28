/**
 * Drift guard — runs in CI (lint stage) via: npx tsx scripts/check-templates.ts
 *
 * Invariant #13: WKRP templates must link /ui.css, must not redeclare :root
 * tokens, and must not carry >400 chars of inline CSS.
 * Violations fail the build immediately.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { checkAll } from '@ocr/ui';

const dir = join(process.cwd(), 'src/templates');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.html'))
  .map((f) => ({ file: f, html: readFileSync(join(dir, f), 'utf8') }));

const findings = checkAll(files);

if (findings.length > 0) {
  console.error('\n[drift-guard] Template drift detected:\n');
  for (const f of findings) {
    console.error(`  ${f.file} — ${f.issue}\n    ${f.detail}`);
  }
  console.error(`\n${findings.length} finding(s). Fix before merging.\n`);
  process.exit(1);
}

console.log(`[drift-guard] ${files.length}/${files.length} templates clean.`);
