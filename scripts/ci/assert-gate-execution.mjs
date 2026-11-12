/**
 * Gate-execution reconciler, ported from ourSharedEvents
 * (scripts/assert-gate-execution.mjs, OSE-1255).
 *
 * `All Checks Passed` guarantees a gate cannot pass while one of its jobs is red.
 * This guarantees a gate cannot SILENTLY NOT RUN. For a given trigger a fixed set
 * of jobs is expected to execute; this reconciles that set against what actually
 * ran (`toJSON(needs)`) and fails when an expected job was skipped, cancelled or
 * absent with no failure upstream of it to explain why.
 *
 * Expected set for ci.yml:
 *   - Every trigger: S0, static analysis, the whole test pyramid and the
 *     `All Checks Passed` aggregator.
 *   - A push to main also expects `deploy-staging`.
 *   - `deploy-production` is never expected: it is an operator action on a manual
 *     dispatch, and production gating belongs to its own change.
 *
 * Legit-skip rule. One change from OSE: OSE excuses every skip once ANY expected
 * gate failed. Here a skip is excused only by a failure UPSTREAM of that job (its
 * `needs:`, transitively, per GATES below). A test job that skips while an
 * unrelated job failed is still a hole, and the aggregator failing (it sits
 * downstream of every test job) excuses nothing. A job that ran and FAILED counts
 * as executed: its outcome is its own red signal; this asserts coverage only.
 * A cancelled job is never excused (it is the root cause), but the jobs below it
 * are, so one cancellation reports once.
 *
 * GATES mirrors the `needs:` graph of .github/workflows/ci.yml. The unit tier
 * compares the two (tests/unit/ci/gate-execution.test.ts), so a job added to,
 * removed from or rewired in ci.yml without updating this file fails CI.
 *
 * Advisory at first, as in OSE: the job fails red, but it is not a required check
 * until the owner makes it one.
 *
 * Usage (from the reconciler job):
 *   EVENT_NAME=... REF=... RESULTS_JSON='${{ toJSON(needs) }}' node scripts/ci/assert-gate-execution.mjs
 *   node scripts/ci/assert-gate-execution.mjs --self-test
 */
import { resultsFromNeeds } from './require-all-success.mjs';

/** ci.yml job id → the jobs it `needs:`. Keep in step with ci.yml (the unit tier checks). */
export const GATES = {
  security: [],
  'lint-and-typecheck': ['security'],
  'secret-scanning': ['security'],
  'unit-tests': ['security', 'lint-and-typecheck'],
  'integration-tests': ['security', 'lint-and-typecheck'],
  'contract-tests': ['security', 'lint-and-typecheck'],
  'security-tests': ['security', 'lint-and-typecheck'],
  'e2e-tests': ['security', 'lint-and-typecheck'],
  'bruno-tests': ['security', 'lint-and-typecheck'],
  'fuzz-tests': ['security', 'lint-and-typecheck'],
  'performance-tests': ['security', 'unit-tests', 'integration-tests'],
  'all-checks': [
    'security',
    'lint-and-typecheck',
    'secret-scanning',
    'unit-tests',
    'integration-tests',
    'contract-tests',
    'security-tests',
    'e2e-tests',
    'bruno-tests',
    'fuzz-tests',
    'performance-tests',
  ],
  'deploy-staging': ['all-checks'],
  'deploy-production': ['all-checks'],
};

const EXECUTED = new Set(['success', 'failure']);

/** Every job upstream of `job` (its needs, transitively). */
export function upstreamOf(job, graph = GATES) {
  const seen = new Set();
  const stack = [...(graph[job] || [])];
  while (stack.length) {
    const j = stack.pop();
    if (seen.has(j)) continue;
    seen.add(j);
    stack.push(...(graph[j] || []));
  }
  return seen;
}

/** The set of job ids expected to EXECUTE for this trigger. */
export function expectedGates({ eventName, ref } = {}) {
  const set = new Set(GATES['all-checks']);
  set.add('all-checks');
  if (eventName === 'push' && ref === 'refs/heads/main') set.add('deploy-staging');
  return set;
}

/**
 * Reconcile expected vs actual. `results` maps job id → result
 * (success | failure | skipped | cancelled | undefined).
 */
export function findViolations(expected, results, graph = GATES) {
  const res = results || {};
  const executed = [];
  const unexplained = [];
  const cascaded = [];
  for (const g of expected) {
    if (EXECUTED.has(res[g])) {
      executed.push(g);
      continue;
    }
    const up = [...upstreamOf(g, graph)];
    const cause = res[g] !== 'cancelled' && up.find((u) => res[u] === 'failure' || res[u] === 'cancelled');
    const result = res[g] || 'absent';
    if (cause) cascaded.push({ job: g, result, cause, causeResult: res[cause] });
    else unexplained.push({ job: g, result });
  }
  return { violation: unexplained.length > 0, executed, unexplained, cascaded };
}

const fmtHole = (u) => `${u.job}=${u.result}`;
const fmtCascade = (c) => `${c.job} (after ${c.cause} ${c.causeResult})`;

const MAIN = { eventName: 'push', ref: 'refs/heads/main' };
const PR = { eventName: 'pull_request', ref: 'refs/pull/1/merge' };
const RUN = { eventName: 'workflow_dispatch', ref: 'refs/heads/main' };
const ALL_RAN = Object.fromEntries(Object.keys(GATES).map((g) => [g, 'success']));
const NO_DEPLOY = { ...ALL_RAN, 'deploy-staging': 'skipped', 'deploy-production': 'skipped' };

