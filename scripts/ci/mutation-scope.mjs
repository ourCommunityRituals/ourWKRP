#!/usr/bin/env node
/**
 * Mutation paths: the one list of files whose change needs a mutation run, and
 * the decision the mutation workflow makes from it. Ported from OSE
 * (ourSharedEvents scripts/ci/mutation-paths.mjs; renamed here because
 * the .gitignore secret pattern `*PAT*` matches "paths" on a Windows checkout).
 *
 * `.github/workflows/mutation-testing.yml` starts on every pull request and on
 * every push to `main`, with no `paths:` filter, so its check always reports
 * and can be required on `main`. A required check whose workflow does not start
 * leaves the pull request waiting on it for good. The job runs this file first;
 * when the change touches nothing on the list, the job says so and passes
 * without running Stryker.
 *
 * Fail closed. The only answer that skips the run is "the changed files were
 * read, and none of them is on the list". Everything else runs it: a changed
 * file on the list, an empty list, a list that could not be read, a checkout
 * that is not the one expected, an event other than pull_request or push (the
 * nightly schedule and workflow_dispatch always run), and any error in this
 * file. A required check that passes without looking is the failure this file
 * exists to avoid.
 *
 * To add a mutate target, add it to stryker.conf.mjs, its floor to
 * mutation-floors.json, and here its source and the specs that import it.
 * tests/unit/ci/mutation-gate.test.ts fails when a mutated or floored file, or
 * a spec in the mutation project that imports a mutated file, is missing from
 * the list. (OSE's version leaves the specs to review; here the import graph
 * is checked. A spec that reaches a mutated file only through another module
 * is not found, and the nightly run still measures it.)
 *
 * Usage (from the repository root, in a checkout with fetch-depth 2):
 *   GITHUB_EVENT_NAME=pull_request MUTATION_PR_HEAD_SHA=<sha> node scripts/ci/mutation-scope.mjs
 *   GITHUB_EVENT_NAME=push MUTATION_BEFORE_SHA=<sha> node scripts/ci/mutation-scope.mjs
 *   -> prints `run=true` or `run=false`, and appends it to $GITHUB_OUTPUT
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW = '.github/workflows/mutation-testing.yml';
const SELF = 'scripts/ci/mutation-scope.mjs';
const FLOOR_SCRIPT = 'scripts/ci/mutation-file-floor.mjs';
const FLOORS_FILE = 'mutation-floors.json';
const STRYKER_CONFIG = 'stryker.conf.mjs';

/** Exact repository-relative paths. A change to any of them needs a mutation run. */
export const MUTATION_PATHS = Object.freeze([
  // The mutated sources (stryker.conf.mjs `mutate`).
  'src/lib/count-floor.ts',
  'src/lib/session.ts',
  'src/lib/session-cookie.ts',
  'src/lib/require-session.ts',
  'src/lib/roles.ts',
  'src/lib/admin-auth.ts',
  'src/lib/origin-check.ts',
  'src/lib/cors.ts',
  'src/lib/cross-product-auth.ts',
  'src/lib/rate-limit.ts',
  'src/lib/security-headers.ts',
  'src/lib/html.ts',
  'src/lib/validate.ts',
  'src/lib/schemas.ts',
  'src/lib/ids.ts',
  'src/lib/route-path.ts',
  'src/lib/cursor.ts',
  'src/lib/privacy.ts',
  'src/lib/erasure.ts',
  'src/lib/crypto.ts',
  // The specs in the mutation project that import a mutated source directly
  // (checked against the import graph by tests/unit/ci/mutation-gate.test.ts).
  'tests/fuzz/cursor.fuzz.test.ts',
  'tests/fuzz/route-path.fuzz.test.ts',
  'tests/security/ccr-invariants.test.ts',
  'tests/security/cors-policy.test.ts',
  'tests/security/cross-product-boundary.invariant.spec.ts',
  'tests/security/security-headers.test.ts',
  'tests/security/vanity-slug-security.test.ts',
  'tests/unit/admin-auth.test.ts',
  'tests/unit/crypto.test.ts',
  'tests/unit/cursor.test.ts',
  'tests/unit/erasure.test.ts',
  'tests/unit/event-id-validation.test.ts',
  'tests/unit/event-music-seam.test.ts',
  'tests/unit/facet-schema.test.ts',
  'tests/unit/kv-storage-encryption.test.ts',
  'tests/unit/origin-check.test.ts',
  'tests/unit/pages-replace-dollar.test.ts',
  'tests/unit/rate-limit.test.ts',
  'tests/unit/rate-limiter-do.test.ts',
  'tests/unit/require-session.test.ts',
  'tests/unit/roles.test.ts',
  'tests/unit/session-cookie.test.ts',
  'tests/unit/session.test.ts',
  'tests/unit/slug.test.ts',
  'tests/unit/validation.test.ts',
  // What the run is built from: the Stryker config, the Vitest projects, the
  // mutation-only setup, the dependencies.
  STRYKER_CONFIG,
  'vitest.config.ts',
  'vitest.mutation.config.ts',
  'tests/support/mutation-setup.ts',
  'tests/support/stryker-sandbox.ts',
  'package.json',
  'package-lock.json',
  // The gate's own wiring: the floors, the floor script, the workflow, this rule
  // and the tests of all of them.
  FLOORS_FILE,
  FLOOR_SCRIPT,
  WORKFLOW,
  SELF,
  'tests/unit/ci/mutation-gate.test.ts',
]);

