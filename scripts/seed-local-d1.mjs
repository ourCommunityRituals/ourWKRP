/**
 * Seed the local `wrangler dev` D1 database with the project schema.
 *
 * `wrangler dev` boots an empty local D1, so the Bruno / e2e flows that
 * register, import, and query would 500 without tables. This applies every
 * migration in migrations/ to the local D1 used by `wrangler dev`.
 *
 * Migrations are additive and partially overlap, so an "already exists" error
 * on re-application is expected and treated as a skip — matching the tolerance
 * in scripts/setup-infra.sh.
 *
 * Usage: node scripts/seed-local-d1.mjs
 */
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'migrations';
const DB_NAME = 'ourwkrp-staging'; // matches [[d1_databases]].database_name in wrangler.toml

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
console.log(`Seeding local D1 "${DB_NAME}" with ${files.length} migration file(s)...`);

for (const file of files) {
  try {
    execSync(
      `npx wrangler d1 execute ${DB_NAME} --local --file="${join(MIGRATIONS_DIR, file)}" --yes`,
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    console.log(`  [ok]   ${file}`);
  } catch {
    console.log(`  [skip] ${file} (already applied or idempotent re-declaration)`);
  }
}

console.log('Local D1 ready.');
