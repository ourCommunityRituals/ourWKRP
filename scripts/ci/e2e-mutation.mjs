#!/usr/bin/env node
/**
 * Mutation testing at the end-to-end layer.
 *
 * The test pyramid has a mutation run at each layer:
 *   unit          stryker.conf.mjs and stryker.schemas.conf.mjs (src/lib guards,
 *                 judged by the unit, security, fuzz, contract and in-process specs)
 *   integration   stryker.integration.conf.mjs (route handlers, judged by the
 *                 specs that run them on a real D1 and KV from Miniflare)
 *   end to end    this file (rules a person sees, judged by the Playwright
 *                 journeys against a running `wrangler dev`)
 *
 * Stryker plants its faults in code loaded inside the test process. A browser
 * journey talks to a separate Worker, so Stryker cannot judge it. Here the
 * mutants are written by hand in mutation/e2e-mutants.json, each one small
 * fault in a rule the journeys claim to protect. For each mutant this script
 * writes the fault into the source, starts a fresh local Worker on a freshly
 * seeded local D1 (Playwright's webServer, wrangler.e2e.toml), runs the specs
 * named in its `kill` list, and puts the source back.
 *
 * FAIL CLOSED. A mutant is killed only when Playwright ran and at least one
 * test failed on every try. A run where no test ran, or whose report cannot be
 * read, is an error, not a kill: a Worker that did not start would otherwise
 * count as a test with teeth. Before any mutant, the same specs run on the
 * unchanged source and must all pass, or every mutant would read as killed.
 *
 * This is a test rig in the job's own container, not staging: the faults never
 * leave the runner. Staging remains the environment of record for the
 * journeys themselves (CLAUDE.md, section 7).
 *
 * Usage:
 *   node scripts/ci/e2e-mutation.mjs [--catalog mutation/e2e-mutants.json] [--only <id>,<id>]
 *   node scripts/ci/e2e-mutation.mjs --check     (validate the catalog only, no browser)
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CATALOG = 'mutation/e2e-mutants.json';
export const REPORT_DIR = 'reports/mutation-e2e';

/** Occurrences of `needle` in `haystack` (non-overlapping). */
export function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

/**
 * Problems with a catalog, as strings; empty when it is sound.
 * `read(path)` returns a file's text or null when it does not exist.
 */
export function checkCatalog(catalog, read) {
  const problems = [];
  if (!catalog || typeof catalog !== 'object') return ['the catalog is not an object'];
  if (typeof catalog.project !== 'string' || !catalog.project) problems.push('the catalog names no Playwright project');
  const mutants = catalog.mutants;
  if (!Array.isArray(mutants) || mutants.length === 0) return [...problems, 'the catalog lists no mutants'];
  const seen = new Set();
  for (const m of mutants) {
    const id = m?.id;
    const where = `mutant ${JSON.stringify(id)}`;
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) problems.push(`${where}: id must be lowercase words joined by hyphens`);
    if (seen.has(id)) problems.push(`${where}: the id is used twice`);
    seen.add(id);
    for (const key of ['rule', 'file', 'find', 'replace']) {
      if (typeof m?.[key] !== 'string' || (key !== 'replace' && !m[key])) problems.push(`${where}: no ${key}`);
    }
    if (m?.find === m?.replace) problems.push(`${where}: replace is the same as find, so nothing is mutated`);
    if (!Array.isArray(m?.kill) || m.kill.length === 0) problems.push(`${where}: no spec in kill`);
    for (const spec of Array.isArray(m?.kill) ? m.kill : []) {
      if (read(spec) === null) problems.push(`${where}: kill spec ${spec} does not exist`);
    }
    if (typeof m?.file === 'string' && m.file) {
      const text = read(m.file);
      if (text === null) problems.push(`${where}: ${m.file} does not exist`);
      else if (typeof m.find === 'string' && m.find) {
        const n = countOccurrences(text, m.find);
        if (n !== 1) problems.push(`${where}: find occurs ${n} times in ${m.file}, not once (the source moved; update the mutant)`);
      }
    }
  }
  return problems;
}

/** The source with the mutant's fault written in. Throws unless `find` occurs once. */
export function applyMutant(text, mutant) {
  const n = countOccurrences(text, mutant.find);
  if (n !== 1) throw new Error(`mutant ${mutant.id}: find occurs ${n} times in ${mutant.file}, not once`);
  return text.replace(mutant.find, () => mutant.replace);
}

/**
 * What a Playwright JSON report says about one run.
 *   killed    at least one test failed on every try
 *   passed    tests ran and none failed (for a mutant: survived)
 *   error     no test ran, or the report is missing or unreadable
 * Flaky tests (failed, then passed on a retry) do not kill.
 */