const normalize = (file) => String(file).trim().replace(/\\/g, '/');

/** The changed files that are on the list. */
export function mutationPathHits(files, paths = MUTATION_PATHS) {
  const listed = new Set(paths);
  return files.map(normalize).filter((p) => listed.has(p));
}

/**
 * Does this event need a mutation run?
 *
 * @param {{eventName?: string, files?: unknown, error?: unknown}} [input]
 *   `files` are the changed paths; `error` is what reading them threw, if anything.
 * @returns {{run: boolean, reason: string}} `run` is false in exactly one case:
 *   a pull_request or push whose changed files were read and are all off the list.
 */
export function decideMutationRun({ eventName, files, error } = {}, paths = MUTATION_PATHS) {
  if (eventName !== 'pull_request' && eventName !== 'push') {
    return { run: true, reason: `event "${eventName}" always runs the mutation tests` };
  }
  if (error) {
    // One line: git's own message follows the command on a second line.
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();
    return {
      run: true,
      reason: `the changed files could not be read, so the mutation tests run (${message})`,
    };
  }
  const changed = Array.isArray(files) ? files.map(normalize).filter(Boolean) : [];
  if (!changed.length) {
    return {
      run: true,
      reason: 'the changed-file list is empty, which is treated as not read, so the mutation tests run',
    };
  }
  const hits = mutationPathHits(changed, paths);
  if (hits.length) {
    const shown = hits.slice(0, 5).join(', ');
    const more = hits.length > 5 ? ` and ${hits.length - 5} more` : '';
    return { run: true, reason: `changed files on the mutation path list: ${shown}${more}` };
  }
  return {
    run: false,
    reason: `none of the ${changed.length} changed file(s) is on the mutation path list (${SELF})`,
  };
}

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const SHA = /^[0-9a-f]{40}$/;

/**
 * The changed files of this event, read from the checkout. Throws when they
 * cannot be read or the checkout is not the one expected; the caller turns that
 * into "run".
 *
 * pull_request: the checkout is GitHub's merge commit of the pull request into
 * its base, so the change under review is that commit against its first parent
 * (needs fetch-depth 2). The commit must have two parents and the second must be
 * the pull request's head; a checkout of anything else would make `HEAD^1` the
 * commit before, and the diff only the last commit.
 *
 * push: the commit before the push against HEAD. With fetch-depth 2 that is
 * there for a squash merge or a merge commit; when it is not, git fails.
 *
 * `--no-renames` lists a moved file under both names, so moving a file off the
 * list still counts as changing it.
 */
export function readChangedFiles({ eventName, before, prHeadSha } = {}, git = runGit) {
  let base;
  if (eventName === 'pull_request') {
    if (!SHA.test(String(prHeadSha || ''))) {
      throw new Error('the pull request head sha is missing from the event');
    }
    const [, ...parents] = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(/\s+/);
    if (parents.length !== 2) {
      throw new Error(`HEAD is not a merge commit (it has ${parents.length} parent(s))`);
    }
    if (parents[1] !== prHeadSha) {
      throw new Error(`HEAD does not merge the pull request head ${prHeadSha}`);
    }
    base = 'HEAD^1';
  } else if (eventName === 'push') {
    if (!SHA.test(String(before || '')) || /^0+$/.test(before)) {
      throw new Error(`the push has no usable before sha ("${before ?? ''}")`);
    }
    base = before;
  } else {
    throw new Error(`event "${eventName}" has no changed files to read`);
  }
  return git(['diff', '--no-renames', '--name-only', '-z', base, 'HEAD'])
    .split('\0')
    .filter(Boolean);
}

