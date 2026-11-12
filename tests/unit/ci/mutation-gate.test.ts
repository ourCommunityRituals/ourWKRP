/**
 * The mutation gate's own tests: the per-file floor and its ratchet
 * (scripts/ci/mutation-file-floor.mjs), the scope decision
 * (scripts/ci/mutation-scope.mjs), the sandbox read redirect
 * (tests/support/stryker-sandbox.ts) and the workflow's wiring.
 *
 * Born red: each check is fed a fault it must catch (a mutant that survived, a
 * file missing from the report, a floor lowered or dropped, a changed file on
 * the list, a list that could not be read, a spec missing from the list, a
 * workflow with a paths filter or a job-level `if:`) next to the case it must
 * pass. Both halves run on every pull request.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { checkFloors, checkRatchet, fileScore, readFloors } from '../../../scripts/ci/mutation-file-floor.mjs';
import {
  MUTATION_PATHS,
  decideMutationRun,
  readChangedFiles,
  relativeImports,
  uncoveredMutationInputs,
} from '../../../scripts/ci/mutation-scope.mjs';
import strykerConfig from '../../../stryker.conf.mjs';
import { MUTATION_TEST_DIRS } from '../../../vitest.mutation.config';
import { originalSourcePath } from '../../support/stryker-sandbox';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const floorsDoc = JSON.parse(read('mutation-floors.json'));

const m = (status: string, line = 1) => ({ status, mutatorName: 'X', location: { start: { line } } });
const report = (files: Record<string, unknown[]>) => ({
  files: Object.fromEntries(Object.entries(files).map(([p, mutants]) => [p, { mutants }])),
});

describe('fileScore', () => {
  it('counts Killed and Timeout as detected, Survived and NoCoverage as missed', () => {
    expect(fileScore([m('Killed'), m('Timeout'), m('Survived'), m('NoCoverage')])).toBe(50);
  });
  it('leaves Ignored, CompileError and RuntimeError out', () => {
    expect(fileScore([m('Killed'), m('Ignored'), m('CompileError'), m('RuntimeError')])).toBe(100);
  });
  it('is null when no mutant is valid', () => {
    expect(fileScore([m('Ignored')])).toBeNull();
    expect(fileScore([])).toBeNull();
  });
});

describe('checkFloors', () => {
  const floors = { 'src/lib/a.ts': 100, 'src/lib/b.ts': 50 };

  it('passes files at or above their floor', () => {
    const r = report({ 'src/lib/a.ts': [m('Killed')], 'src/lib/b.ts': [m('Killed'), m('Survived')] });
    expect(checkFloors(r, floors)).toEqual([]);
  });

  it('BORN RED: a surviving mutant under the floor fails and names its line', () => {
    const r = report({ 'src/lib/a.ts': [m('Killed'), m('Survived', 42)], 'src/lib/b.ts': [m('Killed')] });
    const failures = checkFloors(r, floors);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('src/lib/a.ts: 50.00% is below its floor of 100%');
    expect(failures[0]).toContain('line 42');
  });

  it('BORN RED: a NoCoverage mutant counts as missed', () => {
    const r = report({ 'src/lib/a.ts': [m('Killed'), m('NoCoverage')], 'src/lib/b.ts': [m('Killed')] });
    expect(checkFloors(r, floors)).toHaveLength(1);
  });

  it('BORN RED: a floored file missing from the report fails', () => {
    const r = report({ 'src/lib/a.ts': [m('Killed')] });
    expect(checkFloors(r, floors)).toEqual(['src/lib/b.ts: not in the mutation report (was it mutated?)']);
  });

  it('BORN RED: a floored file with no valid mutant fails', () => {
    const r = report({ 'src/lib/a.ts': [m('Killed')], 'src/lib/b.ts': [m('Ignored')] });
    expect(checkFloors(r, floors)).toEqual(['src/lib/b.ts: no valid mutants']);
  });

  it('reads Windows paths in the report', () => {
    const r = { files: { 'src\\lib\\a.ts': { mutants: [m('Killed')] }, 'src\\lib\\b.ts': { mutants: [m('Killed')] } } };
    expect(checkFloors(r, floors)).toEqual([]);
  });
});

describe('checkRatchet (floors only go up)', () => {
  const base = { 'src/lib/a.ts': 90, 'src/lib/b.ts': 100 };

  it('passes the same floors, a raised floor and an added file', () => {
    expect(checkRatchet(base, base)).toEqual([]);
    expect(checkRatchet({ ...base, 'src/lib/a.ts': 95, 'src/lib/c.ts': 80 }, base)).toEqual([]);
  });

  it('BORN RED: a lowered floor fails', () => {
    expect(checkRatchet({ ...base, 'src/lib/a.ts': 89.9 }, base)).toEqual([
      'src/lib/a.ts: floor lowered from 90% to 89.9% (floors may only go up)',
    ]);
  });

  it('BORN RED: a dropped floor fails', () => {
    expect(checkRatchet({ 'src/lib/a.ts': 90 }, base)).toEqual([
      'src/lib/b.ts: its floor of 100% was removed (floors may only go up)',
    ]);
  });
});

describe('readFloors', () => {
  it('reads the committed file', () => {
    expect(Object.keys(readFloors(floorsDoc)).length).toBeGreaterThan(0);
  });
  it.each([
    [{}, 'no "floors" object'],
    [{ floors: [] }, 'no "floors" object'],
    [{ floors: {} }, 'lists no files'],
    [{ floors: { 'src/lib/a.ts': '90' } }, 'not a number from 0 to 100'],
    [{ floors: { 'src/lib/a.ts': 101 } }, 'not a number from 0 to 100'],
    [{ floors: { 'src/lib/a.ts': -1 } }, 'not a number from 0 to 100'],
  ])('BORN RED: refuses %j', (doc, message) => {
    expect(() => readFloors(doc)).toThrow(message);
  });
});

describe('the committed floors and the Stryker config agree', () => {
  it('every mutated file has a floor and every floor is a mutated file', () => {
    expect(Object.keys(readFloors(floorsDoc)).sort()).toEqual([...strykerConfig.mutate].sort());
  });
  it('the Stryker run uses the mutation project and writes the JSON report the floor reads', () => {
    expect(strykerConfig.vitest.configFile).toBe('vitest.mutation.config.ts');
    expect(strykerConfig.coverageAnalysis).toBe('perTest');
    expect(strykerConfig.jsonReporter.fileName).toBe('reports/mutation/mutation.json');
    expect(JSON.parse(read('package.json')).scripts['test:mutation:floor']).toContain('reports/mutation/mutation.json');
  });
});

describe('decideMutationRun (fail closed)', () => {
  it('skips only when the changed files were read and none is listed', () => {
    expect(decideMutationRun({ eventName: 'pull_request', files: ['README.md'] }).run).toBe(false);
    expect(decideMutationRun({ eventName: 'push', files: ['docs/x.md', 'src/router.ts'] }).run).toBe(false);
  });
  it('BORN RED: a listed file runs it, Windows slashes too', () => {
    expect(decideMutationRun({ eventName: 'pull_request', files: ['README.md', 'src/lib/cors.ts'] }).run).toBe(true);
    expect(decideMutationRun({ eventName: 'push', files: ['src\\lib\\cors.ts'] }).run).toBe(true);
  });
  it('BORN RED: a read error, an empty list, no list and other events run it', () => {
    expect(decideMutationRun({ eventName: 'pull_request', error: new Error('git failed') }).run).toBe(true);
    expect(decideMutationRun({ eventName: 'pull_request', files: [] }).run).toBe(true);
    expect(decideMutationRun({ eventName: 'push' }).run).toBe(true);
    expect(decideMutationRun({ eventName: 'schedule', files: ['README.md'] }).run).toBe(true);
    expect(decideMutationRun({ eventName: 'workflow_dispatch' }).run).toBe(true);
    expect(decideMutationRun().run).toBe(true);
  });
});

describe('readChangedFiles', () => {
  const head = 'a'.repeat(40);
  const base = 'b'.repeat(40);
  const fakeGit = (parents: string) => (args: string[]) =>
    args[0] === 'rev-list' ? `${head} ${parents}\n` : 'src/lib/cors.ts\0README.md\0';

  it('reads a pull request as the merge commit against its first parent', () => {
    const calls: string[][] = [];
    const git = (args: string[]) => (calls.push(args), fakeGit(`${base} ${head}`)(args));
    expect(readChangedFiles({ eventName: 'pull_request', prHeadSha: head }, git)).toEqual(['src/lib/cors.ts', 'README.md']);
    expect(calls[1]).toEqual(['diff', '--no-renames', '--name-only', '-z', 'HEAD^1', 'HEAD']);
  });
  it('BORN RED: refuses a checkout that is not the merge of this pull request', () => {
    expect(() => readChangedFiles({ eventName: 'pull_request', prHeadSha: head }, fakeGit(base))).toThrow('not a merge commit');
    expect(() => readChangedFiles({ eventName: 'pull_request', prHeadSha: head }, fakeGit(`${base} ${base}`))).toThrow('does not merge');
    expect(() => readChangedFiles({ eventName: 'pull_request', prHeadSha: 'nope' }, fakeGit(base))).toThrow('head sha is missing');
  });
  it('BORN RED: refuses a push with no usable before sha', () => {
    expect(() => readChangedFiles({ eventName: 'push', before: '0'.repeat(40) }, fakeGit(''))).toThrow('no usable before sha');
    expect(() => readChangedFiles({ eventName: 'push' }, fakeGit(''))).toThrow('no usable before sha');
  });
  it('reads a push against its before sha', () => {
    expect(readChangedFiles({ eventName: 'push', before: base }, fakeGit(''))).toEqual(['src/lib/cors.ts', 'README.md']);
  });
});

describe('relativeImports', () => {
  it('reads static, dynamic and side-effect imports, with or without an extension', () => {
    const src = [
      "import { a } from '../../src/lib/cors';",
      "import x from '../../src/lib/ids.js';",
      "const y = await import('../../src/lib/html.ts');",
      "import '../support/thing';",
      "import { it } from 'vitest';",
    ].join('\n');
    expect(relativeImports('tests/unit/x.test.ts', src).sort()).toEqual(
      ['src/lib/cors.ts', 'src/lib/html.ts', 'src/lib/ids.ts', 'tests/support/thing.ts'].sort(),
    );
  });
});

function mutationProjectSpecs() {
  const walk = (d: string): string[] =>
    readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
    );
  return MUTATION_TEST_DIRS.flatMap(walk)
    .filter((f) => /\.test\.ts$|\.invariant\.spec\.ts$/.test(f))
    .map((p) => ({ path: p, source: read(p) }));
}

describe('the mutation path list covers the gate', () => {
  const specs = mutationProjectSpecs();
  const floors = readFloors(floorsDoc);

  it('reads a real mutation project (a green run is not an empty run)', () => {
    expect(specs.length).toBeGreaterThan(50);
    expect(strykerConfig.mutate.length).toBeGreaterThan(10);
  });

  it('every mutated file, floored file and spec importing a mutated file is listed', () => {
    expect(uncoveredMutationInputs({ strykerConfig, floors, specs })).toEqual([]);
  });

  it('every listed file exists', () => {
    const missing = (MUTATION_PATHS as string[]).filter((p) => {
      try {
        read(p);
        return false;
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });

  // A file can exist on disk and still not be committed: on a Windows
  // checkout the .gitignore secret pattern `*PAT*` matched this rule's first
  // name, mutation-paths.mjs, and `git add -A` skipped it.
  it('every listed file is tracked by git, so it is in every checkout', () => {
    const tracked = new Set(
      execFileSync('git', ['ls-files', '-z', '--', ...(MUTATION_PATHS as string[])], { cwd: ROOT, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean),
    );
    expect((MUTATION_PATHS as string[]).filter((p) => !tracked.has(p))).toEqual([]);
  });

  it('BORN RED: a mutated source left off the list is found', () => {
    const paths = (MUTATION_PATHS as string[]).filter((p) => p !== 'src/lib/cors.ts');
    expect(uncoveredMutationInputs({ strykerConfig, floors, specs }, paths).join('\n')).toContain(
      'src/lib/cors.ts (a mutate target in stryker.conf.mjs)',
    );
  });

  it('BORN RED: a spec importing a mutated source left off the list is found', () => {
    const paths = (MUTATION_PATHS as string[]).filter((p) => p !== 'tests/unit/session.test.ts');
    expect(uncoveredMutationInputs({ strykerConfig, floors, specs }, paths).join('\n')).toContain(
      'tests/unit/session.test.ts (a spec that imports src/lib/session.ts)',
    );
  });

  it('BORN RED: an unreadable config, a glob target and a floor off the list are found', () => {
    expect(uncoveredMutationInputs({ strykerConfig: {}, floors: {}, specs: [] }).join('\n')).toContain('no mutate targets');
    expect(
      uncoveredMutationInputs({ strykerConfig: { ...strykerConfig, mutate: ['src/**/*.ts'] }, floors: {}, specs: [] }).join('\n'),
    ).toContain('mutates the pattern');
    expect(uncoveredMutationInputs({ strykerConfig, floors: { 'src/lib/nope.ts': 90 }, specs: [] }).join('\n')).toContain(
      'src/lib/nope.ts (a floor in mutation-floors.json)',
    );
  });
});

