/**
 * Nothing sensitive on a branch push (OSE-1695, ported from ourSharedEvents).
 *
 * On a `push`, GitHub runs the workflow file that is on the pushed branch, so anyone with write
 * access can push a branch with an edited workflow and read every repository secret that a job on
 * that trigger can see. A job that uses a credential must therefore not be triggered by a push to
 * any branch except main.
 *
 * `mobile-workability.yml` here runs on pushes to `claude/**` (`ci.yml` did too, until its pull
 * request runs were judged enough), so the rule matters in this repository. Safe by default: every secret is protected unless it is on the short
 * list below, so a new secret is covered the moment it appears.
 *
 * Two jobs are allowed to hold a secret on a workflow with a branch-push trigger, `deploy-staging`
 * and `deploy-production`. Each must declare an `environment:` AND an `if:` that pins it to main,
 * and the exempt list is asserted exactly, so a third job can never join it silently. The
 * environments themselves hold the Doppler tokens as environment secrets and deploy from main only
 * (deployment branch policy `main`, read through the GitHub API on 2026-10-26). A unit test cannot
 * see that setting, which is why the job must also say so itself.
 *
 * Since `ci.yml` dropped its `claude/**` push trigger, no job relies on the exemption, and the
 * exact list below is empty. It stays the rule for the two deploy jobs if a branch push returns,
 * but bringing one back now fails here first, on purpose.
 *
 * The same rule lives in ourSharedEvents as scripts/ci/branch-push-secret-exposure.mjs, mutation-
 * tested with StrykerJS. This is a copy, not a shared module: if the two diverge, that is a finding.
 *
 * Out of scope: pull_request exposure (the PR secret guard models that), tag pushes, and schedule
 * or manual runs.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

type Job = { environment?: string | { name?: string }; if?: string } & Record<string, unknown>;
type Workflow = { on?: unknown; jobs?: Record<string, Job> } & Record<string, unknown>;

/**
 * Secrets that may be used on a push to any branch.
 * GITHUB_TOKEN is minted per run and scoped by the workflow's permissions block.
 * OCR_HUB_READ is a fine-grained, read-only token for the hub repository.
 * This list must only ever shrink or stay the same; adding to it needs a reason in review.
 */
const SAFE_ON_ANY_BRANCH_PUSH = new Set(['GITHUB_TOKEN', 'OCR_HUB_READ']);

/** The branch patterns a push trigger accepts, or null if the workflow has no push trigger. */
function pushBranchPatterns(doc: Workflow): string[] | null {
  // YAML 1.1 parsers turn a bare `on:` key into the boolean true.
  const on = doc.on ?? (doc as Record<string, unknown>)['true'];
  if (on === undefined || on === null) return null;
  let push: Record<string, unknown> | null;
  if (typeof on === 'string') push = on === 'push' ? {} : null;
  else if (Array.isArray(on)) push = on.includes('push') ? {} : null;
  else {
    const map = on as Record<string, unknown>;
    push = 'push' in map ? ((map.push as Record<string, unknown> | null) ?? {}) : null;
  }
  if (push === null) return null;
  if (Array.isArray(push.branches)) return push.branches as string[];
  if (Array.isArray(push['branches-ignore'])) {
    return ['(every branch except ' + (push['branches-ignore'] as string[]).join(', ') + ')'];
  }
  // No `branches` key: a push to ANY branch still triggers, unless the trigger names only tags.
  if (Array.isArray(push.tags) && !push.paths && !push['paths-ignore']) return [];
  return ['(every branch)'];
}

