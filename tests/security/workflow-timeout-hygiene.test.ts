/**
 * CI workflow hygiene — every workflow job caps its runtime.
 *
 * Origin: extracted from the retired `runner-pool-readiness.invariant.test.ts`.
 * Brain invariants #11 (`self_hosted_runner_bash_resolution`) and #12
 * (`runner_pool_readiness_probe`) were RETIRED 2026-09-02 (OSE-1194) when the
 * self-hosted runner pool was decommissioned. The self-hosted-specific half of
 * the old test (pin `shell: bash` on `runs-on: self-hosted`) is gone — WKRP has
 * no self-hosted workflows. What remains is a runner-AGNOSTIC guard worth keeping
 * on GitHub-hosted runners too:
 *
 *   Every workflow job declares `timeout-minutes`, so a stalled job is cancelled
 *   instead of hanging. This is the exact hole the 2026-06-02 → 2026-06-05
 *   incident fell through: scheduled jobs stuck at 18h33m and 24h00m elapsed.
 *   On GitHub-hosted runners a hung job burns billed minutes, so the guard
 *   matters more, not less, after the migration.
 *
 * This is NOT an architectural-invariant enforcement (the brain invariant it
 * grew out of is retired); it is a local CI-hygiene check. It runs every PR via
 * the `security-tests` job. `timeout-minutes` is counted with `>=` against the
 * job count (no yaml dep — matches this repo's string-based test style).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WORKFLOWS_DIR = path.join(__dirname, '../../.github/workflows');

const workflowFiles = fs
  .readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .sort();

describe('CI workflow hygiene — every job caps runtime with timeout-minutes', () => {
  it('discovers at least one workflow file', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  for (const file of workflowFiles) {
    const src = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8');
    // Each job declares exactly one `runs-on:` → job count.
    // Each job must also declare a `timeout-minutes:` so a stalled runner is
    // cancelled rather than left hanging for hours (and burning billed minutes).
    const jobCount = (src.match(/^\s*runs-on:/gm) || []).length;
    const timeoutCount = (src.match(/^\s*timeout-minutes:/gm) || []).length;

    it(`${file}: every job caps runtime with timeout-minutes (${timeoutCount}/${jobCount})`, () => {
      expect(timeoutCount).toBeGreaterThanOrEqual(jobCount);
    });
  }
});
