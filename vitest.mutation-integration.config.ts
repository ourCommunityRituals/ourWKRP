import { MUTATION_EXCLUDED_SPECS, mutationProject } from './vitest.mutation.config';

// The integration layer's mutation project (stryker.integration.conf.mjs).
//
// The main project (vitest.mutation.config.ts) leaves out the specs that start
// a local Miniflare, because under Stryker's parallel reruns their D1 setup
// failed now and then and a mutant whose run errors is scored as neither
// killed nor survived. Those specs are the integration layer: real D1 and KV,
// the real migrations, the real router. This project is exactly them, less
// the three that test scripts rather than src/, and the integration pass runs
// them one mutant at a time (concurrency 1), which is what makes the D1 setup
// steady.
export const INTEGRATION_NOT_SRC = [
  'tests/integration/install-playwright-browsers.test.ts',
  'tests/integration/seed-local-d1.test.ts',
  'tests/integration/smoke-report.test.ts',
];

export const INTEGRATION_SPECS = MUTATION_EXCLUDED_SPECS.filter((s) => !INTEGRATION_NOT_SRC.includes(s));

const project = mutationProject(INTEGRATION_SPECS);
export default { ...project, test: { ...project.test, exclude: [] } };
