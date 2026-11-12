#!/usr/bin/env node
/**
 * Per-file mutation floor, and the ratchet that keeps floors from going down.
 * Ported from OSE (ourSharedEvents scripts/ci/mutation-file-floor.mjs,
 * OSE-1801), with one addition: the floors live in mutation-floors.json and a
 * pull request's copy is compared with its base branch's, so a pull request can
 * raise a floor or add one but never lower or drop one.
 *
 * Why per file: Stryker's own `break` threshold is global. One file at 100%
 * can carry another well below the bar (in OSE a 99% total once hid four
 * survivors in the admin guard). This reads Stryker's JSON report and fails when
 * any floored file scores below its floor, or when a floored file is missing
 * from the report or has no valid mutant (a floor on a file that was not
 * mutated is a gate that cannot fail).
 *
 * Score = detected / valid, the way Stryker computes it:
 *   detected = Killed + Timeout
 *   valid    = detected + Survived + NoCoverage
 * Ignored, CompileError and RuntimeError mutants are not valid and do not count.
 *
 * Usage:
 *   node scripts/ci/mutation-file-floor.mjs <mutation.json> [--floors mutation-floors.json]
 *   node scripts/ci/mutation-file-floor.mjs --ratchet <base mutation-floors.json> [--floors mutation-floors.json]
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FLOORS_FILE = 'mutation-floors.json';

/** The `floors` map of a mutation-floors.json document, checked for shape. */
export function readFloors(doc) {
  const floors = doc?.floors;
  if (!floors || typeof floors !== 'object' || Array.isArray(floors)) {
    throw new Error(`${FLOORS_FILE} has no "floors" object`);
  }
  for (const [path, floor] of Object.entries(floors)) {
    if (typeof floor !== 'number' || !Number.isFinite(floor) || floor < 0 || floor > 100) {
      throw new Error(`${FLOORS_FILE}: the floor of ${path} is not a number from 0 to 100`);
    }
  }
  if (!Object.keys(floors).length) throw new Error(`${FLOORS_FILE} lists no files`);
  return floors;
}

/** One file's score from its mutants, or null when it has no valid mutant. */
export function fileScore(mutants) {
  let detected = 0;
  let valid = 0;
  for (const m of mutants) {
    if (m.status === 'Killed' || m.status === 'Timeout') {
      detected += 1;
      valid += 1;
    } else if (m.status === 'Survived' || m.status === 'NoCoverage') {
      valid += 1;
    }
  }
  return valid === 0 ? null : (detected / valid) * 100;
}

/** Failures for a report against floors: missing files, empty files, files under the floor. */
export function checkFloors(report, floors) {
  const files = report?.files ?? {};
  const byPath = new Map(Object.entries(files).map(([p, f]) => [p.replace(/\\/g, '/'), f]));
  const failures = [];
  for (const [path, floor] of Object.entries(floors)) {
    const file = byPath.get(path);
    if (!file) {
      failures.push(`${path}: not in the mutation report (was it mutated?)`);
      continue;
    }
    const score = fileScore(file.mutants ?? []);
    if (score === null) {
      failures.push(`${path}: no valid mutants`);
      continue;
    }
    if (score < floor) {
      const survivors = (file.mutants ?? [])
        .filter((m) => m.status === 'Survived' || m.status === 'NoCoverage')
        .map((m) => `  line ${m.location?.start?.line ?? '?'}: ${m.mutatorName} (${m.status})`);
      failures.push(
        `${path}: ${score.toFixed(2)}% is below its floor of ${floor}%\n${survivors.join('\n')}`,
      );
    }
  }
  return failures;
}

/**
 * Failures when `floors` is easier than `baseFloors`: a floor lowered, or a
 * floored file dropped. Raising a floor or adding a file is always allowed.
 * Dropping a file because its source was deleted is a rename or removal the
 * owner approves by hand: the check cannot tell it from a quiet removal.
 */
export function checkRatchet(floors, baseFloors) {
  const failures = [];
  for (const [path, baseFloor] of Object.entries(baseFloors)) {
    if (!(path in floors)) {
      failures.push(`${path}: its floor of ${baseFloor}% was removed (floors may only go up)`);
    } else if (floors[path] < baseFloor) {
      failures.push(`${path}: floor lowered from ${baseFloor}% to ${floors[path]}% (floors may only go up)`);
    }
  }
  return failures;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main(argv) {
  const args = [...argv];
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const [, value] = args.splice(i, 2);
    if (!value) throw new Error(`${flag} needs a path`);
    return value;
  };
  const floorsPath = take('--floors') ?? FLOORS_FILE;
  const ratchetBase = take('--ratchet');
  const floors = readFloors(readJson(floorsPath));

  if (ratchetBase) {
    const failures = checkRatchet(floors, readFloors(readJson(ratchetBase)));
    if (failures.length) {
      console.error('Mutation floor ratchet failed:\n' + failures.join('\n'));
      return 1;
    }
    console.log(`Mutation floor ratchet: ${Object.keys(floors).length} floors, none lowered or dropped.`);
    return 0;
  }

  const [reportPath] = args;
  if (!reportPath || args.length !== 1) {
    console.error('usage: mutation-file-floor.mjs <mutation.json> [--floors <file>] | --ratchet <base floors file>');
    return 2;
  }
  const failures = checkFloors(readJson(reportPath), floors);
  if (failures.length) {
    console.error('Per-file mutation floor failed:\n' + failures.join('\n'));
    return 1;
  }
  console.log(`Per-file mutation floor: ${Object.keys(floors).length} files at or above their floor.`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`mutation-file-floor: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
