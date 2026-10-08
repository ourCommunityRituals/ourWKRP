/**
 * scripts/ci/install-playwright-browsers.sh and the jobs that call it.
 *
 * On 2026-10-08 the E2E Tests job of OW-158's PR (run 37819813838) sat in
 * `npx playwright install --with-deps chromium webkit` for 25 minutes, pulling
 * WebKit's system packages from azure.archive.ubuntu.com, before any test ran.
 * ourSharedEvents hit the same mirror on 2026-10-07 and fixed it with this
 * script (#862); it is ported here unchanged.
 *
 * Hermetic: a stub `playwright` and a stub `apt-get` stand in for the real
 * ones, and every path the script touches points into a temp dir. No package
 * is downloaded and nothing needs root. The real mirror, apt and cache are
 * proven by the CI jobs themselves.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { parse } from 'yaml';

const ROOT = join(__dirname, '..', '..');
const SCRIPT_REL = 'scripts/ci/install-playwright-browsers.sh';
const SCRIPT = join(ROOT, SCRIPT_REL);

const MIRRORS = [
  'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1',
  'https://archive.ubuntu.com/ubuntu/\tpriority:2',
  'https://security.ubuntu.com/ubuntu/\tpriority:3',
  '',
].join('\n');

let dir: string, cache: string, archives: string, confDir: string, mirrors: string, log: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-install-'));
  cache = join(dir, 'cache');
  archives = join(dir, 'archives');
  confDir = join(dir, 'apt.conf.d');
  mirrors = join(dir, 'apt-mirrors.txt');
  log = join(dir, 'calls.log');
  for (const d of [cache, archives, confDir, join(dir, 'bin')]) mkdirSync(d);
  writeFileSync(mirrors, MIRRORS);
  // Stub playwright: records each call, whether the download-only setting was
  // in place and whether the slow mirror was still listed. `install-deps` is
  // slow while STUB_SLOW_WHILE matches the mirror list, else it "downloads".
  writeFileSync(
    join(dir, 'playwright'),
    [
      '#!/usr/bin/env bash',
      'conf=absent; [ -f "$PW_APT_CONF_DIR/99-playwright-prefetch" ] && conf=present',
      'slow=dropped; grep -q azure "$PW_APT_MIRRORS_FILE" && slow=listed',
      'printf "%s | prefetch-conf=%s | azure=%s\\n" "$*" "$conf" "$slow" >> "$STUB_LOG"',
      'if [ "$1" = "install-deps" ]; then',
      '  if [ -n "${STUB_SLOW_WHILE:-}" ] && grep -q "$STUB_SLOW_WHILE" "$PW_APT_MIRRORS_FILE"; then sleep 20; fi',
      '  [ "${STUB_DEPS_EXIT:-0}" = "0" ] || exit "$STUB_DEPS_EXIT"',
      '  : > "$PW_APT_ARCHIVES_DIR/libnew_2.0_amd64.deb"',
      'fi',
      'exit 0',
      '',
    ].join('\n')
  );
  writeFileSync(
    join(dir, 'bin', 'apt-get'),
    ['#!/usr/bin/env bash', 'printf "apt-get %s\\n" "$*" >> "$STUB_LOG"', 'exit 0', ''].join('\n')
  );
  chmodSync(join(dir, 'playwright'), 0o755);
  chmodSync(join(dir, 'bin', 'apt-get'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[] = ['chromium', 'webkit'], env: Record<string, string> = {}) {
  const res = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: {
      PATH: `${join(dir, 'bin')}${delimiter}${process.env.PATH}`,
      HOME: dir,
      PW_BIN: join(dir, 'playwright'),
      PW_SUDO: '',
      PW_APT_CACHE_DIR: cache,
      PW_APT_ARCHIVES_DIR: archives,
      PW_APT_CONF_DIR: confDir,
      PW_APT_MIRRORS_FILE: mirrors,
      PW_APT_ATTEMPT_SECONDS: '1 10',
      STUB_LOG: log,
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf-8').trim().split('\n') : [];
  return { code: res.status, out: `${res.stdout}${res.stderr}`, calls };
}

// Each case spawns bash and waits on a real `timeout`.
describe('install-playwright-browsers.sh', { timeout: 60_000 }, () => {
  it('downloads under a limit first, then installs with the download-only setting gone', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      expect.stringMatching(/^install-deps chromium webkit \| prefetch-conf=present /),
      'apt-get autoclean',
      expect.stringMatching(/^install --with-deps chromium webkit \| prefetch-conf=absent /),
    ]);
  });

  it('restores saved packages before downloading and saves them after', () => {
    writeFileSync(join(cache, 'libkept_1.0_amd64.deb'), '');
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toContain('System packages restored from cache: 1');
    expect(readdirSync(cache).sort()).toEqual(['libkept_1.0_amd64.deb', 'libnew_2.0_amd64.deb']);
  });

  it('a slow mirror is dropped and the next attempt uses the one listed after it', () => {
    const r = run(undefined, { STUB_SLOW_WHILE: 'azure' });
    expect(r.code).toBe(0);
    expect(r.calls[0]).toContain('azure=listed');
    expect(r.calls[1]).toMatch(/^install-deps chromium webkit .*azure=dropped/);
    expect(r.out).toContain('did not finish in 1s (attempt 1 of 2)');
    expect(r.calls.at(-1)).toMatch(/^install --with-deps chromium webkit/);
  });

  it('the only mirror listed is never dropped', () => {
    writeFileSync(mirrors, 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n');
    const r = run(undefined, { STUB_SLOW_WHILE: 'azure', PW_APT_ATTEMPT_SECONDS: '1 1' });
    expect(r.code).toBe(1);
    expect(readFileSync(mirrors, 'utf-8')).toContain('azure.archive.ubuntu.com');
  });

  it('when no attempt finishes it fails, names the mirror, and installs nothing', () => {
    const r = run(undefined, { STUB_SLOW_WHILE: 'ubuntu', PW_APT_ATTEMPT_SECONDS: '1 1' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('::error title=Ubuntu package mirror too slow::');
    expect(r.calls.filter((c) => c.startsWith('install --with-deps'))).toEqual([]);
    expect(existsSync(join(confDir, '99-playwright-prefetch'))).toBe(false);
  });

  it('no browser named is a usage error', () => {
    expect(run([]).code).toBe(2);
  });

  it('the script is executable in git and has LF line endings', () => {
    const mode = spawnSync('git', ['ls-files', '-s', SCRIPT_REL], { cwd: ROOT, encoding: 'utf-8' });
    expect(mode.stdout).toMatch(/^100755 /);
    expect(readFileSync(SCRIPT, 'utf-8')).not.toContain('\r');
  });
});

// Derived from every workflow, so a new job is covered the day it is written.
describe('no job asks apt for browser packages outside the script', () => {
  const DIR = join(ROOT, '.github', 'workflows');
  const DIRECT = /playwright\s+install\b[^\n]*--with-deps/;
  type Step = { name?: string; run?: string; uses?: string; with?: Record<string, string> };
  const jobs: Array<{ file: string; job: string; steps: Step[] }> = [];
  for (const f of readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const doc = parse(readFileSync(join(DIR, f), 'utf-8')) as { jobs?: Record<string, { steps?: Step[] }> };
    for (const [job, def] of Object.entries(doc?.jobs ?? {})) jobs.push({ file: f, job, steps: def?.steps ?? [] });
  }
  const runs = jobs.flatMap(({ file, job, steps }) =>
    steps.filter((s) => typeof s?.run === 'string').map((s) => ({ where: `${file} › ${job} › ${s.name ?? '(unnamed)'}`, run: s.run as string }))
  );

  it('negative control: the walk reads run steps and the pattern sees a direct install', () => {
    expect(runs.length).toBeGreaterThan(20);
    expect(runs.filter((r) => r.run.includes(SCRIPT_REL)).length).toBeGreaterThanOrEqual(2);
    expect(DIRECT.test('npx playwright install --with-deps chromium webkit')).toBe(true);
    expect(DIRECT.test(`bash ${SCRIPT_REL} chromium webkit`)).toBe(false);
  });

  it('every install that pulls system packages goes through the script', () => {
    expect(runs.filter((r) => DIRECT.test(r.run)).map((r) => r.where)).toEqual([]);
  });

  it('every job that calls the script restores the package cache first, with a step limit', () => {
    const users = jobs.filter(({ steps }) => steps.some((s) => s?.run?.includes(SCRIPT_REL)));
    expect(users.length).toBeGreaterThanOrEqual(2);
    for (const { file, job, steps } of users) {
      const at = (pred: (s: Step) => boolean) => steps.findIndex((s) => s && pred(s));
      const cacheAt = at((s) => s.name === 'Restore Playwright system package cache');
      const installAt = at((s) => !!s.run?.includes(SCRIPT_REL));
      expect(cacheAt, `${file} › ${job}: no package cache step`).toBeGreaterThanOrEqual(0);
      expect(cacheAt, `${file} › ${job}: cache must come before the install`).toBeLessThan(installAt);
      expect(steps[cacheAt].with?.path).toBe('~/.cache/pw-apt-archives');
      // Two 150 s download attempts plus the install must fit inside the step.
      expect((steps[installAt] as { 'timeout-minutes'?: number })['timeout-minutes']).toBeGreaterThanOrEqual(8);
    }
  });
});
