/**
 * Claude jobs cannot be rewritten by the pull request they read (OW-227; CCR
 * security sweep 2026-11-25, findings H1, M7, L2).
 *
 * A branch pushed from this repository (every agent session pushes one) is a
 * same-repository pull request, so its workflow runs see repository secrets.
 * Claude Code loads CLAUDE.md, AGENTS.md, .mcp.json and .claude/ (settings,
 * hooks, skills, agents) from the working tree, and claude-code-action loads
 * project settings unless told otherwise (base-action/src/parse-sdk-options.ts,
 * settingSources default ["user", "project", "local"], at the pinned SHA). So a
 * hook added on the PR branch would run inside the Claude job, next to the API
 * key. ourSharedEvents closed this in claude-review.yml; these rules hold the
 * same line here.
 *
 * For every job that runs anthropics/claude-code-action:
 *   1. the action is pinned by a full commit SHA;
 *   2. no `${{ secrets.* }}` is written inside a `run:` script;
 *   3. every checkout sets `persist-credentials: false`;
 *   4. on a workflow that runs PR code, the job either restores CLAUDE.md,
 *      AGENTS.md, .mcp.json and .claude/ from the base branch before the action,
 *      or passes `--setting-sources user` (tag mode checks out the PR branch by
 *      itself, so only the flag holds there);
 *   5. a `pull_request` job has no `id-token: write` (the OIDC trade gives an
 *      app token that the job's `permissions:` block does not bound);
 *   6. a job that gives the action a `prompt` (agent mode) lists its tools with
 *      `--allowedTools`.
 *
 * Born red: each rule is broken on purpose on a synthetic workflow below, next
 * to the real workflows passing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '../..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const ACTION = 'anthropics/claude-code-action';
const SHA = /@[0-9a-f]{40}$/;
const PR_EVENTS = ['pull_request', 'pull_request_target', 'pull_request_review', 'pull_request_review_comment'];
const INSTRUCTION_PATHS = ['.claude', 'AGENTS.md', 'CLAUDE.md', '.mcp.json'];

type Step = { uses?: string; run?: string; with?: Record<string, unknown>; name?: string };
type Job = { permissions?: Record<string, string> | string; steps?: Step[] };
type Workflow = { on?: unknown; jobs?: Record<string, Job> };

function events(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (on && typeof on === 'object') return Object.keys(on);
  return [];
}

function restoresFromBase(step: Step): boolean {
  const run = step.run ?? '';
  return (
    /git fetch[^\n]*origin[^\n]*refs\/heads\//.test(run) &&
    INSTRUCTION_PATHS.every((p) => run.includes(`rm -rf`) && run.includes(p)) &&
    /git checkout "?origin\//.test(run)
  );
}

/** Every rule a workflow breaks, as "job: rule" strings. Empty means it holds. */
export function claudeJobFindings(text: string): string[] {
  const wf = (yaml.load(text) ?? {}) as Workflow;
  const ev = events((wf as Record<string, unknown>).on ?? (wf as Record<string, unknown>)['true']);
  const runsPrCode = ev.some((e) => PR_EVENTS.includes(e));
  const out: string[] = [];
  for (const [name, job] of Object.entries(wf.jobs ?? {})) {
    const steps = job.steps ?? [];
    const at = steps.findIndex((s) => (s.uses ?? '').startsWith(`${ACTION}@`));
    if (at === -1) continue;
    const step = steps[at];
    const args = String(step.with?.claude_args ?? '');

    if (!SHA.test(step.uses ?? '')) out.push(`${name}: action not pinned by commit`);
    for (const s of steps) {
      if (/\$\{\{\s*secrets\./.test(s.run ?? '')) out.push(`${name}: secret inside a run script`);
      if ((s.uses ?? '').startsWith('actions/checkout@') && s.with?.['persist-credentials'] !== false) {
        out.push(`${name}: checkout persists credentials`);
      }
    }
    if (runsPrCode) {
      const restored = steps.slice(0, at).some(restoresFromBase);
      const userOnly = /--setting-sources\s+['"]?user['"]?(\s|$)/.test(args);
      if (!restored && !userOnly) out.push(`${name}: reads instructions from PR code`);
    }
    const perms = typeof job.permissions === 'object' ? job.permissions : {};
    if (ev.includes('pull_request') && perms['id-token'] === 'write') {
      out.push(`${name}: id-token write on a pull_request job`);
    }
    if (step.with?.prompt !== undefined && !/--allowedTools\s/.test(args)) {
      out.push(`${name}: agent mode without a tool allowlist`);
    }
  }
  return out;
}

// ── A known-good job, then one fault at a time ─────────────────────────────────
const PIN = `${ACTION}@${'a'.repeat(40)}`;
const RESTORE = [
  '          git fetch --no-tags --depth=1 origin "refs/heads/${BASE_REF}:refs/remotes/origin/${BASE_REF}"',
  '          rm -rf .claude AGENTS.md CLAUDE.md .mcp.json',
  '          for p in .claude AGENTS.md CLAUDE.md .mcp.json; do git checkout "origin/${BASE_REF}" -- "$p"; done',
].join('\n');
function wf(o: {
  on?: string;
  pin?: string;
  idToken?: boolean;
  persist?: boolean;
  restore?: boolean;
  secretInRun?: boolean;
  args?: string;
  prompt?: boolean;
}): string {
  return [
    `on: ${o.on ?? 'pull_request'}`,
    'jobs:',
    '  review:',
    '    permissions:',
    '      contents: read',
    ...(o.idToken ? ['      id-token: write'] : []),
    '    steps:',
    '      - name: key',
    `        run: echo ${o.secretInRun ? '${{ secrets.ANTHROPIC_API_KEY }}' : '"$HAS_KEY"'}`,
    '      - uses: actions/checkout@' + 'b'.repeat(40),
    ...(o.persist === false ? [] : ['        with:', '          persist-credentials: false']),
    ...(o.restore === false ? [] : ['      - name: restore', '        run: |', RESTORE]),
    `      - uses: ${o.pin ?? PIN}`,
    '        with:',
    ...(o.prompt === false ? [] : ["          prompt: 'review'"]),
    `          claude_args: '${o.args ?? '--allowedTools "Read"'}'`,
  ].join('\n');
}

describe('the rules: each fault is caught, the safe shape passes', () => {
  it('a pinned, restored, allowlisted pull_request job passes', () => {
    expect(claudeJobFindings(wf({}))).toEqual([]);
  });
  it('a tag-pinned action is caught', () => {
    expect(claudeJobFindings(wf({ pin: `${ACTION}@v1` }))).toEqual(['review: action not pinned by commit']);
  });
  it('a secret written inside a run script is caught', () => {
    expect(claudeJobFindings(wf({ secretInRun: true }))).toEqual(['review: secret inside a run script']);
  });
  it('a checkout that keeps its credentials is caught', () => {
    expect(claudeJobFindings(wf({ persist: false }))).toEqual(['review: checkout persists credentials']);
  });
  it('PR code with no base-branch restore and no --setting-sources user is caught', () => {
    expect(claudeJobFindings(wf({ restore: false }))).toEqual(['review: reads instructions from PR code']);
  });
  it('--setting-sources user alone is accepted (tag mode), "user,project" is not', () => {
    expect(claudeJobFindings(wf({ restore: false, args: '--setting-sources user --allowedTools "Read"' }))).toEqual([]);
    expect(
      claudeJobFindings(wf({ restore: false, args: '--setting-sources user,project --allowedTools "Read"' })),
    ).toEqual(['review: reads instructions from PR code']);
  });
  it('a restore that leaves .claude/ behind is caught', () => {
    const partial = wf({}).replace('rm -rf .claude AGENTS.md', 'rm -rf AGENTS.md').replace('for p in .claude ', 'for p in ');
    expect(claudeJobFindings(partial)).toEqual(['review: reads instructions from PR code']);
  });
  it('id-token write on a pull_request job is caught', () => {
    expect(claudeJobFindings(wf({ idToken: true }))).toEqual(['review: id-token write on a pull_request job']);
  });
  it('agent mode without --allowedTools is caught; tag mode needs none', () => {
    expect(claudeJobFindings(wf({ args: '--model x' }))).toEqual(['review: agent mode without a tool allowlist']);
    expect(claudeJobFindings(wf({ prompt: false, args: '--model x' }))).toEqual([]);
  });
  it('an issue-only workflow is not held to the PR-code rule', () => {
    expect(claudeJobFindings(wf({ on: 'issues', restore: false }))).toEqual([]);
  });
});

describe('the real Claude workflows hold every rule', () => {
  const files = readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f));
  const claudeFiles = files.filter((f) => readFileSync(path.join(WF_DIR, f), 'utf8').includes(`${ACTION}@`));

  it('finds both Claude workflows (anti-vacuity)', () => {
    expect(claudeFiles.sort()).toEqual(['claude-code-review.yml', 'claude.yml']);
  });

  for (const f of ['claude-code-review.yml', 'claude.yml']) {
    it(`${f} breaks no rule`, () => {
      expect(claudeJobFindings(readFileSync(path.join(WF_DIR, f), 'utf8'))).toEqual([]);
    });
  }
});
