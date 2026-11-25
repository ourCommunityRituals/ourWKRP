/**
 * The end-to-end mutation runner (scripts/ci/e2e-mutation.mjs) and its
 * catalog (mutation/e2e-mutants.json). The runner's browser half runs in the
 * nightly mutation workflow; what decides a verdict is pure and checked here,
 * each rule watched failing first.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import {
  applyMutant,
  checkCatalog,
  countOccurrences,
  DEFAULT_CATALOG,
  gateFailures,
  verdictFromReport,
} from '../../../scripts/ci/e2e-mutation.mjs';

const readOrNull = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const catalog = JSON.parse(readFileSync(DEFAULT_CATALOG, 'utf8'));

const files: Record<string, string> = {
  'src/a.ts': 'if (n < floor) return null;\nreturn n;\n',
  'tests/e2e/a.spec.ts': 'test()',
};
const fakeRead = (p: string) => files[p] ?? null;
const good = {
  project: 'Mobile Chrome',
  mutants: [{ id: 'floor-off', rule: 'r', file: 'src/a.ts', find: 'if (n < floor)', replace: 'if (false)', kill: ['tests/e2e/a.spec.ts'] }],
};
const withMutant = (patch: Record<string, unknown>) => ({ ...good, mutants: [{ ...good.mutants[0], ...patch }] });

describe('the committed catalog', () => {
  it('is sound: every find occurs once in its file, every kill spec exists', () => {
    expect(checkCatalog(catalog, readOrNull)).toEqual([]);
  });

  it('kills only with end-to-end specs, never a unit or integration spec', () => {
    for (const m of catalog.mutants) for (const spec of m.kill) expect(spec).toMatch(/^tests\/(e2e|playwright)\/.+\.spec\.ts$/);
  });

  it('names a project the Playwright config defines', () => {
    expect(readFileSync('playwright.config.ts', 'utf8')).toContain(`name: '${catalog.project}'`);
  });
});

describe('checkCatalog', () => {
  it('passes a sound catalog', () => {
    expect(checkCatalog(good, fakeRead)).toEqual([]);
  });

  it('BORN RED: a find that is not in the file (the source moved) fails', () => {
    expect(checkCatalog(withMutant({ find: 'if (n <= floor)' }), fakeRead).join()).toMatch(/occurs 0 times/);
  });

  it('BORN RED: a find that occurs twice fails, so a mutant cannot hit the wrong line', () => {
    expect(checkCatalog(withMutant({ find: 'n' }), fakeRead).join()).toMatch(/occurs \d+ times/);
  });

  it('BORN RED: a missing kill spec, a missing file, no kill list and a no-op mutant fail', () => {
    expect(checkCatalog(withMutant({ kill: ['tests/e2e/gone.spec.ts'] }), fakeRead).join()).toMatch(/does not exist/);
    expect(checkCatalog(withMutant({ file: 'src/gone.ts' }), fakeRead).join()).toMatch(/does not exist/);
    expect(checkCatalog(withMutant({ kill: [] }), fakeRead).join()).toMatch(/no spec in kill/);
    expect(checkCatalog(withMutant({ replace: 'if (n < floor)' }), fakeRead).join()).toMatch(/nothing is mutated/);
  });

  it('BORN RED: a duplicate id, an empty list and no project fail', () => {
    expect(checkCatalog({ ...good, mutants: [good.mutants[0], good.mutants[0]] }, fakeRead).join()).toMatch(/used twice/);
    expect(checkCatalog({ ...good, mutants: [] }, fakeRead).join()).toMatch(/no mutants/);
    expect(checkCatalog({ mutants: good.mutants }, fakeRead).join()).toMatch(/no Playwright project/);
  });
});

describe('applyMutant', () => {
  it('writes the fault in once and leaves the rest of the file', () => {
    expect(applyMutant(files['src/a.ts'], good.mutants[0])).toBe('if (false) return null;\nreturn n;\n');
  });

  it('takes the replacement literally ($ patterns are not expanded)', () => {
    expect(applyMutant('a = 1;', { id: 'x', file: 'f', find: '1', replace: "$&$'" })).toBe("a = $&$';");
  });

  it('BORN RED: refuses a find that does not occur exactly once', () => {
    expect(() => applyMutant('x x', { id: 'x', file: 'f', find: 'x', replace: 'y' })).toThrow(/2 times/);
    expect(countOccurrences('', 'x')).toBe(0);
  });
});

describe('verdictFromReport (fail closed)', () => {
  it('a test that failed on every try kills', () => {
    expect(verdictFromReport({ stats: { expected: 3, unexpected: 1, flaky: 0 } }).verdict).toBe('killed');
  });

  it('tests that all passed read as passed (a surviving mutant)', () => {
    expect(verdictFromReport({ stats: { expected: 4, unexpected: 0, flaky: 0 } }).verdict).toBe('passed');
  });

  it('BORN RED: a flaky test (failed, then passed on retry) does not kill', () => {
    expect(verdictFromReport({ stats: { expected: 3, unexpected: 0, flaky: 1 } }).verdict).toBe('passed');
  });

  it('BORN RED: no test ran, a missing report, and a Worker that never started are errors, not kills', () => {
    expect(verdictFromReport({ stats: { expected: 0, unexpected: 0, flaky: 0 } }).verdict).toBe('error');
    expect(verdictFromReport(null).verdict).toBe('error');
    expect(
      verdictFromReport({ stats: { expected: 0, unexpected: 0, flaky: 0 }, errors: [{ message: 'Timed out waiting 30000ms from config.webServer.' }] }),
    ).toMatchObject({ verdict: 'error', reason: expect.stringContaining('webServer') });
  });
});

describe('gateFailures', () => {
  const base = { rule: 'r', file: 'src/a.ts', kill: ['tests/e2e/a.spec.ts'], reason: 'x' };
  it('passes when every mutant was killed', () => {
    expect(gateFailures([{ id: 'a', verdict: 'killed', ...base }])).toEqual([]);
  });
  it('BORN RED: a survivor and an error each fail, and say which', () => {
    const f = gateFailures([
      { id: 'a', verdict: 'passed', ...base },
      { id: 'b', verdict: 'error', ...base },
    ]);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatch(/^a SURVIVED/);
    expect(f[1]).toMatch(/^b ERROR/);
  });
});

describe('the workflow runs every layer', () => {
  const wf = yaml.load(readFileSync('.github/workflows/mutation-testing.yml', 'utf8')) as {
    jobs: Record<string, { steps?: { run?: string }[] }>;
  };
  const runs = Object.values(wf.jobs).flatMap((j) => (j.steps ?? []).map((s) => s.run ?? ''));
  it('runs the integration pass and checks its floors', () => {
    expect(runs.some((r) => r.includes('npm run test:mutation:integration'))).toBe(true);
    expect(runs.some((r) => r.includes('--floors mutation-floors.integration.json'))).toBe(true);
  });
  it('runs the end-to-end pass', () => {
    expect(runs.some((r) => r.includes('npm run test:mutation:e2e'))).toBe(true);
  });
});