/** [name, trigger, results, expectViolation]. Shared with the unit tier. */
export const SELF_TEST_CASES = [
  ['PR, every gate ran, deploys skipped → OK', PR, NO_DEPLOY, false],
  ['PR, a test job ran and FAILED → OK (executed; its own red is the signal)', PR, { ...NO_DEPLOY, 'fuzz-tests': 'failure', 'all-checks': 'failure' }, false],
  ['PR, a test job SILENTLY skipped, nothing upstream failed → VIOLATION', PR, { ...NO_DEPLOY, 'fuzz-tests': 'skipped', 'all-checks': 'failure' }, true],
  ['PR, the aggregator failing does not excuse a skip upstream of it → VIOLATION', PR, { ...NO_DEPLOY, 'e2e-tests': 'skipped', 'all-checks': 'failure' }, true],
  ['PR, an UNRELATED job failed does not excuse a skip → VIOLATION', PR, { ...NO_DEPLOY, 'unit-tests': 'failure', 'fuzz-tests': 'skipped', 'performance-tests': 'skipped', 'all-checks': 'failure' }, true],
  ['PR, unit tests FAILED so performance skipped → OK (honest cascade)', PR, { ...NO_DEPLOY, 'unit-tests': 'failure', 'performance-tests': 'skipped', 'all-checks': 'failure' }, false],
  ['PR, lint FAILED so the whole pyramid skipped → OK (honest cascade)', PR, { security: 'success', 'lint-and-typecheck': 'failure', 'secret-scanning': 'success', 'unit-tests': 'skipped', 'integration-tests': 'skipped', 'contract-tests': 'skipped', 'security-tests': 'skipped', 'e2e-tests': 'skipped', 'bruno-tests': 'skipped', 'fuzz-tests': 'skipped', 'performance-tests': 'skipped', 'all-checks': 'failure' }, false],
  ['PR, a test job CANCELLED with nothing failed → VIOLATION', PR, { ...NO_DEPLOY, 'e2e-tests': 'cancelled', 'all-checks': 'failure' }, true],
  ['PR, a test job absent from the results → VIOLATION', PR, (({ 'bruno-tests': _, ...rest }) => rest)(NO_DEPLOY), true],
  ['PR, the aggregator itself skipped → VIOLATION', PR, { ...NO_DEPLOY, 'all-checks': 'skipped' }, true],
  ['PR, S0 skipped → VIOLATION (S0 is always expected)', PR, { ...NO_DEPLOY, security: 'skipped' }, true],
  ['main push, everything ran → OK', MAIN, { ...ALL_RAN, 'deploy-production': 'skipped' }, false],
  ['main push, deploy ran and FAILED → OK (executed)', MAIN, { ...ALL_RAN, 'deploy-staging': 'failure', 'deploy-production': 'skipped' }, false],
  ['main push, deploy SILENTLY skipped → VIOLATION', MAIN, NO_DEPLOY, true],
  ['main push, a test FAILED so the deploy skipped → OK (honest cascade)', MAIN, { ...NO_DEPLOY, 'contract-tests': 'failure', 'all-checks': 'failure' }, false],
  ['manual run, production skipped → OK (production is never expected)', RUN, NO_DEPLOY, false],
  ['manual run, a test job skipped → VIOLATION', RUN, { ...NO_DEPLOY, 'unit-tests': 'skipped', 'performance-tests': 'skipped' }, true],
];

function runSelfTest() {
  let failed = 0;
  for (const [name, ctx, results, expectViolation] of SELF_TEST_CASES) {
    const got = findViolations(expectedGates(ctx), results).violation;
    const pass = got === expectViolation;
    if (!pass) failed++;
    console.log(`${pass ? 'PASS' : 'FAIL'} — ${name} (expected violation=${expectViolation}, got ${got})`);
  }
  if (failed > 0) {
    console.error(`\nself-test: ${failed} case(s) failed — reconciler logic is wrong.`);
    process.exit(1);
  }
  console.log(`\nself-test: all ${SELF_TEST_CASES.length} cases passed.`);
}

function main() {
  let raw;
  try {
    raw = JSON.parse(process.env.RESULTS_JSON || '{}');
  } catch {
    console.error('::error::gate-execution: RESULTS_JSON is not valid JSON (expected `toJSON(needs)`).');
    process.exit(1);
  }
  const results = resultsFromNeeds(raw);
  const expected = expectedGates({ eventName: process.env.EVENT_NAME, ref: process.env.REF });
  const { violation, executed, unexplained, cascaded } = findViolations(expected, results);

  console.log(`gate-execution: trigger=${process.env.EVENT_NAME} ref=${process.env.REF || ''}`);
  console.log(`gate-execution: expected ${expected.size} — ${[...expected].join(', ')}`);
  console.log(`gate-execution: executed ${executed.length} — ${executed.join(', ') || '(none)'}`);
  if (cascaded.length) {
    console.log(`gate-execution: skipped after an upstream failure — ${cascaded.map(fmtCascade).join(', ')}`);
  }

  if (violation) {
    console.error(
      `::error::gate-execution: expected job(s) did NOT run and nothing upstream of them failed: ${unexplained.map(fmtHole).join(', ')}`,
    );
    console.error(
      'A gate that silently does not run is the false-green hole. If the skip is intended, change ' +
        'expectedGates() in scripts/ci/assert-gate-execution.mjs with a born-red case; do not ignore it.',
    );
    process.exit(1);
  }
  console.log('gate-execution: every job expected for this trigger executed (or was skipped after a failure upstream of it).');
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('assert-gate-execution.mjs');
if (isMain) {
  if (process.argv.includes('--self-test')) runSelfTest();
  else main();
}
