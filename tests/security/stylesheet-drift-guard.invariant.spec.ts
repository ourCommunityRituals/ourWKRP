/**
 * Invariant #13 — WKRP templates must use the shared @ocr/ui stylesheet
 *
 * OSE-446 AC: templates link /ui.css, no local :root token block, ≤400 chars
 * of inline CSS. Violations indicate a developer re-inlined the design tokens
 * instead of letting the shared stylesheet serve them — killing the single
 * source of truth and creating palette drift.
 *
 * This test is the in-process twin of scripts/check-templates.ts (CI lint step).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { checkAll, type DriftFinding } from '@ocr/ui';

const TEMPLATE_DIR = join(__dirname, '../../src/templates');

function loadTemplates(): { file: string; html: string }[] {
  return readdirSync(TEMPLATE_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((f) => ({ file: f, html: readFileSync(join(TEMPLATE_DIR, f), 'utf8') }));
}

describe('Invariant #13 — stylesheet drift guard', () => {
  const templates = loadTemplates();

  it('finds exactly 9 template files', () => {
    expect(templates).toHaveLength(9);
  });

  it('no template declares its own :root tokens', () => {
    const violations = templates.filter((t) => /:root\s*\{/.test(t.html));
    expect(
      violations.map((v) => v.file),
      'Templates with local :root tokens',
    ).toHaveLength(0);
  });

  it('every template links /ui.css or has no inline style at all', () => {
    const noLink = templates.filter(
      (t) => !/rel=["']stylesheet["']/i.test(t.html) && /<style[^>]*>/i.test(t.html),
    );
    expect(
      noLink.map((v) => v.file),
      'Templates with inline style but no /ui.css link',
    ).toHaveLength(0);
  });

  it('all template inline CSS is ≤400 chars', () => {
    const overBudget = templates.filter((t) => {
      const blocks = [...t.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
      const total = blocks.map((m) => m[1]).join('').length;
      return total > 400;
    });
    expect(
      overBudget.map((v) => v.file),
      'Templates exceeding 400-char inline CSS budget',
    ).toHaveLength(0);
  });

  it('checkAll reports 0 findings across all 9 templates', () => {
    const findings: DriftFinding[] = checkAll(templates);
    const report = findings.map((f) => `${f.file}: ${f.issue} — ${f.detail}`).join('\n');
    expect(findings, `Drift findings:\n${report}`).toHaveLength(0);
  });
});
