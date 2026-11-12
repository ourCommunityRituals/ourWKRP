// @ts-check
//
// The schemas pass: src/lib/schemas.ts on its own. Everything else, the test
// project included, is the main config's.
//
// Why a pass of its own: schemas.ts is zod schemas built when the module
// loads. Stryker calls a mutant in code like that "static": no single test
// covers it, so each one reruns every test in the project. In the first run,
// 143 of the file's 160 mutants were static and took about two thirds of the
// run, and the single CI job hit its 30-minute limit. As its own pass it runs
// in a parallel CI job. (Running it against only the 4 specs that import
// schemas.ts was tried: it took 39 s but scored 45.6% against 99.2%, because
// most kills come from the router and handler specs.)
//
// The file belongs to this pass only: scripts/ci/mutation-file-floor.mjs fails
// when a file is in both reports.
//
// Run: `npm run test:mutation:schemas`.
import base from './stryker.conf.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: ['src/lib/schemas.ts'],
  htmlReporter: { fileName: 'reports/mutation-schemas/index.html' },
  jsonReporter: { fileName: 'reports/mutation-schemas/mutation.json' },
};
