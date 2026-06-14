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
 * (rate-limit 429 under burst, cross-origin 403) — is `scripts/smoke.mjs`. This
 * file is the static half: the wiring must exist.
 *
 * RATE-LIMITER BACKEND (OW-78 CCR, 2026-06-07): KV is the live backend at launch.
 * The atomic Durable Object is a deferred upgrade — enforceRateLimit falls back
 * to the KV limiter when RATE_LIMITER is unbound, so rate limiting is live either
 * way. This invariant therefore asserts (a) rate limiting IS wired into the
 * router unconditionally, and (b) the DO-specific wiring is complete *only if*
 * the binding is present. The OW-83 audit/cron wiring stays unconditional.
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

// Is the atomic Durable Object bound? It's a deferred upgrade (OW-78 CCR), so
// its wiring is only required when present — but the KV limiter (below) is.
const hasDoBinding = /RATE_LIMITER/.test(toml);

describe('Invariant security_control_wiring (proposed) — rate limiting (OW-79) is wired, not dormant', () => {
  it('wires rate limiting into the request path (KV backend is always live)', () => {
    expect(read('src/router.ts')).toMatch(/enforceRateLimit\s*\(/);
  });

  // The atomic Durable Object is a deferred upgrade (OW-78 CCR). When it IS
  // bound, its wiring must be complete; when unbound, enforceRateLimit uses KV.
  (hasDoBinding ? describe : describe.skip)('when RATE_LIMITER is bound, the DO wiring is complete', () => {
    it('binds the RateLimiterDO class in both scopes', () => {
      expect(defaultScope).toMatch(/RateLimiterDO/);
      expect(prodScope).toMatch(/RateLimiterDO/);
    });

    it('declares the SQLite-backed RateLimiterDO class migration', () => {
      // Free-plan Durable Objects must be SQLite-backed (new_sqlite_classes).
      expect(toml).toMatch(/new(?:_sqlite)?_classes\s*=\s*\[[^\]]*RateLimiterDO/);
    });

    it('exports the DO class from the entry module so the runtime can instantiate it', () => {
      expect(read('src/index.ts')).toMatch(/export\s*\{\s*RateLimiterDO\s*\}/);
    });
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
