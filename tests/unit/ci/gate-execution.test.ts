/**
 * Gate integrity for ci.yml: the `All Checks Passed` aggregator
 * (scripts/ci/require-all-success.mjs), the gate-execution reconciler
 * (scripts/ci/assert-gate-execution.mjs), the pipeline board
 * (scripts/ci/render-pipeline-board.mjs), the Bruno zero-case guard
 * (scripts/ci/junit-case-count.mjs) and the workflow wiring that makes them bite.
 *
 * Born red: each check is fed the fault it exists to catch (a skipped job, a
 * cancelled job, an empty needs list, a skip excused by an unrelated failure, a
 * JUnit report with no cases, an aggregator without `if: always()`, a job-level
 * `if:` on a gate job, a branch push trigger, a test step that bypasses its
 * zero-test guard, a job missing from the reconciler's graph) next to the case it
 * must pass. Both halves run on every pull request.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { notSuccessful, resultsFromNeeds } from '../../../scripts/ci/require-all-success.mjs';
import {
  GATES,
  SELF_TEST_CASES,
  expectedGates,
  findViolations,
  upstreamOf,
} from '../../../scripts/ci/assert-gate-execution.mjs';
import { STAGES, renderBoard } from '../../../scripts/ci/render-pipeline-board.mjs';
import { countTestcases, junitProblem } from '../../../scripts/ci/junit-case-count.mjs';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

type Step = { name?: string; run?: string; uses?: string; if?: string; env?: Record<string, string> } & Record<
  string,
  unknown
>;
type Job = { needs?: string | string[]; if?: string; steps?: Step[] } & Record<string, unknown>;
type Workflow = { on?: unknown; concurrency?: Record<string, unknown>; jobs: Record<string, Job> } & Record<
  string,
  unknown
>;

const ciDoc = () => yaml.load(read('.github/workflows/ci.yml')) as Workflow;
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

const PR = { eventName: 'pull_request', ref: 'refs/pull/7/merge' };
const MAIN = { eventName: 'push', ref: 'refs/heads/main' };
const ALL_RAN: Record<string, string> = Object.fromEntries(Object.keys(GATES).map((g) => [g, 'success']));
const PR_RAN = { ...ALL_RAN, 'deploy-staging': 'skipped', 'deploy-production': 'skipped' };

// ─────────────────────────────────────────────────────────────────────────────
describe('All Checks Passed: every needed job must be success', () => {
  it('passes when every job succeeded', () => {
    expect(notSuccessful({ a: 'success', b: 'success' })).toEqual([]);
  });
  it('BORN RED: a failed job fails it', () => {
    expect(notSuccessful({ a: 'success', b: 'failure' })).toEqual(['b=failure']);
  });
  it('BORN RED: a SKIPPED job fails it (the hole: GitHub counts a skipped required check as passing)', () => {
    expect(notSuccessful({ a: 'skipped', b: 'success' })).toEqual(['a=skipped']);
  });
  it('BORN RED: a cancelled job and a job with no result fail it', () => {
    expect(notSuccessful({ a: 'cancelled', b: undefined })).toEqual(['a=cancelled', 'b=absent']);
  });
  it('BORN RED: an empty needs list fails it (nothing aggregated proves nothing)', () => {
    expect(notSuccessful({})).toHaveLength(1);
    expect(notSuccessful(undefined)).toHaveLength(1);
  });
  it('reads the shape of toJSON(needs)', () => {
    expect(resultsFromNeeds({ a: { result: 'success', outputs: {} }, b: { result: 'skipped' } })).toEqual({
      a: 'success',
      b: 'skipped',
    });
  });
  it('the CLI exits 0 on all-success and 1 on a skip', () => {
    const script = path.join(ROOT, 'scripts/ci/require-all-success.mjs');
    const run = (needs: unknown) =>
      execFileSync(process.execPath, [script], {
        env: { ...process.env, GITHUB_STEP_SUMMARY: '', RESULTS_JSON: JSON.stringify(needs) },
        stdio: 'pipe',
      });
    expect(() => run({ a: { result: 'success' } })).not.toThrow();
    expect(() => run({ a: { result: 'success' }, b: { result: 'skipped' } })).toThrow();
    expect(() => run({})).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('gate-execution reconciler: expected set per trigger', () => {
  it('a pull request expects every gate job and the aggregator, no deploy', () => {
    const e = expectedGates(PR);
    expect([...e].sort()).toEqual([...GATES['all-checks'], 'all-checks'].sort());
    expect(e.has('deploy-staging')).toBe(false);
  });
  it('a push to main also expects deploy-staging', () => {
    expect(expectedGates(MAIN).has('deploy-staging')).toBe(true);
  });
  it('production is never expected (manual dispatch only)', () => {
    expect(expectedGates(MAIN).has('deploy-production')).toBe(false);
    expect(expectedGates({ eventName: 'workflow_dispatch', ref: 'refs/heads/main' }).has('deploy-production')).toBe(
      false,
    );
  });
  it('a push to another branch does not expect a deploy', () => {
    expect(expectedGates({ eventName: 'push', ref: 'refs/heads/feature' }).has('deploy-staging')).toBe(false);
  });
  it('upstreamOf follows needs transitively', () => {
    expect([...upstreamOf('performance-tests')].sort()).toEqual(
      ['integration-tests', 'lint-and-typecheck', 'security', 'unit-tests'].sort(),
    );
    expect(upstreamOf('security').size).toBe(0);
  });
});

describe('gate-execution reconciler: the legit-skip rule (self-test cases)', () => {
  for (const [name, ctx, results, expectViolation] of SELF_TEST_CASES) {
    it(`${expectViolation ? 'BORN RED: ' : ''}${name}`, () => {
      expect(findViolations(expectedGates(ctx), results).violation).toBe(expectViolation);
    });
  }

  it('the self-test covers both verdicts and both triggers', () => {
    expect(SELF_TEST_CASES.filter((c) => c[3]).length).toBeGreaterThanOrEqual(5);
    expect(SELF_TEST_CASES.filter((c) => !c[3]).length).toBeGreaterThanOrEqual(5);
    expect(new Set(SELF_TEST_CASES.map((c) => c[1].eventName))).toEqual(
      new Set(['pull_request', 'push', 'workflow_dispatch']),
    );
  });

  it('names the hole and the cascade separately', () => {
    const r = findViolations(expectedGates(PR), {
      ...PR_RAN,
      'unit-tests': 'failure',
      'performance-tests': 'skipped',
      'fuzz-tests': 'skipped',
      'all-checks': 'failure',
    });
    expect(r.unexplained).toEqual([{ job: 'fuzz-tests', result: 'skipped' }]);
    expect(r.cascaded).toEqual([
      { job: 'performance-tests', result: 'skipped', cause: 'unit-tests', causeResult: 'failure' },
    ]);
  });

  it('the CLI self-test passes, and the CLI fails on a silent skip', () => {
    const script = path.join(ROOT, 'scripts/ci/assert-gate-execution.mjs');
    expect(() => execFileSync(process.execPath, [script, '--self-test'], { stdio: 'pipe' })).not.toThrow();
    const needs = (r: Record<string, string>) =>
      JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { result: v }])));
    const run = (r: Record<string, string>) =>
      execFileSync(process.execPath, [script], {
        env: { ...process.env, EVENT_NAME: 'pull_request', REF: 'refs/pull/7/merge', RESULTS_JSON: needs(r) },
        stdio: 'pipe',
      });
    expect(() => run(PR_RAN)).not.toThrow();
    expect(() => run({ ...PR_RAN, 'fuzz-tests': 'skipped', 'all-checks': 'failure' })).toThrow();
  });
});

describe('pipeline board', () => {
  it('a clean PR run: every expected job passed, deploys not part of the trigger', () => {
    const md = renderBoard(PR, PR_RAN);
    expect(md).toContain('✅ Every job expected for this trigger ran.');
    expect(md).toContain('| 13 | Deploy Staging | ⏭️ not part of this trigger |');
    expect(md).toContain('| 14 | Deploy Production | ⏭️ manual dispatch only |');
  });
  it('BORN RED: a silent skip is flagged; a cascade is explained', () => {
    const md = renderBoard(PR, {
      ...PR_RAN,
      'unit-tests': 'failure',
      'performance-tests': 'skipped',
      'fuzz-tests': 'skipped',
      'all-checks': 'failure',
    });
    expect(md).toContain('⚠️ 1 job(s) that should have run did not:** fuzz-tests');
    expect(md).toContain('| Fuzz / Property Tests | ⚠️ DID NOT RUN (skipped), nothing upstream failed |');
    expect(md).toContain('| Performance Tests | ⏭️ not run: unit-tests failure upstream |');
  });
  it('has one row per ci.yml job, in the graph', () => {
    expect(STAGES.map(([k]) => k).sort()).toEqual(Object.keys(GATES).sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Bruno zero-case guard', () => {
  const junit = (cases: number) =>
    `<?xml version="1.0"?>\n<testsuites><testsuite name="x" tests="${cases}">` +
    Array.from({ length: cases }, (_, i) => `<testcase name="c${i}" classname="x"/>`).join('') +
    '</testsuite></testsuites>';

  it('counts test cases', () => {
    expect(countTestcases(junit(3))).toBe(3);
    expect(countTestcases('<testsuite><testcase name="a"></testcase></testsuite>')).toBe(1);
  });
  it('BORN RED: a report with zero cases counts 0', () => {
    expect(countTestcases(junit(0))).toBe(0);
  });
  it('BORN RED: a case inside a comment does not count', () => {
    expect(countTestcases('<testsuites><!-- <testcase name="x"/> --></testsuites>')).toBe(0);
    expect(countTestcases('<testsuites><!-- a --><testcase/><!-- <testcase/> --></testsuites>')).toBe(1);
  });
  it('BORN RED: an unterminated comment hides everything after it', () => {
    expect(countTestcases('<testsuites><!-- <testcase name="x"/></testsuites>')).toBe(0);
  });
  it('BORN RED: text that is not JUnit is unknown (-1), never a count', () => {
    expect(countTestcases('')).toBe(-1);
    expect(countTestcases('<html><testcase/></html>')).toBe(-1);
    expect(countTestcases('<testcases/>')).toBe(-1);
  });
  it('the file verdict: missing, empty and non-JUnit fail; one case passes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'junit-guard-'));
    const f = (name: string, body: string) => {
      const p = path.join(dir, name);
      writeFileSync(p, body);
      return p;
    };
    expect(junitProblem(path.join(dir, 'missing.xml'))).toMatch(/no JUnit report/);
    expect(junitProblem(f('zero.xml', junit(0)))).toMatch(/0 test cases/);
    expect(junitProblem(f('html.xml', '<html/>'))).toMatch(/not a JUnit report/);
    expect(junitProblem(f('one.xml', junit(1)))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ci.yml wiring: the checks above only bite if the workflow calls them this way.

const needsOf = (job: Job | undefined): string[] =>
  job?.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
const runs = (job: Job | undefined): string[] => (job?.steps ?? []).map((s) => s.run ?? '');
const RECONCILER = 'gate-execution';

/** Every reason ci.yml does not wire the gates as these checks assume. */
export function ciWiringProblems(doc: Workflow, scripts: Record<string, string>): string[] {
  const p: string[] = [];
  const jobs = doc.jobs ?? {};
  const ids = Object.keys(jobs);

  // The reconciler's graph is ci.yml's graph.
  for (const id of ids) {
    if (id === RECONCILER) continue;
    if (!(id in GATES)) p.push(`job ${id} is not in GATES (scripts/ci/assert-gate-execution.mjs)`);
    else if ([...needsOf(jobs[id])].sort().join() !== [...GATES[id]].sort().join()) {
      p.push(`job ${id}: needs [${needsOf(jobs[id])}] but GATES says [${GATES[id]}]`);
    }
  }
  for (const id of Object.keys(GATES)) if (!(id in jobs)) p.push(`GATES names ${id}, which ci.yml does not have`);

  // The aggregator: always runs, needs every gate job, decides with the script.
  const gateJobs = ids.filter((id) => !['all-checks', 'deploy-staging', 'deploy-production', RECONCILER].includes(id));
  const agg = jobs['all-checks'];
  if (!agg) p.push('no all-checks job');
  else {
    if (!/\balways\(\)/.test(agg.if ?? '')) p.push('all-checks has no `if: always()`: a failed job makes it skipped');
    for (const g of gateJobs) if (!needsOf(agg).includes(g)) p.push(`all-checks does not need ${g}`);
    const step = (agg.steps ?? []).find((s) => (s.run ?? '').includes('scripts/ci/require-all-success.mjs'));
    if (!step) p.push('all-checks does not run scripts/ci/require-all-success.mjs');
    else if (!/toJSON\(needs\)/.test(step.env?.RESULTS_JSON ?? '')) p.push('all-checks does not pass toJSON(needs)');
  }
  for (const d of ['deploy-staging', 'deploy-production']) {
    if (jobs[d] && !needsOf(jobs[d]).includes('all-checks')) p.push(`${d} does not need all-checks`);
  }

  // The reconciler: always runs, sees every other job.
  const rec = jobs[RECONCILER];
  if (!rec) p.push(`no ${RECONCILER} job`);
  else {
    if (!/\balways\(\)/.test(rec.if ?? '')) p.push(`${RECONCILER} has no \`if: always()\``);
    for (const id of ids) if (id !== RECONCILER && !needsOf(rec).includes(id)) p.push(`${RECONCILER} does not need ${id}`);
    if (!runs(rec).some((r) => /^node scripts\/ci\/assert-gate-execution\.mjs$/.test(r.trim()))) {
      p.push(`${RECONCILER} does not run the reconciler`);
    }
  }

  // A gate job cannot skip itself or swallow a failure.
  for (const g of gateJobs) {
    if (jobs[g].if !== undefined) p.push(`gate job ${g} has a job-level if: (a false if is a silent skip)`);
    if (jobs[g]['continue-on-error'] !== undefined) p.push(`gate job ${g} has continue-on-error`);
    for (const s of jobs[g].steps ?? []) {
      if (s['continue-on-error'] !== undefined) p.push(`gate job ${g}: step "${s.name ?? s.run}" has continue-on-error`);
    }
  }

  // Triggers: no branch-push duplicate of the PR run; concurrency keyed by event, cancel on PRs only.
  const on = (doc.on ?? (doc as Record<string, unknown>)['true']) as Record<string, { branches?: string[] }>;
  if (JSON.stringify(on?.push?.branches) !== JSON.stringify(['main'])) {
    p.push(`push trigger branches are ${JSON.stringify(on?.push?.branches)}, not ["main"]`);
  }
  const group = String(doc.concurrency?.group ?? '');
  if (!group.includes('github.event_name')) p.push('concurrency group is not keyed by github.event_name');
  if (String(doc.concurrency?.['cancel-in-progress']).replace(/\s/g, '') !== "${{github.event_name=='pull_request'}}") {
    p.push('cancel-in-progress is not limited to pull_request');
  }

  // Zero-test guards.
  const e2e = runs(jobs['e2e-tests']);
  if (e2e.some((r) => /npm run test:e2e|npx playwright test/.test(r))) p.push('e2e-tests runs Playwright unguarded');
  if (!e2e.some((r) => /^bash scripts\/pw-guarded\.sh tests\/e2e(\s|$)/.test(r.trim()))) {
    p.push('e2e-tests does not run tests/e2e through scripts/pw-guarded.sh');
  }
  if (!/playwright test tests\/e2e$/.test(scripts['test:e2e'] ?? '')) {
    p.push('package.json test:e2e no longer runs `playwright test tests/e2e`; the CI step must match it');
  }
  const bru = runs(jobs['bruno-tests']);
  const bruRun = bru.findIndex((r) => r.trim() === 'npm run test:bruno');
  const bruGuard = bru.findIndex((r) =>
    /^node scripts\/ci\/junit-case-count\.mjs \.test-results\/bru-api-junit\.xml/.test(r.trim()),
  );
  if (bruRun === -1) p.push('bruno-tests does not run npm run test:bruno');
  if (bruGuard === -1) p.push('bruno-tests has no zero-case guard on .test-results/bru-api-junit.xml');
  else if (bruGuard < bruRun) p.push('the Bruno zero-case guard runs before the Bruno run');
  if (!(scripts['test:bruno'] ?? '').includes('--reporter-junit ../../.test-results/bru-api-junit.xml')) {
    p.push('package.json test:bruno no longer writes .test-results/bru-api-junit.xml');
  }
  return p;
}

