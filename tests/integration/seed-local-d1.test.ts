/**
 * scripts/seed-local-d1.mjs: which failures are a skip and which stop the seed.
 *
 * On 2026-10-08 the Bruno API Tests job of the deps-upgrade PR #84 (run
 * 37848562663) moved wrangler to ^4.145.0, which refuses Node 20. Every seed
 * call failed with "Wrangler requires at least Node.js v22.0.0", and the script
 * printed `[skip] ... (already applied ...)` for all 10 migrations and "Local
 * D1 ready.". The cause only surfaced later, as "server closed unexpectedly"
 * from start-server-and-test.
 *
 * Hermetic: a stub `npx` on PATH stands in for wrangler and the script runs in
 * a temp dir with its own migrations/, so no local D1 is read or written. The
 * "already applied" messages below are what wrangler 4.149.0 printed on stderr,
 * colour codes included, when the real migrations were run a second time
 * against a seeded local D1. The real wrangler is proven by the CI jobs that
 * seed: Bruno API Tests seeds a clean D1, E2E Tests seeds twice.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'seed-local-d1.mjs');

const wranglerError = (message: string) =>
  `\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERROR\x1b[41;31m]\x1b[0m \x1b[1m${message}\x1b[0m\n\n\n🪵  Logs were written to "/tmp/wrangler.log"`;

const ALREADY_APPLIED = [
  'table contributors already exists at offset 120: SQLITE_ERROR',
  'index idx_contributors_spotify_user already exists: SQLITE_ERROR',
  'duplicate column name: isrc: SQLITE_ERROR',
];

// bin/wrangler.js of wrangler ^4.145.0 on Node 20, written with console.error.
const NODE_TOO_OLD = [
  'Wrangler requires at least Node.js v22.0.0. You are using v20.19.5. Please update your version of Node.js.',
  '',
  'Consider using a Node.js version manager such as https://volta.sh/ or https://github.com/nvm-sh/nvm.',
].join('\n');

let dir: string, bin: string, log: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seed-d1-'));
  bin = join(dir, 'bin');
  log = join(dir, 'calls.log');
  mkdirSync(bin);
  mkdirSync(join(dir, 'migrations'));
  writeFileSync(join(dir, 'migrations', '0001_first.sql'), 'CREATE TABLE a (id TEXT);\n');
  writeFileSync(join(dir, 'migrations', '0002_second.sql'), 'ALTER TABLE a ADD COLUMN b TEXT;\n');
  // Stub npx: records each call. It exits STUB_EXIT after writing STUB_STDERR,
  // for every call or only for the calls whose arguments contain STUB_ONLY.
  writeFileSync(
    join(bin, 'stub.mjs'),
    [
      "import { appendFileSync } from 'node:fs';",
      "const args = process.argv.slice(2).join(' ');",
      "appendFileSync(process.env.STUB_LOG, args + '\\n');",
      "const exit = Number(process.env.STUB_EXIT ?? '0');",
      'const hit = !process.env.STUB_ONLY || args.includes(process.env.STUB_ONLY);',
      'if (exit !== 0 && hit) {',
      "  if (process.env.STUB_STDERR) process.stderr.write(process.env.STUB_STDERR + '\\n');",
      '  process.exit(exit);',
      '}',
      "process.stdout.write('Executing on local database\\n');",
      '',
    ].join('\n')
  );
  // The script starts `npx` through a shell: sh finds `npx`, cmd.exe `npx.cmd`.
  writeFileSync(join(bin, 'npx'), ['#!/bin/sh', 'exec node "$(dirname "$0")/stub.mjs" "$@"', ''].join('\n'));
  writeFileSync(join(bin, 'npx.cmd'), ['@echo off', 'node "%~dp0stub.mjs" %*', ''].join('\r\n'));
  chmodSync(join(bin, 'npx'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string> = {}) {
  // Windows names the variable `Path`; drop it so the stub dir is not shadowed.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  const res = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...inherited, PATH: `${bin}${delimiter}${process.env.PATH}`, STUB_LOG: log, ...env },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf-8').trim().split('\n') : [];
  return { code: res.status, out: `${res.stdout}${res.stderr}`, calls };
}

// Each case starts node, which starts the stub once per file through a shell.
describe('seed-local-d1.mjs', { timeout: 60_000 }, () => {
  it('a file that applies is reported [ok], and the fixtures run after the migrations', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      expect.stringMatching(/^wrangler d1 execute ourwkrp-staging --local --file=migrations[\\/]0001_first\.sql --yes$/),
      expect.stringMatching(/^wrangler d1 execute ourwkrp-staging --local --file=migrations[\\/]0002_second\.sql --yes$/),
      expect.stringMatching(/^wrangler d1 execute ourwkrp-staging --local --file=scripts[\\/]smoke-fixtures\.sql --yes$/),
    ]);
    expect(r.out).toContain('[ok]   0001_first.sql');
    expect(r.out).toContain('[ok]   0002_second.sql');
    expect(r.out).toContain('[ok]   smoke-fixtures.sql');
    expect(r.out).not.toContain('[skip]');
    expect(r.out).toContain('Local D1 ready.');
  });

  it.each(ALREADY_APPLIED)('"%s" is a [skip], and the seed carries on and exits 0', (message) => {
    const r = run({ STUB_EXIT: '1', STUB_STDERR: wranglerError(message), STUB_ONLY: 'migrations' });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(3);
    expect(r.out).toMatch(/\[skip\] 0001_first\.sql/);
    expect(r.out).toMatch(/\[skip\] 0002_second\.sql/);
    expect(r.out).toContain('[ok]   smoke-fixtures.sql');
    expect(r.out).toContain('Local D1 ready.');
  });

  it('wrangler refusing this Node is shown and stops the seed with a non-zero exit', () => {
    const r = run({ STUB_EXIT: '1', STUB_STDERR: NODE_TOO_OLD });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('Wrangler requires at least Node.js v22.0.0');
    expect(r.out).toContain('0001_first.sql');
    expect(r.out).not.toContain('[skip]');
    expect(r.out).not.toContain('Local D1 ready.');
    // The first failure ends the run: later files depend on earlier ones.
    expect(r.calls).toHaveLength(1);
  });

  it('a failure with no output is still a failure', () => {
    const r = run({ STUB_EXIT: '3' });
    expect(r.code).not.toBe(0);
    expect(r.out).not.toContain('[skip]');
    expect(r.out).not.toContain('Local D1 ready.');
  });

  it('the smoke fixtures follow the same rule: any other error is shown and exits non-zero', () => {
    const r = run({
      STUB_EXIT: '1',
      STUB_STDERR: wranglerError('no such table: contributors: SQLITE_ERROR'),
      STUB_ONLY: 'smoke-fixtures.sql',
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('[ok]   0002_second.sql');
    expect(r.out).toContain('no such table: contributors');
    expect(r.out).not.toContain('[skip]');
    expect(r.out).not.toContain('Local D1 ready.');
  });

  it('the smoke fixtures follow the same rule: already applied is a [skip]', () => {
    const r = run({ STUB_EXIT: '1', STUB_STDERR: wranglerError(ALREADY_APPLIED[0]), STUB_ONLY: 'smoke-fixtures.sql' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\[skip\] smoke-fixtures\.sql/);
    expect(r.out).toContain('Local D1 ready.');
  });
});