export function verdictFromReport(report) {
  const stats = report?.stats;
  if (!stats || typeof stats !== 'object') return { verdict: 'error', reason: 'no stats in the Playwright report' };
  const expected = Number(stats.expected) || 0;
  const unexpected = Number(stats.unexpected) || 0;
  const flaky = Number(stats.flaky) || 0;
  if (Array.isArray(report.errors) && report.errors.length && expected + unexpected + flaky === 0) {
    return { verdict: 'error', reason: `Playwright stopped before any test: ${String(report.errors[0]?.message ?? '').split('\n')[0]}` };
  }
  if (unexpected > 0) return { verdict: 'killed', reason: `${unexpected} test(s) failed` };
  if (expected + flaky === 0) return { verdict: 'error', reason: 'no test ran' };
  return { verdict: 'passed', reason: `${expected + flaky} test(s) passed${flaky ? `, ${flaky} after a retry` : ''}` };
}

/** The gate over every mutant's result: failures as strings, empty when all were killed. */
export function gateFailures(results) {
  return results
    .filter((r) => r.verdict !== 'killed')
    .map((r) =>
      r.verdict === 'passed'
        ? `${r.id} SURVIVED: ${r.rule} The specs ${r.kill.join(', ')} passed with this fault in ${r.file}.`
        : `${r.id} ERROR: ${r.reason}. An error is not a kill.`,
    );
}

function readOrNull(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function sh(cmd, args, env = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  return res.status ?? 1;
}

/** A fresh local D1 and KV, so one run's data and rate-limit windows never reach the next. */
function freshLocalState() {
  rmSync('.wrangler/state', { recursive: true, force: true });
  if (sh('node', ['scripts/seed-local-d1.mjs']) !== 0) throw new Error('seeding the local D1 failed');
}

function runSpecs(specs, project, label) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const out = join(REPORT_DIR, `${label}.playwright.json`);
  rmSync(out, { force: true });
  freshLocalState();
  sh('npx', ['playwright', 'test', ...specs, `--project=${project}`, '--retries=1', '--reporter=json'], {
    CI: process.env.CI || '1',
    PLAYWRIGHT_JSON_OUTPUT_NAME: out,
  });
  let report = null;
  try {
    report = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    report = null;
  }
  return verdictFromReport(report);
}

function summaryTable(results) {
  const rows = results.map((r) => `| ${r.id} | ${r.verdict === 'killed' ? 'killed' : `**${r.verdict === 'passed' ? 'survived' : 'error'}**`} | ${r.rule} | ${r.reason} |`);
  return ['### End-to-end mutation', '', '| Mutant | Result | Rule | Detail |', '| --- | --- | --- | --- |', ...rows, ''].join('\n');
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const catalogPath = arg('--catalog') ?? DEFAULT_CATALOG;
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const problems = checkCatalog(catalog, readOrNull);
  if (problems.length) {
    for (const p of problems) console.error(`::error title=E2E mutant catalog::${p}`);
    return 1;
  }
  if (argv.includes('--check')) {
    console.log(`${catalogPath}: ${catalog.mutants.length} mutants, all sound.`);
    return 0;
  }
  const only = arg('--only')?.split(',');
  const mutants = only ? catalog.mutants.filter((m) => only.includes(m.id)) : catalog.mutants;
  if (!mutants.length) {
    console.error('::error::--only matched no mutant');
    return 1;
  }

  const specs = [...new Set(mutants.flatMap((m) => m.kill))];
  console.log(`\n== Baseline: ${specs.join(', ')} on the unchanged source`);
  const baseline = runSpecs(specs, catalog.project, 'baseline');
  if (baseline.verdict !== 'passed') {
    console.error(`::error title=E2E mutation baseline::the specs must pass on the unchanged source before any mutant is judged (${baseline.verdict}: ${baseline.reason}).`);
    return 1;
  }

  const results = [];
  for (const m of mutants) {
    const original = readFileSync(m.file, 'utf8');
    console.log(`\n== Mutant ${m.id}: ${m.file}`);
    let outcome;
    try {
      writeFileSync(m.file, applyMutant(original, m));
      outcome = runSpecs(m.kill, catalog.project, m.id);
    } finally {
      writeFileSync(m.file, original);
    }
    results.push({ ...m, ...outcome });
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'summary.json'), JSON.stringify({ baseline, results }, null, 2));
  const table = summaryTable(results);
  console.log(`\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);

  const failures = gateFailures(results);
  for (const f of failures) console.error(`::error title=E2E mutation::${f}`);
  const killed = results.length - failures.length;
  console.log(`\n${killed} of ${results.length} end-to-end mutants killed.`);
  return failures.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
