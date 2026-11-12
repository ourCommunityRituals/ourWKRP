/**
 * Zero-case guard for a JUnit report: a runner that ran nothing is an error, not
 * a pass.
 *
 * A step that passes on exit code alone cannot tell a full run from one whose
 * collection resolved to no requests (the Playwright form of this is what
 * scripts/pw-guarded.sh guards against). This reads the
 * JUnit the run wrote and fails when it holds zero `<testcase>` elements, when the
 * file is missing, or when it is not a JUnit document at all. Unknown is never
 * green. It does not judge pass/fail: the runner's own exit code does that.
 *
 * Pure `countTestcases` is exported and import-safe (the CLI is isMain-guarded),
 * so its born-red cases run in the unit tier (tests/unit/ci/gate-execution.test.ts).
 *
 * Usage:  node scripts/ci/junit-case-count.mjs <junit.xml> [label]
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

/** Number of `<testcase>` elements, or -1 when the text is not a JUnit document. */
export function countTestcases(xml) {
  if (typeof xml !== 'string' || !/<testsuites?[\s>/]/.test(xml)) return -1;
  return (outsideComments(xml).match(/<testcase[\s>/]/g) || []).length;
}

/**
 * The text outside XML comments, which can hold markup. A scan, not a regex
 * replace: an unterminated `<!--` hides everything after it, so nothing
 * commented out can come back and be counted.
 */
function outsideComments(xml) {
  let out = '';
  let i = 0;
  for (;;) {
    const open = xml.indexOf('<!--', i);
    if (open === -1) return out + xml.slice(i);
    out += xml.slice(i, open);
    const close = xml.indexOf('-->', open + 4);
    if (close === -1) return out;
    i = close + 3;
  }
}

/** The guard's verdict for a file: null when it passes, else the error message. */
export function junitProblem(file, label = file) {
  if (!existsSync(file)) return `${label}: no JUnit report at ${file}. The runner did not write one.`;
  const n = countTestcases(readFileSync(file, 'utf8'));
  if (n === -1) return `${label}: ${file} is not a JUnit report. Treating as FAILURE: an unknown count is never green.`;
  if (n === 0) return `${label}: the JUnit report has 0 test cases. A runner that ran nothing is an error, not a pass.`;
  return null;
}

function main() {
  const [file, label = file] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node scripts/ci/junit-case-count.mjs <junit.xml> [label]');
    process.exit(2);
  }
  const problem = junitProblem(file, label);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (problem) {
    console.error(`::error::${problem}`);
    if (summary) appendFileSync(summary, `- ❌ **${label}**: ${problem}\n`);
    process.exit(1);
  }
  const n = countTestcases(readFileSync(file, 'utf8'));
  console.log(`${label}: ${n} test case(s) in ${file}`);
  if (summary) appendFileSync(summary, `- **${label}**: ran **${n}** test case(s)\n`);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('junit-case-count.mjs');
if (isMain) main();
