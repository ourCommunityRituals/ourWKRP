/**
 * Deprecation Lock — architectural invariant #10 (OCR governance brain)
 * ====================================================================
 *
 * Brain entry: OCR-docs/ocr-docs-brain/architectural-invariants.yaml #10
 *   `deprecation_lock` — status: live — applies_to: [ose, osm, wkrp, oaw].
 *   "Once a runtime is removed from the substrate ... CI MUST forbid its
 *    re-introduction."
 *
 * For OSE the deprecated runtime is Google Apps Script. WKRP's deprecated
 * thing is the Spotify OAuth **Implicit Grant flow** (`response_type=token`):
 * Spotify deprecated it in November 2025, and it is structurally insecure —
 * the access token lands in the URL fragment, leaking into browser history,
 * referrer headers, and extensions. WKRP was built on the Authorization Code
 * Flow + PKCE specifically to replace it. PKCE also removes the need for a
 * `client_secret` (the SPA / Worker has nowhere safe to keep one).
 *
 * This invariant is a one-way door. It forbids:
 *   1. the Implicit Grant flow (`response_type=token`) re-entering the code,
 *   2. a `client_secret` re-entering the code,
 *   3. the fleet-wide Google Apps Script runtime patterns (#10's canonical
 *      instance) — WKRP is a Cloudflare Worker and must stay one.
 * It also locks the PKCE replacement in place, and locks its own CI wiring
 * so the guard can never silently stop running (the failure mode brain #10
 * exists to prevent: "a guard that is never invoked by CI is theater").
 *
 * STRUCTURAL test — reads source files and asserts code shape. Runs in CI
 * via `npm run test:security` (Security Tests job). Mirrors the existing
 * structural pattern in tests/security/ccr-invariants.test.ts.
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
const OAUTH = read(path.join(SRC, 'auth/spotify-oauth.ts'));

// ============================================================
// 1 — Implicit Grant flow is forbidden (the deprecation lock)
// ============================================================
describe('Deprecation Lock #10 — Spotify Implicit Grant flow is forbidden', () => {
  it('no source file declares response_type=token (Implicit Grant)', () => {
    const offenders = ALL_SRC.filter((f) => {
      const s = read(f);
      return /response_type\s*[:=]\s*['"`]?\s*token/i.test(s) ||
        /response_type=token/i.test(s);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the Spotify authorization URL uses response_type: code', () => {
    expect(OAUTH).toMatch(/response_type:\s*'code'/);
  });

  it('token exchange uses grant_type: authorization_code, never implicit', () => {
    expect(OAUTH).toContain("grant_type: 'authorization_code'");
  });
});

// ============================================================
// 2 — The PKCE replacement remains intact
// ============================================================
describe('Deprecation Lock #10 — PKCE replacement remains intact', () => {
  it.each([
    'generateCodeVerifier',
    'generateCodeChallenge',
    'code_challenge',
    'code_challenge_method',
    'S256',
    'code_verifier',
  ])('spotify-oauth.ts retains PKCE marker: %s', (marker) => {
    expect(OAUTH).toContain(marker);
  });
});

// ============================================================
// 3 — No client_secret (PKCE replaces it)
// ============================================================
describe('Deprecation Lock #10 — no client_secret in source', () => {
  it('no source file uses a client_secret parameter or env var', () => {
    // The only sanctioned reference is the doc comment in spotify-oauth.ts
    // explaining that no client_secret is needed. Comment lines are
    // allowlisted; any real usage anywhere fails the build.
    const offenders: string[] = [];
    for (const f of ALL_SRC) {
      read(f).split('\n').forEach((line, i) => {
        if (!/client_secret|CLIENT_SECRET/i.test(line)) return;
        const t = line.trim();
        const isComment = t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
        if (!isComment) offenders.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// ============================================================
// 4 — Google Apps Script runtime is forbidden (#10 canonical lock)
// ============================================================
describe('Deprecation Lock #10 — Google Apps Script runtime is forbidden', () => {
  it.each([
    'script.google.com',
    'SpreadsheetApp',
    'ContentService',
    'PropertiesService',
    'ScriptApp',
    'UrlFetchApp',
    'google.script.run',
  ])('no source file references GAS pattern: %s', (pattern) => {
    const offenders = ALL_SRC.filter((f) => read(f).includes(pattern)).map(rel);
    expect(offenders).toEqual([]);
  });
});

// ============================================================
// 5 — The invariant is actually wired into CI (anti-theater lock)
// ============================================================
describe('Deprecation Lock #10 — invariant is wired into CI', () => {
  it('CI runs the security suite that contains this invariant', () => {
    const ci = read(path.join(ROOT, '.github/workflows/ci.yml'));
    expect(ci).toContain('npm run test:security');
  });

  it('vitest is configured to execute *.invariant.spec.ts files', () => {
    const cfg = read(path.join(ROOT, 'vitest.config.ts'));
    expect(cfg).toMatch(/invariant\.spec\.ts/);
  });
});
