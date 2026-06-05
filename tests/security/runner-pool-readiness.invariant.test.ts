/**
 * Architectural invariant #12 — runner_pool_readiness_probe (per-repo facet)
 *
 * Brain:     ourCommunityRituals/OCR-docs → architectural-invariants.yaml #12
 * Tracking:  OSE-411 (promote #12 partial → live)
 * Bundles:   invariant #11 self_hosted_runner_bash_resolution (per OSE-411 coordination note)
 *
 * #12 governs self-hosted runner-pool readiness. The pool's *substrate*
 * mechanism — janitor.ps1, heartbeat probe, circuit breaker, log markers —
 * is enforced centrally on the runner pool + the brain's own test pyramid,
 * NOT here. A product repo does not own that infrastructure.
 *
 * What IS a per-repo property — and what this spec enforces — is the workflow
 * hygiene the invariant depends on:
 *
 *   1. Every workflow job caps its runtime (`timeout-minutes`), so a stalled
 *      self-hosted runner gets cancelled instead of hanging. This is the exact
 *      hole the 2026-06-02 → 2026-06-05 incident fell through: scheduled jobs
 *      stuck with elapsed times of 18h33m and 24h00m on the pool.
 *   2. (#11) Self-hosted Windows runners default to PowerShell, so any workflow
 *      with bash `run:` steps must pin `shell: bash`.
 *
 * NOTE on placement: this lives in tests/security/ (not the cross-repo
 * convention tests/e2e/0-architecture/) because WKRP's vitest config excludes
 * tests/e2e/** and that dir is Playwright-only + ungated. tests/security IS run
 * on every PR via the `security-tests` job, which is the point.
 *
 * NOTE on robustness: timeout-minutes is counted with a `>=` against job count
 * rather than full YAML parsing (no yaml dep, matching this repo's string-based
 * invariant style). Step-level timeouts could in theory mask a job-level miss;
 * acceptable for the per-repo gate. The authoritative substrate check is central.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WORKFLOWS_DIR = path.join(__dirname, '../../.github/workflows');

const workflowFiles = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .sort();

describe('Invariant #12 — runner-pool readiness (per-repo: every job has a timeout)', () => {
  it('discovers at least one workflow file', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  for (const file of workflowFiles) {
    const src = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8');
    // Each job declares exactly one `runs-on:` → job count.
    // Each job must also declare a `timeout-minutes:` so a stalled runner is
    // cancelled rather than left hanging for hours.
    const jobCount = (src.match(/^\s*runs-on:/gm) || []).length;
    const timeoutCount = (src.match(/^\s*timeout-minutes:/gm) || []).length;

    it(`${file}: every job caps runtime with timeout-minutes (${timeoutCount}/${jobCount})`, () => {
      expect(timeoutCount).toBeGreaterThanOrEqual(jobCount);
    });
  }
});

describe('Invariant #11 — self-hosted bash pin (bundled with #12 per OSE-411)', () => {
  for (const file of workflowFiles) {
    const src = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8');
    const hasRunSteps = /^\s*run:/m.test(src);
    const isSelfHosted = /runs-on:\s*self-hosted/.test(src);

    // Only workflows that actually run shell commands on a self-hosted runner
    // need the bash pin; pure `uses:`-only workflows are exempt.
    if (hasRunSteps && isSelfHosted) {
      it(`${file}: pins shell: bash for self-hosted runner`, () => {
        expect(src).toMatch(/shell:\s*bash/);
      });
    }
  }
});
