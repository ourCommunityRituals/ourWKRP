#!/usr/bin/env node
/**
 * Deploy preflight gate.
 *
 * The security controls in OW-79 (atomic rate limiter) and OW-83 (audit
 * retention) are inert without their wrangler.toml wiring — and that file is
 * edited by hand, so it's exactly where a control silently goes missing. This
 * runs before `wrangler deploy` (see the predeploy:* npm scripts) and refuses
 * to ship if the wiring is absent. It is intentionally NOT part of `npm test`:
 * the unit suite must stay green on a fresh checkout, but a *deploy* must not.
 *
 * Static checks only (it never touches the network). The companion runtime
 * checks — D1 migrations actually applied, the binding actually live — are the
 * `wrangler d1 migrations apply` step in the deploy scripts and `npm run smoke`
 * against the deployed URL.
 *
 * Usage: node scripts/preflight-deploy.mjs [--env production]
 */
import { readFileSync } from 'node:fs';

const isProd = process.argv.includes('production') || process.argv.includes('--env=production');
const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

// Slice out the production sub-table so production-specific bindings are checked
// against the right section rather than matching the staging defaults.
const prodStart = toml.search(/^\[env\.production\]/m);
const defaultScope = prodStart === -1 ? toml : toml.slice(0, prodStart);
const prodScope = prodStart === -1 ? '' : toml.slice(prodStart);
const scope = isProd ? prodScope : defaultScope;
const scopeName = isProd ? 'env.production' : 'default (staging)';

const failures = [];
const require = (ok, msg) => { if (!ok) failures.push(msg); };

// OW-79: the atomic rate limiter needs its Durable Object bound + class migration.
require(/RATE_LIMITER/.test(scope), `[${scopeName}] missing durable_objects binding "RATE_LIMITER"`);
require(/RateLimiterDO/.test(scope), `[${scopeName}] binding does not reference class "RateLimiterDO"`);
// DO class migrations may be declared once at the top level — accept either scope.
require(/new_classes\s*=\s*\[[^\]]*RateLimiterDO/.test(toml), 'missing [[migrations]] new_classes = ["RateLimiterDO"]');

// OW-83: audit retention only runs if a cron trigger fires the scheduled() handler.
require(/crons\s*=\s*\[/.test(scope), `[${scopeName}] missing [triggers] crons for the audit retention purge`);

if (failures.length) {
  console.error('✗ Deploy preflight FAILED — security wiring missing from wrangler.toml:\n');
  for (const f of failures) console.error(`  • ${f}`);
  console.error('\nThese controls (OW-79 rate limiter, OW-83 audit retention) would deploy dormant.');
  console.error('See the wrangler.toml stanzas in the OW-78 epic notes before deploying.');
  process.exit(1);
}

console.log(`✓ Deploy preflight passed for ${scopeName}: RATE_LIMITER bound, DO migration + cron present.`);