const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

/**
 * The repository paths a spec imports by relative specifier, as `.ts` files
 * (`../../src/lib/cors` and `../../src/lib/cors.js` both read as
 * `src/lib/cors.ts`). Package imports are left out.
 */
export function relativeImports(specPath, source) {
  const out = new Set();
  for (const m of source.matchAll(IMPORT)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const joined = posix.normalize(posix.join(posix.dirname(normalize(specPath)), spec));
    out.add(joined.replace(/\.(m?js|ts)$/, '') + '.ts');
  }
  return [...out];
}

const PATTERN = /[*?{}[\]!]/;

/**
 * What the list lacks, one line each; empty when it covers everything.
 *
 * @param {{strykerConfig: any, floors: Record<string, number>, specs: Array<{path: string, source: string}>}} inputs
 *   the default export of stryker.conf.mjs, the floors of mutation-floors.json,
 *   and the spec files of the mutation project with their text.
 */
export function uncoveredMutationInputs({ strykerConfig, floors, specs } = {}, paths = MUTATION_PATHS) {
  const listed = new Set(paths);
  const findings = [];
  const need = (path, why) => {
    if (!listed.has(path)) findings.push(`${path} (${why}) is not in MUTATION_PATHS of ${SELF}`);
  };
  const mutate = Array.isArray(strykerConfig?.mutate) ? strykerConfig.mutate : [];
  if (!mutate.length) findings.push(`${STRYKER_CONFIG} has no mutate targets that could be read`);
  const targets = new Set();
  for (const entry of mutate) {
    const file = String(entry).replace(/:\d+(:\d+)?-\d+(:\d+)?$/, '');
    if (PATTERN.test(file)) {
      findings.push(`${STRYKER_CONFIG} mutates the pattern "${entry}"; this check only knows files`);
      continue;
    }
    targets.add(file);
    need(file, `a mutate target in ${STRYKER_CONFIG}`);
  }
  const vitestConfig = strykerConfig?.vitest?.configFile;
  if (vitestConfig) need(vitestConfig, `the Vitest config of ${STRYKER_CONFIG}`);
  else findings.push(`${STRYKER_CONFIG} names no Vitest config`);
  for (const file of Object.keys(floors || {})) need(file, `a floor in ${FLOORS_FILE}`);
  for (const { path, source } of specs || []) {
    const hit = relativeImports(path, source).find((p) => targets.has(p));
    if (hit) need(normalize(path), `a spec that imports ${hit}`);
  }
  for (const [file, why] of [
    [STRYKER_CONFIG, 'the Stryker config'],
    [FLOORS_FILE, 'the floors'],
    [FLOOR_SCRIPT, 'the per-file floor'],
    [WORKFLOW, 'the workflow'],
    [SELF, 'this rule'],
  ]) {
    need(file, why);
  }
  return findings;
}

function main() {
  let decision;
  try {
    const eventName = process.env.GITHUB_EVENT_NAME;
    let files;
    let error;
    if (eventName === 'pull_request' || eventName === 'push') {
      try {
        files = readChangedFiles({
          eventName,
          before: process.env.MUTATION_BEFORE_SHA,
          prHeadSha: process.env.MUTATION_PR_HEAD_SHA,
        });
      } catch (e) {
        error = e;
      }
    }
    decision = decideMutationRun({ eventName, files, error });
  } catch (e) {
    // Fail closed: a fault in this file must never read as "nothing to test".
    decision = { run: true, reason: `the decision itself failed, so the mutation tests run (${e})` };
  }
  const line = `run=${decision.run === false ? 'false' : 'true'}`;
  const summary = decision.run
    ? `Mutation run needed: ${decision.reason}.`
    : `Mutation run not needed: ${decision.reason}. The steps below are skipped and this check passes without running Stryker. The nightly run and every change to a listed path still run it.`;
  console.log(summary);
  console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
