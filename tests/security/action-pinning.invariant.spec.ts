/**
 * Every workflow action is pinned by commit, and a token used for a checkout is
 * never written to disk (OW-228; CCR security sweep 2026-11-25, findings H2, L1).
 *
 * A tag such as `@v3` can be moved to new code by whoever controls the action's
 * repository. The deploy jobs here run `dopplerhq/cli-action` with the Doppler
 * tokens that unlock the Cloudflare deploy token, so a moved tag would run new
 * code with them. A full 40-hex commit cannot be moved. Dependabot
 * (.github/dependabot.yml, github-actions) proposes new commits as reviewed PRs.
 *
 * A checkout given a `token:` writes that token into the clone's .git/config
 * unless `persist-credentials: false` is set, where every later step can read it.
 *
 * Born red: each detector is shown failing on a synthetic workflow first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');

type Step = { uses?: string; with?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Step[]; uses?: string }> };

/** Every `uses:` of a remote action or reusable workflow not pinned by a full commit. */
export function unpinned(text: string): string[] {
  const wf = (yaml.load(text) ?? {}) as Workflow;
  const refs: string[] = [];
  for (const job of Object.values(wf.jobs ?? {})) {
    if (job.uses) refs.push(job.uses);
    for (const s of job.steps ?? []) if (s.uses) refs.push(s.uses);
  }
  return refs.filter((u) => !u.startsWith('./') && !u.startsWith('docker://') && !/@[0-9a-f]{40}$/.test(u));
}

/** Checkouts that are given a token and still persist it. */
export function persistedTokens(text: string): string[] {
  const wf = (yaml.load(text) ?? {}) as Workflow;
  const bad: string[] = [];
  for (const [name, job] of Object.entries(wf.jobs ?? {})) {
    for (const s of job.steps ?? []) {
      if (!(s.uses ?? '').startsWith('actions/checkout@')) continue;
      if (s.with?.token !== undefined && s.with?.['persist-credentials'] !== false) bad.push(name);
    }
  }
  return bad;
}

const steps = (...lines: string[]) => ['jobs:', '  a:', '    steps:', ...lines].join('\n');

describe('detectors: each fault is caught, each safe shape passes', () => {
  it('tags, branches and short SHAs are unpinned; a full SHA and a local action are not', () => {
    expect(unpinned(steps('      - uses: actions/checkout@v4'))).toEqual(['actions/checkout@v4']);
    expect(unpinned(steps('      - uses: dopplerhq/cli-action@main'))).toEqual(['dopplerhq/cli-action@main']);
    expect(unpinned(steps('      - uses: actions/cache@0057852'))).toEqual(['actions/cache@0057852']);
    expect(unpinned(steps(`      - uses: actions/checkout@${'c'.repeat(40)} # v4`, '      - uses: ./.github/actions/x'))).toEqual([]);
  });
  it('a reusable workflow on a tag is unpinned', () => {
    expect(unpinned('jobs:\n  a:\n    uses: org/repo/.github/workflows/x.yml@v1\n')).toEqual([
      'org/repo/.github/workflows/x.yml@v1',
    ]);
  });
  it('a checkout with a token and no persist-credentials: false is caught', () => {
    const co = `      - uses: actions/checkout@${'c'.repeat(40)}`;
    expect(persistedTokens(steps(co, '        with:', '          token: ${{ secrets.X }}'))).toEqual(['a']);
    expect(
      persistedTokens(steps(co, '        with:', '          token: ${{ secrets.X }}', '          persist-credentials: false')),
    ).toEqual([]);
    expect(persistedTokens(steps(co))).toEqual([]);
  });
});

describe('the real workflows', () => {
  const files = readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f));

  it('reads every workflow (anti-vacuity)', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    const total = files.flatMap((f) =>
      [...readFileSync(path.join(WF_DIR, f), 'utf8').matchAll(/^\s*-?\s*uses:/gm)].map(() => f),
    ).length;
    expect(total).toBeGreaterThanOrEqual(70);
  });

  for (const f of readdirSync(WF_DIR).filter((x) => /\.ya?ml$/.test(x))) {
    it(`${f}: every action pinned by commit, no persisted checkout token`, () => {
      const text = readFileSync(path.join(WF_DIR, f), 'utf8');
      expect(unpinned(text)).toEqual([]);
      expect(persistedTokens(text)).toEqual([]);
    });
  }

  it('Dependabot watches github-actions, so pins are bumped by reviewed PRs', () => {
    const p = path.join(ROOT, '.github', 'dependabot.yml');
    expect(existsSync(p)).toBe(true);
    const cfg = yaml.load(readFileSync(p, 'utf8')) as { updates?: { 'package-ecosystem'?: string }[] };
    expect((cfg.updates ?? []).map((u) => u['package-ecosystem'])).toContain('github-actions');
  });

  // CCR F5 (2026-11-26): Dependabot waits at least 7 days after a release
  // before proposing it, so a hijacked or broken release has time to be
  // caught upstream before a PR offers it here.
  it('every Dependabot entry waits at least 7 days after a release (cooldown)', () => {
    const cfg = yaml.load(readFileSync(path.join(ROOT, '.github', 'dependabot.yml'), 'utf8')) as {
      updates?: { 'package-ecosystem'?: string; cooldown?: { 'default-days'?: unknown } }[];
    };
    const updates = cfg.updates ?? [];
    expect(updates.length).toBeGreaterThan(0);
    const short = updates
      .filter((u) => {
        const d = u.cooldown?.['default-days'];
        return typeof d !== 'number' || !Number.isInteger(d) || d < 7;
      })
      .map((u) => u['package-ecosystem']);
    expect(short).toEqual([]);
  });
});
