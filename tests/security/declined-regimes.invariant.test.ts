/**
 * L0 STATIC: declined regimes (HIPAA, COPPA, SOPPA) over the real OW tree.
 *
 * Standard: OCR-docs/docs/standards/OCR_STANDARD_declinedRegimes.md (ratified
 * 2026-09-04, SOPPA added 2026-09-10; vendored at
 * .ocr-standards/standards/). OSE enforces it through its pool router
 * (OSE-1220); OW stores names, so it must refuse the fields a declined regime
 * would need: no age, birth date or parental-consent field (COPPA), no student
 * or school field (SOPPA), no health or patient field (HIPAA), and no pool or
 * dataset named for any of them.
 *
 * Paired with tests/unit/declined-regime-scan.test.ts, which proves each
 * scanner reports a planted field. Every scan here is anchored on named files
 * and a minimum count, so a glob that stops matching fails instead of passing.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  scanSqlColumns,
  scanSchemaKeys,
  scanFormFields,
  scanDeclinedPools,
  type RegimeViolation,
} from '../support/declined-regime-scan';

const ROOT = path.join(__dirname, '../..');

function filesUnder(dir: string, exts: string[]): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(rel, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(rel);
  }
  return out;
}

const SRC = filesUnder('src', ['.ts']);
const TEMPLATES = filesUnder('src/templates', ['.html']);
const MIGRATIONS = filesUnder('migrations', ['.sql']);
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function report(files: string[], scan: (s: string) => RegimeViolation[]): string[] {
  return files.flatMap((f) => scan(read(f)).map((v) => `${f}:${v.line ?? '?'} ${v.regime}: ${v.detail}`));
}

describe('declined regimes: the gate scanned something', () => {
  it('anchors on real files', () => {
    expect(MIGRATIONS).toContain('migrations/0006_dj_attribution.sql');
    expect(MIGRATIONS.length).toBeGreaterThan(5);
    expect(SRC).toContain('src/lib/schemas.ts');
    expect(SRC.length).toBeGreaterThan(30);
    expect(TEMPLATES).toContain('src/templates/connect.html');
    expect(TEMPLATES.length).toBeGreaterThan(5);
  });

  it('reads the standard it enforces', () => {
    const std = read('.ocr-standards/standards/OCR_STANDARD_declinedRegimes.md');
    for (const regime of ['HIPAA', 'COPPA', 'SOPPA']) expect(std).toContain(regime);
  });
});

describe('declined regimes: no field a declined regime would need', () => {
  it('no migration creates or adds one', () => {
    expect(report(MIGRATIONS, scanSqlColumns)).toEqual([]);
  });
  it('no request schema accepts one', () => {
    expect(report(SRC, scanSchemaKeys)).toEqual([]);
  });
  it('no page asks for one', () => {
    expect(report(TEMPLATES, scanFormFields)).toEqual([]);
  });
  it('no code names a pool or dataset for one', () => {
    expect(report(SRC, scanDeclinedPools)).toEqual([]);
  });
});
