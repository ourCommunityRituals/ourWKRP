/**
 * Pipeline board for the run summary, ported (small) from ourSharedEvents
 * scripts/ci/render-pipeline-board.mjs.
 *
 * One row per ci.yml job in execution order, with a reason for every job that did
 * not run: not part of this trigger, skipped after a failure upstream of it, or
 * DID NOT RUN with nothing to explain it (the hole the reconciler fails on). It is
 * built on the reconciler's own expected set and legit-skip rule, so the board
 * and the gate cannot disagree.
 *
 * Usage (from the reconciler job):
 *   EVENT_NAME=... REF=... RESULTS_JSON='${{ toJSON(needs) }}' \
 *     node scripts/ci/render-pipeline-board.mjs >> "$GITHUB_STEP_SUMMARY"
 */
import { expectedGates, findViolations, GATES } from './assert-gate-execution.mjs';
import { resultsFromNeeds } from './require-all-success.mjs';

/** Execution order and display names (the ci.yml `name:` of each job). */
export const STAGES = [
  ['security', 'S0 Security'],
  ['lint-and-typecheck', 'Lint & Type Check'],
  ['secret-scanning', 'Secret Scanning'],
  ['unit-tests', 'Unit Tests'],
  ['integration-tests', 'Integration Tests'],
  ['contract-tests', 'Contract Tests'],
  ['security-tests', 'Security Tests'],
  ['e2e-tests', 'E2E Tests'],
  ['bruno-tests', 'Bruno API Tests'],
  ['fuzz-tests', 'Fuzz / Property Tests'],
  ['performance-tests', 'Performance Tests'],
  ['all-checks', 'All Checks Passed'],
  ['deploy-staging', 'Deploy Staging'],
  ['deploy-production', 'Deploy Production'],
];

export function renderBoard(ctx, results) {
  const expected = expectedGates(ctx);
  const { unexplained, cascaded } = findViolations(expected, results, GATES);
  const holes = new Set(unexplained.map((u) => u.job));
  const after = new Map(cascaded.map((c) => [c.job, `${c.cause} ${c.causeResult}`]));

  const rows = STAGES.map(([key, label], i) => {
    const r = results[key];
    let state;
    if (r === 'success') state = '✅ passed';
    else if (r === 'failure') state = '❌ failed';
    else if (holes.has(key)) state = `⚠️ DID NOT RUN (${r || 'absent'}), nothing upstream failed`;
    else if (after.has(key)) state = `⏭️ not run: ${after.get(key)} upstream`;
    else state = key === 'deploy-production' ? '⏭️ manual dispatch only' : '⏭️ not part of this trigger';
    return `| ${i + 1} | ${label} | ${state} |`;
  });

  const headline = holes.size
    ? `**⚠️ ${holes.size} job(s) that should have run did not:** ${[...holes].join(', ')}`
    : STAGES.some(([k]) => results[k] === 'failure')
      ? '**❌ A job failed.** Jobs that depend on it did not run.'
      : '**✅ Every job expected for this trigger ran.**';

  return [
    '## Pipeline',
    '',
    headline,
    '',
    '| Order | Job | State |',
    '|---|---|---|',
    ...rows,
    '',
    `Trigger: \`${ctx.eventName}\`${ctx.ref ? ` · \`${ctx.ref}\`` : ''}`,
  ].join('\n');
}

function main() {
  let raw;
  try {
    raw = JSON.parse(process.env.RESULTS_JSON || '{}');
  } catch {
    console.log('## Pipeline\n\nCould not read job results.');
    return;
  }
  console.log(renderBoard({ eventName: process.env.EVENT_NAME, ref: process.env.REF }, resultsFromNeeds(raw)));
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('render-pipeline-board.mjs');
if (isMain) main();
