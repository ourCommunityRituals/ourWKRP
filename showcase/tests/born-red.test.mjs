// Born red, kept red: every showcase check must catch a planted fault. Each case
// copies lib/ into lib/.mutants/<name>, plants one fault, and runs the same
// check the layer tests run on the real code. A check that passes on its mutant
// cannot fail, so it counts as absent, and this test goes red.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import * as C from './checks.mjs';
import { clearMutants, mutantModules, MUTANTS } from './modules.mjs';
import { reportProblems } from './integration/check-reports.mjs';

afterAll(clearMutants);

const R = 'render.mjs';
const S = 'showcase.mjs';
const B = 'build.mjs';
const SC = 'schema.mjs';

const MUTANTS_LIST = [
  // 0. Security
  ['escaping: an unescaped text field', 'escapingProblems', [{ file: R, from: '<p class="lede">${esc(c.lede)}</p>', to: '<p class="lede">${c.lede}</p>' }]],
  ['escaping: an unescaped attribute', 'escapingProblems', [{ file: R, from: 'aria-label="Open the full ${esc(s.name)} report"', to: 'aria-label="Open the full ${s.name} report"' }]],
  ['escaping: script data not guarded', 'escapingProblems', [{ file: R, from: /JSON\.stringify\(stationData\)\.replace\([^)]*\)/, to: 'JSON.stringify(stationData)' }]],
  ['link allowlist: any scheme linked', 'linkProblems', [{ file: R, from: 'const href = safeHttpsUrl(s.url);', to: 'const href = s.url;' }]],
  ['image allowlist: any path kept', 'imagePathProblems', [{ file: S, from: "typeof p === 'string' && /^img\\/[a-z0-9-]+\\.(jpg|png)$/.test(p)", to: "typeof p === 'string'" }]],
  ['secrets: the report link ships', 'secretProblems', [{ file: S, from: 'return {\n    station: r.station,', to: 'return {\n    ...r,\n    station: r.station,' }]],
  ['secrets: link ships and the gate is off', 'secretProblems', [
    { file: S, from: 'return {\n    station: r.station,', to: 'return {\n    ...r,\n    station: r.station,' },
    { file: B, from: 'if (refused.length) throw', to: 'if (false) throw' },
  ]],
  ['publish gate: off', 'publishGateProblems', [{ file: B, from: 'if (refused.length) throw', to: 'if (false) throw' }]],
  ['never who: the email detector is blind', 'publishGateProblems', [{ file: S, from: /\['email address', \/[^\n]*\/\],/, to: "['email address', /(?!)/]," }]],
  ['floor: counts under 5 printed', 'floorProblems', [{ file: S, from: 'n < FLOOR ?', to: 'n < 0 ?' }]],
  ['floor: the floor moved to 4', 'floorProblems', [{ file: S, from: 'export const FLOOR = 5;', to: 'export const FLOOR = 4;' }]],
  ['local only: a staging base accepted', 'localOnlyProblems', [{ file: S, from: /const LOCAL_BASE = [^\n]*;/, to: 'const LOCAL_BASE = /^https?:\\/\\/.+$/;' }]],
  ['CSP: an inline handler', 'cspProblems', [{ file: R, from: '<button type="button" class="ch" role="tab"', to: '<button type="button" class="ch" onclick="void 0" role="tab"' }]],
  // 2. Contract
  ['contract: non-https sources allowed', 'contractProblems', [{ file: SC, from: 'url: https,', to: 'url: text,' }]],
  ['contract: future categories open', 'contractProblems', [{ file: SC, from: "else if (cat.status === 'future')", to: 'else if (false)' }]],
  ['contract: unknown fields allowed', 'contractProblems', [{ file: SC, from: '      .optional(),\n  })\n  .strict();', to: '      .optional(),\n  });' }]],
  // 3. Unit
  ['unit: totals ignore an hour of exactly 5', 'totalProblems', [{ file: S, from: 'filter((n) => n >= FLOOR)', to: 'filter((n) => n > FLOOR)' }]],
  ['unit: hours all get the first count', 'bucketProblems', [{ file: S, from: 'n: shape.counts[i]', to: 'n: shape.counts[0]' }]],
  ['unit: the pacer never waits', 'pacingProblems', [{ file: S, from: 'if (stamps.length >= perMinute) {', to: 'if (false) {' }]],
  ['unit: the catalog overrides the creator', 'mergeProblems', [{ file: S, from: 'freq: s.freq ?? cat.freq,', to: 'freq: cat.freq,' }]],
  ['unit: dates in the wrong order', 'dateProblems', [{ file: S, from: "toLocaleDateString('en-GB'", to: "toLocaleDateString('en-US'" }]],
];

describe('creator showcase: born red', () => {
  it.each(MUTANTS_LIST)('%s is caught by %s', async (name, check, edits) => {
    const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const m = await mutantModules(slug, edits);
    const problems = await C[check](m);
    expect(problems.length, `${check} passed on the mutant "${name}"`).toBeGreaterThan(0);
  });

  it('design system: a colour value in the renderer is caught', async () => {
    await mutantModules('hex', [{ file: R, from: '.dial .needle { stroke: var(--live);', to: '.dial .needle { stroke: #FF4136;' }]);
    expect(C.hexProblems(readFileSync(join(MUTANTS, 'hex', R), 'utf8')).length).toBeGreaterThan(0);
  });

  it('integration verdict: a total that skipped the floor is caught', () => {
    const creator = C.sample();
    const good = C.seededReports();
    good.reports[1].distinctScanners = 19;
    expect(reportProblems(creator, good)).toEqual([]);
    const unfloored = structuredClone(good);
    unfloored.reports[0].distinctScanners = 30;
    expect(reportProblems(creator, unfloored).join('\n')).toMatch(/teach: report total 30, expected 27/);
    const lost = structuredClone(good);
    lost.reports[1].scansSent = 18;
    expect(reportProblems(creator, lost).join('\n')).toMatch(/wear: 18 of 21 scans counted/);
    const named = structuredClone(good);
    named.reports[0].pageText = 'Checked in: planted.person@example.com';
    expect(reportProblems(creator, named).join('\n')).toMatch(/email address/);
  });

  it('lint: an undefined name in a showcase script is an error', async () => {
    const eslint = new ESLint({ cwd: join(C.SHOWCASE, '..') });
    const [clean] = await eslint.lintText("import { esc } from './showcase.mjs';\nconsole.log(esc('a'));\n", { filePath: join(C.SHOWCASE, 'lib', 'planted.mjs') });
    expect(clean.errorCount, JSON.stringify(clean.messages)).toBe(0);
    const [planted] = await eslint.lintText('console.log(notDefinedAnywhere);\n', { filePath: join(C.SHOWCASE, 'lib', 'planted.mjs') });
    expect(planted.errorCount).toBeGreaterThan(0);
  });
});
