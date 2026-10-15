/**
 * ADR-008 Phase 0 wiring lock (OSE-1399 / CCR OSE-1393 D3; OW-150, OW-151).
 *
 * WKRP builds against @ocr/ui staged from the hub commit pinned in
 * .ocr-hub-ref. These controls are CI wiring, which can be deleted without any
 * other gate going red, so this spec locks them structurally:
 *
 *   1. Every workflow job that runs `npm ci` stages the pinned hub first
 *      (mobile-workability.yml once did not, OW-151).
 *   2. OCR_HUB_READ (a read-only token, still kept step-scoped) is never set at
 *      workflow or job level and never embedded in a clone URL; it appears
 *      only as step-scoped env on a staging step (OW-150).
 *   3. The blocking design check runs from the staged hub, not continue-on-error.
 *   4. .ocr-hub-ref is one 40-hex SHA, and the staging script refuses pins that
 *      are not on hub main (OSE-1394).
 *
 * Text-based (WKRP carries no YAML parser). The detectors are exercised on
 * synthetic workflows first so they cannot pass vacuously.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');
const STAGE = 'bash scripts/ci-stage-ocr-workspace.sh';

/** Split a workflow's `jobs:` block into { name: text }. */
function jobs(text: string): Record<string, string> {
  const start = text.search(/^jobs:\s*$/m);
  if (start === -1) return {};
  const body = text.slice(start);
  const out: Record<string, string> = {};
  const re = /^ {2}([\w-]+):\s*$/gm;
  const marks = [...body.matchAll(re)];
  marks.forEach((m, i) => {
    out[m[1]] = body.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : undefined);
  });
  return out;
}

/** Jobs that run `npm ci` without staging the pinned hub before it. */
function unstagedInstalls(text: string): string[] {
  const bad: string[] = [];
  for (const [name, job] of Object.entries(jobs(text))) {
    const install = job.search(/\bnpm ci\b/);
    if (install === -1) continue;
    const stage = job.indexOf(STAGE);
    if (stage === -1 || stage > install) bad.push(name);
  }
  return bad;
}

/** Token uses that are not step-scoped env directly on a staging step. */
function looseTokenUses(text: string): string[] {
  const lines = text.split('\n');
  const bad: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes('secrets.OCR_HUB_READ')) return;
    const scoped =
      /^\s{10,}OCR_HUB_READ: \$\{\{ secrets\.OCR_HUB_READ \}\}\s*$/.test(line) &&
      /^\s+env:\s*$/.test(lines[i - 1] ?? '') &&
      (lines[i - 2] ?? '').includes(`run: ${STAGE}`);
    if (!scoped) bad.push(`line ${i + 1}: ${line.trim()}`);
  });
  return bad;
}

const workflows = readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(WF_DIR, f), 'utf8') }));
const HUB_WORKFLOWS = ['ci.yml', 'mobile-workability.yml'];

describe('ADR-008 wiring lock', () => {
  describe('negative controls', () => {
    const job = (steps: string) => `jobs:\n  a:\n    steps:\n${steps}`;

    it('flags npm ci with no staging step, and staging after npm ci', () => {
      expect(unstagedInstalls(job('      - run: npm ci\n'))).toEqual(['a']);
      expect(unstagedInstalls(job(`      - run: npm ci\n      - run: ${STAGE}\n`))).toEqual(['a']);
      expect(unstagedInstalls(job(`      - run: ${STAGE}\n      - run: npm ci\n`))).toEqual([]);
    });

    it('flags a workflow-level or URL-embedded token, accepts step-scoped env', () => {
      expect(looseTokenUses('env:\n  OCR_HUB_READ: ${{ secrets.OCR_HUB_READ }}\n')).toHaveLength(1);
      expect(
        looseTokenUses('env:\n  R: https://x-access-token:${{ secrets.OCR_HUB_READ }}@github.com/x.git\n'),
      ).toHaveLength(1);
      const ok = `      - name: Stage\n        run: ${STAGE}\n        env:\n          OCR_HUB_READ: \${{ secrets.OCR_HUB_READ }}\n`;
      expect(looseTokenUses(ok)).toEqual([]);
    });
  });

  it('every job that runs npm ci stages the pinned hub first', () => {
    for (const f of HUB_WORKFLOWS) {
      const wf = workflows.find((w) => w.file === f);
      expect(wf, f).toBeDefined();
      expect(unstagedInstalls(wf!.text), f).toEqual([]);
    }
    // Anti-vacuity: ci.yml has many npm ci jobs; the splitter must see them.
    expect(Object.keys(jobs(workflows.find((w) => w.file === 'ci.yml')!.text)).length).toBeGreaterThanOrEqual(8);
  });

  it('OCR_HUB_READ hub access is only step-scoped on staging steps (OW-150)', () => {
    for (const f of HUB_WORKFLOWS) {
      const { text } = workflows.find((w) => w.file === f)!;
      expect(looseTokenUses(text), f).toEqual([]);
      expect(text, f).not.toMatch(/x-access-token:\$\{\{\s*secrets\.OCR_HUB_READ/);
    }
  });

  it('the blocking design check runs from the staged hub', () => {
    const { text } = workflows.find((w) => w.file === 'ci.yml')!;
    const job = Object.values(jobs(text)).find((j) => j.includes('check-spoke-styles.mjs'));
    expect(job).toBeDefined();
    expect(job!).toMatch(/node \.\.\/packages\/ui\/scripts\/check-spoke-styles\.mjs --root \./);
    expect(job!.indexOf(STAGE)).toBeGreaterThan(-1);
    expect(job!.indexOf(STAGE)).toBeLessThan(job!.indexOf('check-spoke-styles.mjs'));
    const step = job!.slice(job!.lastIndexOf('- name:', job!.indexOf('check-spoke-styles.mjs')));
    expect(step.split(/\n\s{6}- /)[0]).not.toMatch(/continue-on-error/);
  });

  it('.ocr-hub-ref is one 40-hex SHA and the stager refuses unmerged pins (OSE-1394)', () => {
    expect(readFileSync(join(ROOT, '.ocr-hub-ref'), 'utf8').trim()).toMatch(/^[0-9a-f]{40}$/);
    const script = readFileSync(join(ROOT, 'scripts', 'ci-stage-ocr-workspace.sh'), 'utf8');
    expect(script).toMatch(/merge-base --is-ancestor "\$REF"/);
    expect(script).not.toMatch(/remote (add|set-url) origin "https:\/\/x-access-token/);
  });
});
