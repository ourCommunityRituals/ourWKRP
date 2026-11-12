/**
 * The `All Checks Passed` aggregator's verdict: every job it needs must have
 * finished with `success`.
 *
 * Why a script: with plain `needs:`, a failed job makes the aggregator SKIPPED,
 * not failed, and GitHub counts a skipped required check as passing. So the
 * aggregator runs with `if: always()` and this decides. Anything other than
 * `success` fails it: `failure`, `cancelled`, `skipped`, and a job missing from
 * the results. An empty result set fails too, so an aggregator whose `needs:`
 * was emptied cannot pass by checking nothing.
 *
 * Pure `notSuccessful` is exported and import-safe (the CLI is isMain-guarded),
 * so its born-red cases run in the unit tier (tests/unit/ci/gate-execution.test.ts).
 *
 * Usage (from the aggregator job):
 *   RESULTS_JSON='${{ toJSON(needs) }}' node scripts/ci/require-all-success.mjs
 */
import { appendFileSync } from 'node:fs';

/** Normalise `toJSON(needs)` ({job: {result, outputs}}) to {job: result}. */
export function resultsFromNeeds(raw) {
  const results = {};
  for (const [k, v] of Object.entries(raw || {})) {
    results[k] = v && typeof v === 'object' ? v.result : v;
  }
  return results;
}

/**
 * The jobs that did not succeed, as `job=result` strings, in order.
 * An empty result set is itself a failure: there was nothing to aggregate.
 */
export function notSuccessful(results) {
  const entries = Object.entries(results || {});
  if (entries.length === 0) return ['(no jobs: the aggregator needs nothing, so it proves nothing)'];
  return entries.filter(([, r]) => r !== 'success').map(([k, r]) => `${k}=${r || 'absent'}`);
}

function main() {
  let raw;
  try {
    raw = JSON.parse(process.env.RESULTS_JSON || '{}');
  } catch {
    console.error('::error::All Checks Passed: RESULTS_JSON is not valid JSON (expected `toJSON(needs)`).');
    process.exit(1);
  }
  const results = resultsFromNeeds(raw);
  const bad = notSuccessful(results);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const lines = ['## All Checks Passed', '', '| Job | Result |', '|---|---|'];
  for (const [k, r] of Object.entries(results)) lines.push(`| ${k} | ${r === 'success' ? '✅' : '❌'} ${r} |`);
  if (summary) appendFileSync(summary, lines.join('\n') + '\n');
  if (bad.length) {
    console.error(`::error::All Checks Passed: ${bad.length} job(s) did not succeed: ${bad.join(', ')}`);
    console.error('A skipped or cancelled job is not a pass. Fix or re-run the job named above.');
    process.exit(1);
  }
  console.log(`All Checks Passed: all ${Object.keys(results).length} jobs succeeded.`);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('require-all-success.mjs');
if (isMain) main();
