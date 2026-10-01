/**
 * OW-152 — the deploy jobs get CLOUDFLARE_API_TOKEN from Doppler, and say so when it is missing.
 *
 * Every deploy from June to October 2026 failed at its first wrangler call:
 * each step set CLOUDFLARE_API_TOKEN from `secrets.CLOUDFLARE_API_TOKEN`, a
 * GitHub secret that was never created, and wrangler only said "non-interactive
 * environment". Secrets live in Doppler. This test locks, for both deploy jobs:
 *   1. no step sets CLOUDFLARE_API_TOKEN itself (Doppler is the only source);
 *   2. every step that calls wrangler runs it under `doppler run --`;
 *   3. a named check that the token is non-empty runs before the first wrangler step.
 * The detectors run on synthetic workflows first, so they cannot pass vacuously.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');

const DEPLOY_JOBS = ['deploy-staging', 'deploy-production'];
const TOKEN_CHECK = /test -n "\$CLOUDFLARE_API_TOKEN"/;

/** The text of one top-level job (two-space indent under `jobs:`). */
function jobText(workflow: string, name: string): string {
  const start = workflow.search(new RegExp(`^  ${name}:[ \\t]*\\r?$`, 'm'));
  if (start === -1) return '';
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[\w-]+:[ \t]*\r?$/m);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

/** The job's steps, each as its own text block. */
function steps(job: string): string[] {
  return job.split(/^ {6}- /m).slice(1);
}

interface Finding {
  job: string;
  problem: string;
}

/** Everything wrong with how one deploy job gets its Cloudflare token. */
function auditJob(workflow: string, name: string): Finding[] {
  const job = jobText(workflow, name);
  if (!job) return [{ job: name, problem: 'job not found' }];
  const out: Finding[] = [];
  const list = steps(job);

  list.forEach((s, i) => {
    if (/^\s+CLOUDFLARE_API_TOKEN:/m.test(s)) {
      out.push({ job: name, problem: `step ${i} sets CLOUDFLARE_API_TOKEN itself` });
    }
    const run = /run:\s*(.*)/.exec(s)?.[1] ?? '';
    if (/wrangler/.test(run) && !/doppler run --/.test(run)) {
      out.push({ job: name, problem: `step ${i} calls wrangler outside doppler run` });
    }
  });

  const firstWrangler = list.findIndex((s) => /run:.*wrangler/.test(s));
  const check = list.findIndex((s) => TOKEN_CHECK.test(s) && /doppler run --/.test(s));
  if (firstWrangler === -1) out.push({ job: name, problem: 'no wrangler step found' });
  if (check === -1) out.push({ job: name, problem: 'no named non-empty token check' });
  else if (firstWrangler !== -1 && check > firstWrangler) {
    out.push({ job: name, problem: 'token check runs after the first wrangler step' });
  }
  return out;
}

/** A minimal deploy job built from step snippets, for the detector self-tests. */
function synthetic(stepsYaml: string[]): string {
  return ['jobs:', '  deploy-staging:', '    steps:', ...stepsYaml, '  other:', '    steps: []'].join(
    '\n'
  );
}

const CHECK_STEP = [
  '      - name: Doppler provides CLOUDFLARE_API_TOKEN (stg)',
  `        run: doppler run -- bash -c 'test -n "$CLOUDFLARE_API_TOKEN" || exit 1'`,
];
const GOOD_DEPLOY = ['      - name: Deploy', '        run: doppler run -- npx wrangler deploy'];

describe('OW-152 | deploy token wiring detectors (not vacuous)', () => {
  it('a correct job has no findings', () => {
    expect(auditJob(synthetic([...CHECK_STEP, ...GOOD_DEPLOY]), 'deploy-staging')).toEqual([]);
  });

  it('flags a step that sets CLOUDFLARE_API_TOKEN from a GitHub secret (the June bug)', () => {
    const bad = synthetic([
      ...CHECK_STEP,
      ...GOOD_DEPLOY,
      '        env:',
      '          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
    ]);
    expect(auditJob(bad, 'deploy-staging').map((f) => f.problem)).toEqual([
      'step 1 sets CLOUDFLARE_API_TOKEN itself',
    ]);
  });

  it('flags a missing token check, and one placed after the first wrangler step', () => {
    expect(auditJob(synthetic(GOOD_DEPLOY), 'deploy-staging').map((f) => f.problem)).toEqual([
      'no named non-empty token check',
    ]);
    expect(
      auditJob(synthetic([...GOOD_DEPLOY, ...CHECK_STEP]), 'deploy-staging').map((f) => f.problem)
    ).toEqual(['token check runs after the first wrangler step']);
  });

  it('flags wrangler called outside doppler run', () => {
    const bad = synthetic([...CHECK_STEP, '      - name: Deploy', '        run: npx wrangler deploy']);
    expect(auditJob(bad, 'deploy-staging').map((f) => f.problem)).toEqual([
      'step 1 calls wrangler outside doppler run',
    ]);
  });
});

describe('OW-152 | ci.yml deploy jobs take the Cloudflare token from Doppler only', () => {
  for (const name of DEPLOY_JOBS) {
    it(`${name}: Doppler-only token, named non-empty check before wrangler`, () => {
      expect(auditJob(ci, name)).toEqual([]);
    });
  }
});
