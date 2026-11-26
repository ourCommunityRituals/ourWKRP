/**
 * The OCR-docs brain is read at a pinned commit (CCR F3; owner decision
 * 2026-11-26, pilot in ourWKRP).
 *
 * brain-contract-check.yml used to read the brain at OCR-docs main, so a change
 * merged there ran in WKRP's CI on the next PR without a review here. Now:
 *   1. .ocr-brain-ref holds one full commit id;
 *   2. the workflow checks out OCR-docs main with full history, then runs
 *      scripts/ci/brain-pin.sh before any step reads ocr-docs-brain/;
 *   3. brain-pin.sh refuses a malformed pin, a pin that is not on OCR-docs main,
 *      and a pin older than the base branch's (no roll-back by PR), and moves the
 *      checkout to the pin.
 *
 * Born red: rule 3 runs the real script against a throwaway OCR-docs history.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/ci/brain-pin.sh');
const WF = path.join(ROOT, '.github/workflows/brain-contract-check.yml');

type Step = { name?: string; id?: string; uses?: string; run?: string; with?: Record<string, unknown> };

describe('the pin file and the workflow wiring', () => {
  it('.ocr-brain-ref is one full commit id', () => {
    expect(readFileSync(path.join(ROOT, '.ocr-brain-ref'), 'utf8').trim()).toMatch(/^[0-9a-f]{40}$/);
  });

  const steps = (Object.values((yaml.load(readFileSync(WF, 'utf8')) as { jobs: Record<string, { steps: Step[] }> }).jobs)[0]
    .steps);
  const brainCheckout = steps.findIndex((s) => s.with?.repository === 'ourCommunityRituals/OCR-docs');
  const pinStep = steps.findIndex((s) => (s.run ?? '').includes('scripts/ci/brain-pin.sh'));
  const firstRead = steps.findIndex((s) => /ocr-docs-brain/.test(`${s.run ?? ''} ${s['working-directory' as keyof Step] ?? ''}`));

  it('checks out OCR-docs main with full history, so the pin can be proved to be on main', () => {
    expect(brainCheckout).toBeGreaterThanOrEqual(0);
    expect(steps[brainCheckout].with?.ref).toBe('main');
    expect(steps[brainCheckout].with?.['fetch-depth']).toBe(0);
  });

  it('runs brain-pin.sh after that checkout and before any step reads the brain', () => {
    expect(pinStep).toBeGreaterThan(brainCheckout);
    expect(firstRead).toBeGreaterThan(pinStep);
  });

  it('passes the base branch pin, so a PR cannot roll the brain back', () => {
    expect(steps[pinStep].run).toMatch(/show FETCH_HEAD:\.ocr-brain-ref/);
    expect(steps[pinStep].run).toMatch(/brain-pin\.sh ocr-docs wkrp\/\.ocr-brain-ref "\$base_pin"/);
  });
});

describe('brain-pin.sh, run for real', () => {
  let dir = '';
  let brain = '';
  const sha: Record<string, string> = {};
  const git = (...a: string[]) => spawnSync('git', ['-C', brain, ...a], { encoding: 'utf8' }).stdout.trim();
  const commit = (label: string) => {
    writeFileSync(path.join(brain, 'f.txt'), label);
    git('add', 'f.txt');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', label);
    sha[label] = git('rev-parse', 'HEAD');
  };
  const run = (pin: string | null, base = '') => {
    const pinFile = path.join(dir, 'pin');
    if (pin === null) rmSync(pinFile, { force: true });
    else writeFileSync(pinFile, `${pin}\n`);
    git('checkout', '-q', 'main');
    return spawnSync('bash', [SCRIPT, brain, pinFile, base], { encoding: 'utf8' });
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'brain-pin-'));
    brain = path.join(dir, 'ocr-docs');
    spawnSync('git', ['init', '-q', '-b', 'main', brain]);
    commit('A');
    commit('B');
    git('checkout', '-q', '-b', 'side');
    commit('D'); // on a branch, never merged
    git('checkout', '-q', 'main');
    commit('C');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('a pin on main moves the checkout there and warns how far behind it is', () => {
    const r = run(sha.B);
    expect(r.status).toBe(0);
    expect(git('rev-parse', 'HEAD')).toBe(sha.B);
    expect(r.stdout).toContain('::warning');
    expect(r.stdout).toContain('1 commit(s) behind');
  });

  it('a pin at main passes without a warning', () => {
    const r = run(sha.C, sha.B);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('::warning');
  });

  it.each([
    ['a missing pin file', () => run(null), 'is missing'],
    ['a short commit id', () => run(sha.B.slice(0, 7)), 'full 40-character'],
    ['a branch name', () => run('main'), 'full 40-character'],
    ['a commit that is not on main', () => run(sha.D), 'not on OCR-docs main'],
    ['a commit OCR-docs does not have', () => run('f'.repeat(40)), 'not in OCR-docs'],
    ['a pin older than the base branch pin', () => run(sha.B, sha.C), 'moves the brain back'],
  ])('refuses %s', (_label, go, message) => {
    const r = go();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('::error');
    expect(r.stdout).toContain(message);
  });
});
