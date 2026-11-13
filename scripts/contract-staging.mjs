#!/usr/bin/env node
/**
 * OW-203 — run the stateless Core Flows requests against a DEPLOYED Worker.
 *
 * `npm run test:bruno` runs the same collection against `wrangler dev`. That
 * proves the collection agrees with the local build; it proves nothing about
 * the deployed routes, because the boundary is mocked. A contract break between
 * the two would stay green all the way to a demo.
 *
 * This runs the subset that is safe against a shared, deployed environment:
 * stateless, auth-free, read-only. Those four requests carry their own
 * assertions already (status codes, body shape, content type), so this adds a
 * target rather than a new set of claims.
 *
 * Deliberately NOT the whole collection. The other eight Core Flows requests
 * chain a write journey — register a contributor, import a CSV, create a
 * playlist, add tracks — and need a session plus WKRP_ADMIN_TOKEN. Pointing
 * those at staging on every push would accumulate rows in a shared database and
 * requires a secret only the owner can set. That is OW-204, and it needs a
 * design decision about cleanup and an ephemeral brand, not a flag.
 *
 * Usage:  node scripts/contract-staging.mjs [baseUrl]
 *         default https://stg.ourwkrp.com
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const COLLECTION = join('bruno', 'wkrp-api');
const FOLDER = '1. Core Flows';

/**
 * The stateless, auth-free requests. Each must stay free of {{contributor_id}},
 * {{playlist_id}}, {{session_cookie}} and {{track_id}} — a request that grows a
 * state dependency belongs in OW-204, not here. The invariant spec checks this.
 */
const REQUESTS = [
  '01 Health check.yml',
  '02 Anonymous catalog browse.yml',
  '10 Catalog stats.yml',
  '11 Catalog page (HTML).yml',
];

const baseUrl = process.argv[2] ?? 'https://stg.ourwkrp.com';

if (!existsSync(COLLECTION)) {
  console.error(`contract:staging — collection not found at ${COLLECTION}`);
  process.exit(1);
}

let failed = 0;

for (const request of REQUESTS) {
  const path = join(FOLDER, request);
  if (!existsSync(join(COLLECTION, path))) {
    console.error(`contract:staging — missing request: ${path}`);
    failed++;
    continue;
  }

  console.log(`\n--- ${request} -> ${baseUrl}`);
  const run = spawnSync(
    'npx',
    ['bru', 'run', path, '--env', 'wkrp-staging', '--env-var', `baseUrl=${baseUrl}`],
    { cwd: COLLECTION, stdio: 'inherit', shell: process.platform === 'win32' },
  );

  // A non-zero exit is a failed assertion OR a request that never landed.
  // Both are failures here: an unreachable staging Worker is exactly what this
  // step exists to catch, so it must not be treated as "nothing to check".
  if (run.status !== 0) {
    console.error(`contract:staging — FAILED: ${request} (exit ${run.status})`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\ncontract:staging — ${failed} of ${REQUESTS.length} failed against ${baseUrl}`);
  process.exit(1);
}

console.log(`\ncontract:staging — all ${REQUESTS.length} passed against ${baseUrl}`);