/** The secrets a job references, by name. */
function secretsOfJob(job: Job): string[] {
  const text = JSON.stringify(job);
  return [...new Set([...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
}

/** True only for a job that names an environment AND is pinned to main by its own `if:`. */
function isMainBoundEnvironmentJob(job: Job): boolean {
  if (!job.environment) return false;
  const cond = typeof job.if === 'string' ? job.if : '';
  // A `||` could make the main test irrelevant, so any `||` fails closed.
  return /github\.ref\s*==\s*'refs\/heads\/main'/.test(cond) && !cond.includes('||');
}

function analyse(name: string, doc: Workflow): { violations: string[]; bound: string[] } {
  const violations: string[] = [];
  const bound: string[] = [];
  const branches = pushBranchPatterns(doc);
  if (!branches) return { violations, bound };
  const beyondMain = branches.filter((b) => b !== 'main');
  if (beyondMain.length === 0) return { violations, bound };
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    const protectedSecrets = secretsOfJob(job).filter((s) => !SAFE_ON_ANY_BRANCH_PUSH.has(s));
    if (protectedSecrets.length === 0) continue;
    if (isMainBoundEnvironmentJob(job)) {
      bound.push(`${name}:${jobName}`);
    } else {
      violations.push(
        `${name}: job "${jobName}" uses ${protectedSecrets.join(', ')} and a push to ${beyondMain.join(', ')} triggers it`,
      );
    }
  }
  return { violations, bound };
}

const wf = (on: unknown, jobs: Record<string, Job>): Workflow => ({ on, jobs });
const SECRET_JOB: Job = { steps: [{ run: 'echo ${{ secrets.DOPPLER_TOKEN_STG }}' }] };
const HUB_READ_JOB: Job = { steps: [{ env: { T: '${{ secrets.OCR_HUB_READ }}' } }] };
const BOUND_JOB: Job = {
  environment: 'staging',
  if: "github.ref == 'refs/heads/main' && github.event_name == 'push'",
  steps: [{ run: 'echo ${{ secrets.DOPPLER_TOKEN_STG }}' }],
};

describe('the rule: each fault turns it red, each safe shape stays green', () => {
  it('a secret job on a push to claude/** is flagged', () => {
    expect(analyse('x.yml', wf({ push: { branches: ['main', 'claude/**'] } }, { j: SECRET_JOB })).violations).toHaveLength(1);
  });
  it('a push with no branch filter means every branch, and is flagged', () => {
    expect(analyse('x.yml', wf({ push: {} }, { j: SECRET_JOB })).violations).toHaveLength(1);
    expect(analyse('x.yml', wf({ push: null }, { j: SECRET_JOB })).violations).toHaveLength(1);
  });
  it('the string and list forms of `on` are understood, and a list without push is not a push trigger', () => {
    expect(analyse('x.yml', wf('push', { j: SECRET_JOB })).violations).toHaveLength(1);
    expect(analyse('x.yml', wf(['push', 'pull_request'], { j: SECRET_JOB })).violations).toHaveLength(1);
    expect(analyse('x.yml', wf(['pull_request', 'workflow_dispatch'], { j: SECRET_JOB })).violations).toEqual([]);
    expect(analyse('x.yml', wf('pull_request', { j: SECRET_JOB })).violations).toEqual([]);
  });
  it('branches-ignore and a paths-only filter still mean every other branch', () => {
    expect(analyse('x.yml', wf({ push: { 'branches-ignore': ['docs/**'] } }, { j: SECRET_JOB })).violations).toHaveLength(1);
    expect(analyse('x.yml', wf({ push: { paths: ['src/**'] } }, { j: SECRET_JOB })).violations).toHaveLength(1);
    expect(analyse('x.yml', wf({ push: { tags: ['v*'], 'paths-ignore': ['docs/**'] } }, { j: SECRET_JOB })).violations).toHaveLength(1);
  });
  it('main only, a tags-only push, a pull_request, a schedule or a manual run are out of scope', () => {
    expect(analyse('x.yml', wf({ push: { branches: ['main'] } }, { j: SECRET_JOB })).violations).toEqual([]);
    expect(analyse('x.yml', wf({ push: { tags: ['v*'] } }, { j: SECRET_JOB })).violations).toEqual([]);
    expect(analyse('x.yml', wf({ pull_request: {} }, { j: SECRET_JOB })).violations).toEqual([]);
    expect(analyse('x.yml', wf({ schedule: [{ cron: '0 3 * * *' }], workflow_dispatch: {} }, { j: SECRET_JOB })).violations).toEqual([]);
  });
  it('a missing, null or true-keyed trigger does not throw', () => {
    expect(analyse('x.yml', { jobs: { j: SECRET_JOB } }).violations).toEqual([]);
    expect(analyse('x.yml', wf(null, { j: SECRET_JOB })).violations).toEqual([]);
    expect(analyse('x.yml', { true: null, jobs: { j: SECRET_JOB } } as Workflow).violations).toEqual([]);
    expect(analyse('x.yml', { true: { push: { branches: ['claude/**'] } }, jobs: { j: SECRET_JOB } } as Workflow).violations).toHaveLength(1);
  });
  it('the read-only hub token and GITHUB_TOKEN are allowed on any branch push; a new secret is not', () => {
    expect(analyse('x.yml', wf({ push: {} }, { j: HUB_READ_JOB })).violations).toEqual([]);
    expect(analyse('x.yml', wf({ push: {} }, { j: { steps: [{ run: 'echo ${{ secrets.GITHUB_TOKEN }}' }] } })).violations).toEqual([]);
    expect(analyse('x.yml', wf({ push: {} }, { j: { steps: [{ run: 'echo ${{ secrets.SOMETHING_NEW }}' }] } })).violations).toHaveLength(1);
  });
  it('the report names the file, the job, every secret and every branch, exactly', () => {
    const job: Job = { steps: [{ run: 'echo ${{ secrets.ALPHA }} ${{ secrets.BETA }} ${{ secrets.ALPHA }}' }] };
    expect(analyse('deploy.yml', wf({ push: { branches: ['main', 'claude/**', 'feature/**'] } }, { build: job })).violations).toEqual([
      'deploy.yml: job "build" uses ALPHA, BETA and a push to claude/**, feature/** triggers it',
    ]);
  });
});

describe('the environment exemption needs BOTH an environment and a main-only if', () => {
  const push = { push: { branches: ['main', 'claude/**'] } };
  it('an environment job pinned to main is exempt, and is listed', () => {
    const r = analyse('ci.yml', wf(push, { 'deploy-staging': BOUND_JOB }));
    expect(r.violations).toEqual([]);
    expect(r.bound).toEqual(['ci.yml:deploy-staging']);
  });
  it('an environment with no main-only if is flagged', () => {
    const job: Job = { ...BOUND_JOB, if: undefined };
    expect(analyse('ci.yml', wf(push, { d: job })).violations).toHaveLength(1);
    const wrongIf: Job = { ...BOUND_JOB, if: "github.event_name == 'push'" };
    expect(analyse('ci.yml', wf(push, { d: wrongIf })).violations).toHaveLength(1);
  });
  it('a main-only if with no environment is flagged', () => {
    const job: Job = { ...BOUND_JOB, environment: undefined };
    expect(analyse('ci.yml', wf(push, { d: job })).violations).toHaveLength(1);
  });
  it('an `||` in the if fails closed, even when it mentions main', () => {
    const job: Job = { ...BOUND_JOB, if: "github.ref == 'refs/heads/main' || github.event_name == 'push'" };
    expect(analyse('ci.yml', wf(push, { d: job })).violations).toHaveLength(1);
  });
  it('the main test must be on github.ref, not on the base ref or the head ref', () => {
    const job: Job = { ...BOUND_JOB, if: "github.base_ref == 'refs/heads/main'" };
    expect(analyse('ci.yml', wf(push, { d: job })).violations).toHaveLength(1);
  });
});

describe('the real workflows', () => {
  const dir = path.join(__dirname, '../../.github/workflows');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();
  const all = files.map((f) => analyse(f, (yaml.load(fs.readFileSync(path.join(dir, f), 'utf-8')) ?? {}) as Workflow));

  it('there are workflows to check (a green run is not an empty run)', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('no job that uses a protected secret can be triggered by a push to a branch other than main', () => {
    const found = all.flatMap((r) => r.violations);
    expect(
      found,
      'On a push the workflow file comes from the pushed branch, so a writer can read these secrets.\n' +
        'Limit the push trigger to main, run the job from a schedule or manual trigger, or (for a deploy) ' +
        'give it an environment with a main-only deployment policy AND an `if:` pinned to main.\n' +
        found.map((l) => '  - ' + l).join('\n'),
    ).toEqual([]);
  });

  it('no job relies on the environment exemption (no workflow with a secret runs on a branch push)', () => {
    expect(all.flatMap((r) => r.bound).sort()).toEqual([]);
  });
});
