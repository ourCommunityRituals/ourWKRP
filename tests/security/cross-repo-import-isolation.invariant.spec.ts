/**
 * Cross-Repo Import Isolation — architectural invariant #22 (OCR governance brain)
 * ================================================================================
 *
 * Brain entry: OCR-docs/ocr-docs-brain/architectural-invariants.yaml #22
 *   `cross_repo_import_isolation` — status: live — applies_to: [ose, wkrp, oaw].
 *   "No module-level import may cross the OSE / WKRP / OAW repo boundary. The
 *    only permitted cross-repo data flow is the OER aggregation HTTP seam
 *    (GET /api/events/:id/music). Shared @ocr/* packages are permitted."
 *
 * WKRP is the named-pole (voluntary attribution); OSE is the anonymous-pole.
 * A module-level import across the boundary would silently couple the two
 * identity models at the code level — an identity-leakage path that bypasses
 * the HTTP seam's CORS controls. This invariant forbids it in BOTH directions;
 * this spec is WKRP's side (OSE-1288 / F13).
 *
 * Enforcement (OSE-1288): #22 declares `enforcement_kind: brain_script`. The
 * canonical guard is the brain-resident, live-read
 * `ocr-docs-brain/scripts/check_cross_repo_imports.py`, run in
 * `brain-contract-check.yml`. This spec is WKRP-local defense-in-depth: a
 * fast tripwire on WKRP source PLUS an anti-theater lock proving the brain
 * guard is actually wired into CI and not neutered — so the gate can never
 * silently stop running. Mirrors tests/security/deprecation-lock.invariant.spec.ts.
 *
 * STRUCTURAL test — reads source files and CI config and asserts shape. Runs
 * in CI via `npm run test:security` (Security Tests job). LIMITATIONS: a
 * structural tripwire catches a literal sibling import, not one rebuilt through
 * computed strings or indirection; the brain guard (which derives prohibited
 * scopes from product-registry.yaml) is the authoritative scan.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

/** Recursively collect every .ts source file under src/. */
function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

const ALL_SRC = srcFiles();
const read = (f: string) => fs.readFileSync(f, 'utf-8');
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/');

// Sibling product package scopes (from WKRP's perspective). @ocr/* is the
// permitted shared-package scope and is NOT listed here.
const FORBIDDEN_IMPORT = [
  /\bfrom\s+['"]@oursharedevents\//,
  /\bfrom\s+['"]@ourairwaves\//,
  /\brequire\(\s*['"]@?oursharedevents\//,
  /\brequire\(\s*['"]@?ourairwaves\//,
  /\bimport\(\s*['"]@(?:oursharedevents|ourairwaves)\//,
];

// ============================================================
// 1 — No module import crosses the WKRP ↔ OSE/OAW boundary
// ============================================================
describe('#22 — no source file imports a sibling product package', () => {
  it('src/ contains no @oursharedevents/@ourairwaves module import', () => {
    const offenders = ALL_SRC.filter((f) => {
      const s = read(f);
      return FORBIDDEN_IMPORT.some((re) => re.test(s));
    }).map(rel);
    expect(offenders).toEqual([]);
  });
});

// ============================================================
// 2 — package.json declares no sibling-repo dependency
// ============================================================
describe('#22 — package.json declares no sibling-repo dependency', () => {
  const pkg = read(path.join(ROOT, 'package.json'));
  it('no @oursharedevents / @ourairwaves dependency', () => {
    expect(pkg).not.toMatch(/@oursharedevents\//);
    expect(pkg).not.toMatch(/@ourairwaves\//);
  });
  it('no file:/link:/workspace: link to a sibling product repo', () => {
    expect(pkg).not.toMatch(/(?:file|link|workspace):[^"]*ourSharedEvents/i);
    expect(pkg).not.toMatch(/(?:file|link|workspace):[^"]*ourAirwaves/i);
  });
});

// ============================================================
// 3 — The live-read brain guard is wired into CI (anti-theater lock)
// ============================================================
describe('#22 — the brain_script guard is wired into CI and not neutered', () => {
  const BCC = read(path.join(ROOT, '.github/workflows/brain-contract-check.yml'));

  it('brain-contract-check.yml invokes the canonical brain guard for wkrp', () => {
    expect(BCC).toContain('check_cross_repo_imports.py');
    expect(BCC).toContain('--product-id wkrp');
  });

  it('the workflow is pull_request-triggered', () => {
    expect(BCC).toMatch(/^on:/m);
    expect(BCC).toMatch(/pull_request:/);
  });

  it('the guard invocation is not neutered (no || true / continue-on-error)', () => {
    // The guard step's run block must not swallow the exit code, and the step
    // must not carry continue-on-error. Scan the window around the invocation.
    const idx = BCC.indexOf('check_cross_repo_imports.py');
    const window = BCC.slice(Math.max(0, idx - 200), idx + 200);
    expect(window).not.toMatch(/\|\|\s*true/);
    expect(window).not.toMatch(/continue-on-error:\s*true/);
  });

  it('CI runs the security suite that contains this invariant', () => {
    const ci = read(path.join(ROOT, '.github/workflows/ci.yml'));
    expect(ci).toContain('npm run test:security');
  });

  it('vitest is configured to execute *.invariant.spec.ts files', () => {
    const cfg = read(path.join(ROOT, 'vitest.config.ts'));
    expect(cfg).toMatch(/invariant\.spec\.ts/);
  });
});
