/**
 * The invariant specs actually run (CI parity plan, gap row 12).
 *
 * OW's architectural invariants live in `tests/security/*.invariant.spec.ts`. They
 * bind only while three links hold: vitest's `include` picks up the
 * `.invariant.spec.ts` suffix (the default suite is `*.test.ts` only), the
 * `test:security` script runs `tests/security`, and ci.yml's `Security Tests` job
 * runs that script with nothing able to skip or swallow it. Break any link and
 * every invariant spec turns into an inert file that still satisfies the brain's
 * file-presence glob. A spec placed outside `tests/security` is the quieter form
 * of the same break: `test:security` never sees it.
 *
 * OSE locks the same thing for its `0-architecture` specs
 * (tests/integration/infra-consistency.test.js). OW runs them by glob, so the lock
 * is on the glob and the job, not on a list of names.
 *
 * Born red: each link is broken on purpose below, next to the real repo passing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import vitestConfig from '../../vitest.config';

const ROOT = path.resolve(__dirname, '../..');
const SUFFIX = '.invariant.spec.ts';
const INCLUDE_GLOB = 'tests/**/*.invariant.spec.ts';

type Step = { run?: string } & Record<string, unknown>;
type Job = { if?: string; steps?: Step[] } & Record<string, unknown>;
type Wiring = {
  include: string[];
  exclude: string[];
  testSecurityScript: string;
  ciJobs: Record<string, Job>;
  specFiles: string[];
};

/** Every `*.invariant.spec.ts` in the repository, relative, with forward slashes. */
function findSpecs(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    // Skip dependencies and dot-directories (.git, .claude worktrees, .wrangler).
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...findSpecs(path.join(dir, e.name), r));
    else if (e.name.endsWith(SUFFIX)) out.push(r);
  }
  return out;
}

export function invariantWiringProblems(w: Wiring): string[] {
  const p: string[] = [];
  if (!w.include.includes(INCLUDE_GLOB)) p.push(`vitest include does not have ${INCLUDE_GLOB}`);
  for (const ex of w.exclude) {
    if (/^tests\/(security|\*\*)/.test(ex)) p.push(`vitest exclude ${ex} drops tests/security`);
  }
  if (!/^vitest run tests\/security$/.test(w.testSecurityScript.trim())) {
    p.push(`test:security is "${w.testSecurityScript}", not "vitest run tests/security"`);
  }
  const job = w.ciJobs['security-tests'];
  if (!job) p.push('ci.yml has no security-tests job');
  else {
    if (!(job.steps ?? []).some((s) => (s.run ?? '').trim() === 'npm run test:security')) {
      p.push('ci.yml security-tests does not run npm run test:security');
    }
    if (job.if !== undefined) p.push('ci.yml security-tests has a job-level if: (a false if skips every invariant)');
    if (job['continue-on-error'] !== undefined || (job.steps ?? []).some((s) => s['continue-on-error'] !== undefined)) {
      p.push('ci.yml security-tests can swallow a failure (continue-on-error)');
    }
  }
  for (const f of w.specFiles) {
    if (!f.startsWith('tests/security/')) p.push(`${f} is outside tests/security, so test:security never runs it`);
  }
  return p;
}

const real = (): Wiring => {
  const test = vitestConfig.test ?? {};
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const ci = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')) as { jobs: Record<string, Job> };
  return {
    include: [...(test.include ?? [])],
    exclude: [...(test.exclude ?? [])],
    testSecurityScript: pkg.scripts['test:security'] ?? '',
    ciJobs: ci.jobs,
    specFiles: findSpecs(ROOT),
  };
};

describe('invariant specs are collected and run in CI', () => {
  it('the real repository is wired', () => {
    expect(invariantWiringProblems(real())).toEqual([]);
  });

  it('anti-vacuity: the walk finds the invariant specs', () => {
    expect(real().specFiles.length).toBeGreaterThanOrEqual(5);
  });

  const faults: Array<[string, (w: Wiring) => void, RegExp]> = [
    ['vitest stops including the invariant suffix', (w) => {
      w.include = w.include.filter((g) => g !== INCLUDE_GLOB);
    }, /include does not have/],
    ['vitest excludes tests/security', (w) => {
      w.exclude.push('tests/security/**');
    }, /drops tests\/security/],
    ['test:security points elsewhere', (w) => {
      w.testSecurityScript = 'vitest run tests/unit';
    }, /test:security is/],
    ['the CI job stops running the script', (w) => {
      w.ciJobs = { ...w.ciJobs, 'security-tests': { ...w.ciJobs['security-tests'], steps: [{ run: 'npm ci' }] } };
    }, /does not run npm run test:security/],
    ['the CI job is made skippable', (w) => {
      w.ciJobs = { ...w.ciJobs, 'security-tests': { ...w.ciJobs['security-tests'], if: 'false' } };
    }, /job-level if/],
    ['the CI job swallows failure', (w) => {
      w.ciJobs = { ...w.ciJobs, 'security-tests': { ...w.ciJobs['security-tests'], 'continue-on-error': true } };
    }, /continue-on-error/],
    ['the CI job is removed', (w) => {
      const { 'security-tests': _gone, ...rest } = w.ciJobs;
      w.ciJobs = rest;
    }, /no security-tests job/],
    ['an invariant spec lands outside tests/security', (w) => {
      w.specFiles.push('tests/unit/new-rule.invariant.spec.ts');
    }, /outside tests\/security/],
  ];
  for (const [name, plant, expected] of faults) {
    it(`BORN RED: ${name}`, () => {
      const w = real();
      plant(w);
      expect(invariantWiringProblems(w).join('\n')).toMatch(expected);
    });
  }
});
