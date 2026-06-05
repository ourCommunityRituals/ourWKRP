/**
 * Architectural invariant (PROPOSED) — security_control_wiring (per-repo facet)
 *
 * Brain:     ourCommunityRituals/OCR-docs → architectural-invariants.yaml
 *            PENDING registration. The registry runs through #14 today
 *            (#13 brain_enforcement_location, #14 mobile_workability are
 *            taken); ADR-002 has indicatively claimed #15 explicit_identity /
 *            #16 exit_always_available, so this lands at ~#17 — number to be
 *            assigned centrally, NOT minted here. Until then this is a
 *            per-repo gate only.
 * Tracking:  OW-78 (security epic) — file a sub-issue to register it centrally.
 * Pattern:   mirrors the brain's L0 structural code-shape locks (#1/#8 —
 *            string/static checks, no yaml dep) and runs on every PR via the
 *            `security-tests` job. Its T3 runtime complement is scripts/smoke.mjs;
 *            per the brain's pipeline-proves-the-covenant doctrine the invariant
 *            stays `partial` until that runtime layer is green.
 *
 * WHY THIS EXISTS
 * Unit/fuzz tests prove a control's *logic*; they mock the boundary, so they
 * stay green whether or not the control is actually enforced in the deployed
 * Worker. The dormant-control gap (OW-79 atomic rate limiter, OW-83 audit
 * retention) lives entirely in hand-edited wiring — wrangler.toml bindings, the
 * DO class migration, the cron trigger, and the scheduled() handler. A
 * deploy-time npm preflight catches it, but is bypassable by calling wrangler
 * directly. This invariant pulls the same assertions forward to PR time where
 * they cannot be skipped without visibly deleting the spec.
 *
 * The runtime complement — the control actually *firing* against a deployed URL
 * (health rate_limiter=durable, 429 under burst, cross-origin 403) — is
 * `scripts/smoke.mjs`. This file is the static half: the wiring must exist.
 *
 * EXPECTED CONSEQUENCE: this spec is RED until the wrangler.toml stanzas are
 * pasted (that file is hook-protected, edited by hand). That red is the gate
 * doing its job — it couples merge of the OW-79/OW-83 code to its activation.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const toml = read('wrangler.toml');
// Split out the production sub-table so its bindings are checked in isolation
// rather than satisfied by the staging defaults.
const prodStart = toml.search(/^\[env\.production\]/m);
const defaultScope = prodStart === -1 ? toml : toml.slice(0, prodStart);
const prodScope = prodStart === -1 ? '' : toml.slice(prodStart);

describe('Invariant security_control_wiring (proposed) — atomic rate limiter (OW-79) is wired, not dormant', () => {
  it('binds the RATE_LIMITER Durable Object (staging scope)', () => {
    expect(defaultScope).toMatch(/RATE_LIMITER/);
    expect(defaultScope).toMatch(/RateLimiterDO/);
  });

  it('binds the RATE_LIMITER Durable Object (production scope)', () => {
    expect(prodScope).toMatch(/RATE_LIMITER/);
    expect(prodScope).toMatch(/RateLimiterDO/);
  });

  it('declares the RateLimiterDO class migration', () => {
    expect(toml).toMatch(/new_classes\s*=\s*\[[^\]]*RateLimiterDO/);
  });

  it('exports the DO class from the entry module so the runtime can instantiate it', () => {
    expect(read('src/index.ts')).toMatch(/export\s*\{\s*RateLimiterDO\s*\}/);
  });
});

describe('Invariant security_control_wiring (proposed) — audit retention (OW-83) is wired, not dormant', () => {
  it('schedules the retention purge via a cron trigger (staging scope)', () => {
    expect(defaultScope).toMatch(/crons\s*=\s*\[/);
  });

  it('schedules the retention purge via a cron trigger (production scope)', () => {
    expect(prodScope).toMatch(/crons\s*=\s*\[/);
  });

  it('defines a scheduled() handler for the cron to invoke', () => {
    expect(read('src/index.ts')).toMatch(/\bscheduled\s*\(/);
  });

  it('ships the append-only audit_events migration', () => {
    const migrations = fs.readdirSync(path.join(ROOT, 'migrations'));
    expect(migrations.some((f) => /audit_events\.sql$/.test(f))).toBe(true);
  });
});

describe('Invariant security_control_wiring (proposed) — the deploy-time preflight gate is not silently removed', () => {
  it('runs the preflight before each deploy (predeploy npm hooks)', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['predeploy:staging'] ?? '').toMatch(/preflight/);
    expect(pkg.scripts['predeploy:prod'] ?? '').toMatch(/preflight/);
  });
});
