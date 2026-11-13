/**
 * OW-202 — production cannot ship on a commit that staging never proved.
 *
 * `deploy-production` used to declare `needs: [all-checks]` only. all-checks is
 * the PR-time fan-in (unit, integration, contract, security, e2e, lint, secret
 * scanning). It says nothing about whether this commit was ever deployed to
 * staging, had its remote D1 migrations applied, or passed `smoke:staging` —
 * the one layer that proves the controls actually fire against a deployed
 * Worker rather than against a mocked boundary.
 *
 * So a workflow_dispatch on main could reach production having never touched
 * staging. The `environment: production` approval gate stayed in place, but an
 * approver cannot see what was never run, so the job graph has to carry the
 * guarantee instead of the human.
 *
 * The fix has two halves, and the second is the one that is easy to get wrong:
 *
 *   1. `deploy-production` needs `deploy-staging`.
 *   2. `deploy-staging` must also run on workflow_dispatch. GitHub skips any
 *      job whose `needs` target was skipped, and deploy-staging was push-only.
 *      Adding the dependency without widening that condition would not have
 *      made production safer, it would have made production undeployable.
 *
 * This test locks both halves, plus the approval environment on production, so
 * none of them can be removed without visibly deleting an assertion.
 *
 * Born red: each detector runs against synthetic workflows that violate the
 * rule before it runs against the real one, so it cannot pass vacuously.
 *
 * Brain: per-repo gate. Candidate for central registration alongside
 * security_control_wiring; number to be assigned centrally, NOT minted here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(__dirname, '..', '..');
const CI_PATH = join(ROOT, '.github/workflows/ci.yml');

interface Job {
  needs?: string | string[];
  if?: string;
  environment?: string | { name?: string };
}

/** `needs` as a list, whether it was written as a scalar or a sequence. */
function needsOf(job: Job | undefined): string[] {
  if (!job?.needs) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

/** True when the job's `if` admits the given event name. */
function admitsEvent(job: Job | undefined, event: string): boolean {
  return (job?.if ?? '').includes(`github.event_name == '${event}'`);
}

function jobsOf(workflow: string): Record<string, Job> {
  return (parse(workflow) as { jobs: Record<string, Job> }).jobs;
}

const realJobs = jobsOf(readFileSync(CI_PATH, 'utf-8'));

/** A minimal workflow with the two deploy jobs wired however the test wants. */
function synthetic(opts: {
  productionNeeds: string[];
  stagingIf: string;
}): Record<string, Job> {
  return jobsOf(`
name: synthetic
on: [push]
jobs:
  all-checks:
    runs-on: ubuntu-24.04
    steps: [{ run: "true" }]
  deploy-staging:
    runs-on: ubuntu-24.04
    needs: all-checks
    if: ${JSON.stringify(opts.stagingIf)}
    environment: staging
    steps: [{ run: "true" }]
  deploy-production:
    runs-on: ubuntu-24.04
    needs: ${JSON.stringify(opts.productionNeeds)}
    if: "github.event_name == 'workflow_dispatch'"
    environment: production
    steps: [{ run: "true" }]
`);
}

const BOTH_EVENTS =
  "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')";
const PUSH_ONLY =
  "github.ref == 'refs/heads/main' && github.event_name == 'push'";

describe('OW-202 — production is gated on staging', () => {
  it('both deploy jobs exist in ci.yml', () => {
    expect(Object.keys(realJobs)).toEqual(
      expect.arrayContaining(['all-checks', 'deploy-staging', 'deploy-production']),
    );
  });

  describe('the detector is born red', () => {
    it('fails a workflow whose production job does not need staging', () => {
      const jobs = synthetic({
        productionNeeds: ['all-checks'],
        stagingIf: BOTH_EVENTS,
      });
      expect(needsOf(jobs['deploy-production'])).not.toContain('deploy-staging');
    });

    it('fails a workflow whose staging job is push-only, which would strand production', () => {
      const jobs = synthetic({
        productionNeeds: ['all-checks', 'deploy-staging'],
        stagingIf: PUSH_ONLY,
      });
      // The dependency is present, so a needs-only check would call this safe.
      expect(needsOf(jobs['deploy-production'])).toContain('deploy-staging');
      // It is not safe: staging never runs on the event production runs on, so
      // GitHub skips staging and therefore skips production.
      expect(admitsEvent(jobs['deploy-staging'], 'workflow_dispatch')).toBe(false);
    });

    it('passes a correctly wired synthetic workflow', () => {
      const jobs = synthetic({
        productionNeeds: ['all-checks', 'deploy-staging'],
        stagingIf: BOTH_EVENTS,
      });
      expect(needsOf(jobs['deploy-production'])).toContain('deploy-staging');
      expect(admitsEvent(jobs['deploy-staging'], 'workflow_dispatch')).toBe(true);
    });
  });

  describe('the real workflow', () => {
    it('production needs staging', () => {
      expect(needsOf(realJobs['deploy-production'])).toContain('deploy-staging');
    });

    it('production still needs the PR-time fan-in', () => {
      expect(needsOf(realJobs['deploy-production'])).toContain('all-checks');
    });

    it('staging runs on workflow_dispatch, so the dependency does not strand production', () => {
      expect(admitsEvent(realJobs['deploy-staging'], 'workflow_dispatch')).toBe(true);
    });

    it('staging still runs on push', () => {
      expect(admitsEvent(realJobs['deploy-staging'], 'push')).toBe(true);
    });

    it('production keeps its approval environment', () => {
      const env = realJobs['deploy-production']?.environment;
      const name = typeof env === 'string' ? env : env?.name;
      expect(name).toBe('production');
    });

    it('both deploy jobs stay pinned to main', () => {
      for (const job of ['deploy-staging', 'deploy-production']) {
        expect(realJobs[job]?.if ?? '').toContain("github.ref == 'refs/heads/main'");
      }
    });
  });
});
