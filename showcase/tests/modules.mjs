// Load the lib modules as one bundle, either the real ones or a mutated copy.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SHOWCASE } from './checks.mjs';

const LIB = join(SHOWCASE, 'lib');
export const MUTANTS = join(LIB, '.mutants');
const NAMES = ['showcase', 'render', 'build', 'schema'];

async function load(dir, bust = '') {
  const out = {};
  for (const n of NAMES) out[n] = await import(`${pathToFileURL(join(dir, `${n}.mjs`)).href}${bust}`);
  return out;
}

export const realModules = () => load(LIB);

/**
 * A copy of lib/ with planted faults. Each edit must apply, or the mutant is
 * not the fault it claims to be and the born-red test errors.
 * @param {string} name
 * @param {{file: string, from: string|RegExp, to: string}[]} edits
 */
export async function mutantModules(name, edits) {
  const dir = join(MUTANTS, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(LIB).filter((f) => f.endsWith('.mjs'))) cpSync(join(LIB, f), join(dir, f));
  for (const { file, from, to } of edits) {
    const p = join(dir, file);
    const src = readFileSync(p, 'utf8');
    const next = src.replace(from, to);
    if (next === src) throw new Error(`mutant ${name}: edit to ${file} did not apply (${String(from)})`);
    writeFileSync(p, next);
  }
  // build.mjs reads categories.json and theme.css from SHOWCASE; mutants live
  // two levels down, so give them the same anchor.
  const b = join(dir, 'build.mjs');
  writeFileSync(b, readFileSync(b, 'utf8').replace("join(dirname(fileURLToPath(import.meta.url)), '..')", JSON.stringify(SHOWCASE)));
  return load(dir, `?mutant=${name}`);
}

export const clearMutants = () => rmSync(MUTANTS, { recursive: true, force: true });