describe('ci.yml wiring', () => {
  it('the real ci.yml is wired as the gates assume', () => {
    expect(ciWiringProblems(ciDoc(), pkg.scripts)).toEqual([]);
  });

  it('anti-vacuity: the graph has the whole pyramid', () => {
    expect(Object.keys(ciDoc().jobs).length).toBeGreaterThanOrEqual(15);
    expect(GATES['all-checks'].length).toBeGreaterThanOrEqual(11);
  });

  const faults: Array<[string, (d: Workflow, s: Record<string, string>) => void, RegExp]> = [
    ['the aggregator loses if: always()', (d) => delete d.jobs['all-checks'].if, /all-checks has no `if: always\(\)`/],
    ['the aggregator stops needing a test job', (d) => {
      d.jobs['all-checks'].needs = needsOf(d.jobs['all-checks']).filter((n) => n !== 'fuzz-tests');
    }, /all-checks does not need fuzz-tests/],
    ['the aggregator goes back to echoing', (d) => {
      d.jobs['all-checks'].steps = [{ run: 'echo "All CI checks passed"' }];
    }, /does not run scripts\/ci\/require-all-success\.mjs/],
    ['a gate job is forced to skip', (d) => {
      d.jobs['fuzz-tests'].if = 'false';
    }, /gate job fuzz-tests has a job-level if/],
    ['a step swallows failure', (d) => {
      d.jobs['unit-tests'].steps!.push({ run: 'npm run x', 'continue-on-error': true });
    }, /continue-on-error/],
    ['a new job is added without the reconciler knowing', (d) => {
      d.jobs['a11y-tests'] = { needs: ['security'], steps: [] };
    }, /job a11y-tests is not in GATES/],
    ['a job is rewired', (d) => {
      d.jobs['performance-tests'].needs = ['security'];
    }, /job performance-tests: needs/],
    ['the reconciler stops seeing a job', (d) => {
      d.jobs[RECONCILER].needs = needsOf(d.jobs[RECONCILER]).filter((n) => n !== 'deploy-staging');
    }, /gate-execution does not need deploy-staging/],
    ['the claude/** push trigger comes back', (d) => {
      (d.on as { push: { branches: string[] } }).push.branches.push('claude/**');
    }, /push trigger branches/],
    ['every run cancels in progress', (d) => {
      d.concurrency!['cancel-in-progress'] = true;
    }, /cancel-in-progress is not limited/],
    ['E2E goes back to the unguarded npm script', (d) => {
      const s = d.jobs['e2e-tests'].steps!.find((x) => (x.run ?? '').includes('pw-guarded.sh tests/e2e'))!;
      s.run = 'npm run test:e2e';
    }, /e2e-tests runs Playwright unguarded/],
    ['the Bruno guard is removed', (d) => {
      d.jobs['bruno-tests'].steps = d.jobs['bruno-tests'].steps!.filter((x) => !(x.run ?? '').includes('junit-case-count'));
    }, /no zero-case guard/],
    ['test:bruno stops writing the report the guard reads', (_d, s) => {
      s['test:bruno'] = s['test:bruno'].replace('--reporter-junit ../../.test-results/bru-api-junit.xml', '');
    }, /no longer writes/],
  ];
  for (const [name, plant, expected] of faults) {
    it(`BORN RED: ${name}`, () => {
      const d = ciDoc();
      const s = { ...pkg.scripts };
      plant(d, s);
      expect(ciWiringProblems(d, s).join('\n')).toMatch(expected);
    });
  }
});
