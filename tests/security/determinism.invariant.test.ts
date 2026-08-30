/**
 * L0 STATIC — determinism gate over the real source tree.
 *
 * Product claim (src/templates/connect.html): "The human answer to AI
 * playlists. Real people. Real taste. No algorithm." This gate is what keeps
 * that claim true in code rather than true-for-now: identical stored data must
 * produce identical output, across the FE, the BE, and the database.
 *
 * PAIRED WITH tests/unit/determinism-scan.test.ts — that file automates the
 * FAILURE path (each scanner fed a broken fixture, must report). This file can
 * only ever show the scanners passing, because the tree is conformant. Neither
 * is sufficient alone; the pair is what "covered" means for this property.
 *
 * Scope note: `crypto.randomUUID()` / `getRandomValues()` are permitted and
 * widespread here — session tokens, PKCE verifiers, CSP nonces, new row ids.
 * That randomness mints identifiers and never reaches a query result or a
 * rendered list, so it is not a determinism violation. See the rule comments
 * in tests/support/determinism-scan.ts.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  scanOrderByDeterminism,
  scanForbiddenRandomness,
  scanInferenceImports,
} from '../support/determinism-scan';

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

/** Render violations as `file:line — detail` so a CI failure is actionable. */
function report(files: string[], scan: (s: string) => { detail: string; line?: number }[]): string[] {
  return files.flatMap((f) => scan(read(f)).map((v) => `${f}:${v.line ?? '?'} — ${v.detail}`));
}

describe('determinism | database — every ORDER BY resolves ties', () => {
  it('no query in src/ sorts on a non-unique final term', () => {
    expect(report(SRC, scanOrderByDeterminism)).toEqual([]);
  });

  it('no migration seeds a nondeterministic ordering', () => {
    expect(report(MIGRATIONS, scanOrderByDeterminism)).toEqual([]);
  });

  it('the gate actually inspected the handlers (guards against a silent empty scan)', () => {
    // A scan over zero files trivially passes. Anchor it: the handlers that
    // carry the top-N leaderboards must be in scope.
    expect(SRC).toContain('src/handlers/dj.ts');
    expect(SRC).toContain('src/handlers/catalog.ts');
    expect(SRC.length).toBeGreaterThan(30);
  });
});

describe('determinism | backend — no randomness outside identifier minting', () => {
  it('no Math.random() or ORDER BY RANDOM() in src/', () => {
    expect(report(SRC, scanForbiddenRandomness)).toEqual([]);
  });
});

describe('determinism | no inference in the request path', () => {
  it('no model or embedding call in the Worker', () => {
    expect(report(SRC, scanInferenceImports)).toEqual([]);
  });

  it('no model call in the served templates', () => {
    expect(report(TEMPLATES, scanInferenceImports)).toEqual([]);
  });

  it('no AI binding is declared in wrangler.toml', () => {
    const wrangler = read('wrangler.toml');
    expect(wrangler).not.toMatch(/^\s*\[ai\]/m);
    expect(wrangler).not.toMatch(/binding\s*=\s*"AI"/);
  });

  it('no inference SDK is a runtime dependency', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const d of deps) {
      expect(d).not.toMatch(/openai|anthropic|langchain|@cf\/|replicate|huggingface/i);
    }
  });

  it('templates load no external scripts — nothing can pull a model client at runtime', () => {
    for (const t of TEMPLATES) {
      expect(read(t), `${t} must not load an external script`).not.toMatch(/<script[^>]+src=/i);
    }
  });
});
