/**
 * Seed the local `wrangler dev` D1 database with the project schema.
 *
 * `wrangler dev` boots an empty local D1, so the Bruno / e2e flows that
 * register, import, and query would 500 without tables. This applies every
 * migration in migrations/ to the local D1 used by `wrangler dev`.
 *
 * Migrations are not written to be re-run, so on a seeded database a file
 * fails at its first CREATE or ADD COLUMN. That one failure is a skip. Every
 * other failure (wrangler refusing this Node, a missing database, bad SQL) is
 * printed and ends the seed with exit 1: before 2026-10-08 a bare catch
 * reported all of them as "[skip] ... (already applied)" and the script ended
 * with "Local D1 ready." over an empty database (PR #84, run 37848562663).
 *
 * Usage: node scripts/seed-local-d1.mjs
 */
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'migrations';
const DB_NAME = 'ourwkrp-staging'; // matches [[d1_databases]].database_name in wrangler.toml

// SQLite's wording for "this object is already here", which is what wrangler
// 4.81.0 and 4.149.0 printed when each migration was re-run on a seeded local
// D1 (e.g. "table contributors already exists at offset 120: SQLITE_ERROR").
// "there is already a table named x" is a different error, a name taken by
// another kind of object, and is not a skip.
const ALREADY_APPLIED = [/(?:table|index|view|trigger) \S+ already exists/, /duplicate column name: [^\s:]+/];
// wrangler colours its error line even when its output is a pipe.
const ANSI = /\x1b\[[0-9;]*m/g;

function apply(file, label) {
  try {
    execSync(`npx wrangler d1 execute ${DB_NAME} --local --file="${file}" --yes`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    console.log(`  [ok]   ${label}`);
  } catch (err) {
    const output = [err.stdout, err.stderr].map((s) => (s ?? '').trim()).filter(Boolean).join('\n');
    const applied = ALREADY_APPLIED.map((re) => output.replace(ANSI, '').match(re)).find(Boolean);
    if (applied) {
      console.log(`  [skip] ${label} (already applied: ${applied[0]})`);
      return;
    }
    console.error(`  [fail] ${label}`);
    console.error(output || err.message);
    console.error(`Local D1 was not seeded: ${label} failed (exit ${err.status ?? 'none'}).`);
    process.exit(1);
  }
}

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
console.log(`Seeding local D1 "${DB_NAME}" with ${files.length} migration file(s)...`);

for (const file of files) apply(join(MIGRATIONS_DIR, file), file);

// Deterministic smoke fixtures (a DJ + a contributor) so the Tier-1 smoke can
// hit /dj/:id, /dj/:id/poster and /contributor/:id instead of skipping. Runs
// after the schema is in place; INSERT OR IGNORE makes re-seeding a no-op.
apply(join('scripts', 'smoke-fixtures.sql'), 'smoke-fixtures.sql');

console.log('Local D1 ready.');
