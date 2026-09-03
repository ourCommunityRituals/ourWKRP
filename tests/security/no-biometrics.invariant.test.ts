/**
 * L0 STATIC — invariant #27 no_biometric_identifiers, over the real tree.
 *
 * Brain:  OCR-docs → architectural-invariants.yaml #27 (privacy_identity,
 *         group_order 5, status partial, applies_to all six products)
 * Statute: 740 ILCS 14 (Illinois BIPA) — retina/iris scan, fingerprint,
 *         voiceprint, scan of hand or face geometry. Private right of action;
 *         $1,000 negligent / $5,000 intentional-reckless; no proof of harm.
 *
 * PAIRED WITH tests/unit/biometric-scan.test.ts, which automates the FAILURE
 * path. This file can only ever show the scanners passing, because the tree is
 * clean — and a passing absence gate is indistinguishable from a broken one.
 * Neither file is sufficient alone.
 *
 * NON-VACUITY IS THE WHOLE PROBLEM HERE. An absence assertion over zero files
 * passes trivially. Every scan below is therefore anchored: named files must be
 * in scope and the file count must be non-trivial, so a glob that silently
 * stops matching fails loudly instead of reporting clean.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  scanMediaCapture,
  scanBiometricVendors,
  scanBiometricFields,
} from '../support/biometric-scan';

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

function report(files: string[], scan: (s: string) => { detail: string; line?: number }[]): string[] {
  return files.flatMap((f) => scan(read(f)).map((v) => `${f}:${v.line ?? '?'} — ${v.detail}`));
}

describe('#27 — the gate actually scanned something', () => {
  it('anchors on real files, so an empty scan cannot pass vacuously', () => {
    expect(SRC).toContain('src/handlers/pages.ts');
    expect(SRC.length).toBeGreaterThan(30);
    expect(TEMPLATES.length).toBeGreaterThan(5);
    expect(MIGRATIONS.length).toBeGreaterThan(5);
  });
});

describe('#27 — no camera or microphone acquisition on any surface', () => {
  it('no media capture in the worker', () => {
    expect(report(SRC, scanMediaCapture)).toEqual([]);
  });

  it('no media capture in any served template', () => {
    // Includes the venue Display/TV surface, which is the one most likely to
    // attract a camera-based "audience measurement" proposal.
    expect(report(TEMPLATES, scanMediaCapture)).toEqual([]);
  });
});

describe('#27 — no biometric vendor SDK, service, or endpoint', () => {
  it('none referenced in the worker', () => {
    expect(report(SRC, scanBiometricVendors)).toEqual([]);
  });

  it('none referenced in any template', () => {
    expect(report(TEMPLATES, scanBiometricVendors)).toEqual([]);
  });

  it('no biometric package is a runtime dependency', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> };
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      expect(dep).not.toMatch(/face|vision|rekognition|biometric|speech|clarifai|mediapipe/i);
    }
  });
});

describe('#27 — no BIPA-enumerated identifier is stored', () => {
  it('no biometric field in the worker', () => {
    expect(report(SRC, scanBiometricFields)).toEqual([]);
  });

  it('no biometric column in any migration', () => {
    // The schema is the durable surface: a column outlives the handler that
    // wrote it, so the migration set is where this must never appear.
    expect(report(MIGRATIONS, scanBiometricFields)).toEqual([]);
  });
});

describe('#27 — no binding could reach an inference or media service', () => {
  it('wrangler.toml declares no AI binding', () => {
    const wrangler = read('wrangler.toml');
    expect(wrangler).not.toMatch(/^\s*\[ai\]/m);
    expect(wrangler).not.toMatch(/binding\s*=\s*"AI"/);
  });

  it('templates load no external scripts — nothing can pull a vision SDK at runtime', () => {
    for (const t of TEMPLATES) {
      expect(read(t), `${t} must not load an external script`).not.toMatch(/<script[^>]+src=/i);
    }
  });
});