describe('originalSourcePath (structural specs read src/ as committed)', () => {
  const root = path.resolve('/repo');
  const sandbox = path.join(root, '.stryker-tmp', 'sandbox-AbC123');

  it('maps a file under the sandbox src/ to the original, relative or absolute', () => {
    expect(originalSourcePath(path.join(sandbox, 'src', 'lib', 'cors.ts'), sandbox)).toBe(path.join(root, 'src', 'lib', 'cors.ts'));
    expect(originalSourcePath('src/lib/cors.ts', sandbox)).toBe(path.join(root, 'src', 'lib', 'cors.ts'));
  });
  it('BORN RED: leaves everything else alone', () => {
    expect(originalSourcePath(path.join(sandbox, 'tests', 'x.ts'), sandbox)).toBeNull();
    expect(originalSourcePath(path.join(sandbox, 'srcx', 'y.ts'), sandbox)).toBeNull();
    expect(originalSourcePath(path.join(root, 'src', 'lib', 'cors.ts'), root)).toBeNull();
  });
});

describe('the workflow wiring', () => {
  type Step = { name?: string; id?: string; run?: string; if?: string; uses?: string };
  const wf = yaml.load(read('.github/workflows/mutation-testing.yml')) as {
    on: Record<string, unknown>;
    jobs: Record<string, { if?: string; needs?: unknown; steps: Step[]; 'timeout-minutes'?: number }>;
  };
  const job = wf.jobs.mutation;
  const steps = job.steps;
  const at = (pred: (s: Step) => boolean) => steps.findIndex(pred);

  it('starts on every pull request and push to main, nightly and on dispatch', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['pull_request', 'push', 'schedule', 'workflow_dispatch']);
    expect(wf.on.pull_request ?? {}).not.toHaveProperty('paths');
    expect(wf.on.push).not.toHaveProperty('paths');
  });

  it('the job always reports: no job-level if and no needs', () => {
    expect(job.if).toBeUndefined();
    expect(job.needs).toBeUndefined();
    expect(job['timeout-minutes']).toBeGreaterThan(0);
  });

  it('decides scope first, ratchets on pull requests, then Stryker, then the floor', () => {
    const scope = at((s) => s.id === 'scope');
    const ratchet = at((s) => !!s.run?.includes('mutation-file-floor.mjs --ratchet'));
    const stryker = at((s) => s.run === 'npm run test:mutation');
    const floor = at((s) => s.run === 'npm run test:mutation:floor');
    expect(steps[scope].run).toBe('node scripts/ci/mutation-scope.mjs');
    expect(scope).toBeLessThan(ratchet);
    expect(steps[ratchet].if).toBe("github.event_name == 'pull_request'");
    expect(ratchet).toBeLessThan(stryker);
    expect(stryker).toBeLessThan(floor);
  });

  it('every step after the scope step skips only on run=false (fail closed)', () => {
    const scope = at((s) => s.id === 'scope');
    for (const s of steps.slice(scope + 1)) {
      if (s.run?.includes('--ratchet')) continue;
      expect(s.if, s.name ?? s.run ?? s.uses).toContain("steps.scope.outputs.run != 'false'");
      expect(s.if).not.toContain("== 'true'");
    }
  });
});
