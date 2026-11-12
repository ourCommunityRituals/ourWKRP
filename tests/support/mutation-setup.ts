// Setup file of the mutation project only (vitest.mutation.config.ts). It is
// never loaded by the PR suites.
//
// 1. A fixed fast-check seed. By default fast-check picks a random seed per
//    run, which makes a property's kill a matter of luck: the same mutant can
//    be killed on one run and survive the next, and the per-file floor would
//    flicker. A fixed seed gives every run the same inputs. The PR suite
//    (`npm run test:fuzz`) keeps random seeds, which is where new
//    counterexamples are found.
//
// 2. Structural specs read src/ as committed. Many security specs read a
//    source file as text and assert on it (for example that the cross-product
//    gate still says `if (!expected) return false`). Stryker runs the suite in
//    a sandbox copy (.stryker-tmp/sandbox-*) whose src/ files it has rewritten
//    to hold every mutant, so those text assertions fail there and the initial
//    run stops. Such a spec executes no source code, so with `perTest`
//    coverage Stryker never reruns it for a mutant: it only has to pass the
//    initial run, and it should judge the source that is committed. Inside a
//    sandbox, a read of a file under the sandbox's src/ returns the original
//    file next to .stryker-tmp. Module loading is not affected: Vite reads the
//    modules under test in the main process, so behavioural specs still run
//    the mutated code. Outside a sandbox this part does nothing.
import fc from 'fast-check';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { SANDBOX, originalSourcePath } from './stryker-sandbox';

fc.configureGlobal({ seed: 20261112 });

if (SANDBOX.test(process.cwd())) {
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function (file: fs.PathOrFileDescriptor, ...rest: unknown[]) {
    const original = typeof file === 'string' ? originalSourcePath(file, process.cwd()) : null;
    return (readFileSync as (...a: unknown[]) => unknown)(original ?? file, ...rest);
  } as typeof fs.readFileSync;
  syncBuiltinESMExports();
}
