#!/usr/bin/env node
/**
 * Post-deploy control smoke tests.
 *
 * Unit/fuzz tests prove the control *logic*; they mock the boundary, so they
 * pass whether or not the control is actually enforced in the deployed Worker.
 * This hits a real URL and asserts the controls fire end-to-end — the gap that
 * causes "tested" security to silently fail in production.
 *
 * Scope is the externally-observable surface (no session required):
 *   - rate-limiter liveness (a recognized backend is bound; KV or durable)
 *   - HTML CSP nonce (no script-src 'unsafe-inline')
 *   - JSON default CSP (script-src 'none')
 *   - cross-origin mutation rejected (OW-81 CSRF origin check)
 *   - rate-limit 429 under burst (OW-79)
 *
 * Session-gated liveness — an audit row actually persisted, an erasure actually
 * tombstoning — needs a seeded test contributor and is a documented follow-up,
 * not asserted here. Better to leave that honestly uncovered than fake it.
 *
 * Usage:
 *   npm run smoke:staging                  (URL baked in, see package.json)
 *   npm run smoke:prod
 *   node scripts/smoke.mjs https://host     (URL as first arg)
 *   BASE_URL=https://host npm run smoke      (URL via env)
 */
const BASE = (process.env.BASE_URL || process.argv[2] || '').replace(/\/$/, '');
if (!BASE) {
  console.error('✗ A base URL is required: `npm run smoke:staging`, `node scripts/smoke.mjs https://host`, or BASE_URL=https://host npm run smoke');
  process.exit(2);
}

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, msg: err instanceof Error ? err.message : String(err) });
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

await check('rate-limiter reports a live backend (kv or durable)', async () => {
  // KV is the launch backend (OW-78 CCR); the atomic Durable Object is a deferred
  // upgrade. Both are live controls — the real liveness proof is the 429-under-burst
  // check below, which is backend-agnostic. Here we only assert /health reports a
  // *recognized* backend, so an unset/garbage value still fails the deploy.
  const res = await fetch(`${BASE}/health`);
  assert(res.status === 200, `GET /health -> ${res.status}`);
  const body = await res.json();
  assert(body.rate_limiter === 'kv' || body.rate_limiter === 'durable',
    `health.rate_limiter = "${body.rate_limiter}" — expected "kv" or "durable" (rate limiting not wired)`);
});

await check('HTML page sets nonce CSP (no script unsafe-inline)', async () => {
  const res = await fetch(`${BASE}/`, { redirect: 'manual' });
  const csp = res.headers.get('content-security-policy') || '';
  assert(csp.includes('nonce-'), `page CSP has no nonce: "${csp}"`);
  assert(!/script-src[^;]*'unsafe-inline'/.test(csp), `page CSP still allows inline script: "${csp}"`);
});

await check('JSON response uses default CSP script-src none', async () => {
  const res = await fetch(`${BASE}/api/tracks`);
  const csp = res.headers.get('content-security-policy') || '';
  assert(/script-src\s+'none'/.test(csp), `JSON CSP missing script-src 'none': "${csp}"`);
});

await check('cross-origin mutation is rejected (CSRF origin check)', async () => {
  const res = await fetch(`${BASE}/api/playlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ name: 'smoke' }),
    redirect: 'manual',
  });
  assert(res.status === 403, `cross-origin POST expected 403, got ${res.status}`);
});

await check('rate limiter returns 429 under burst', async () => {
  // auth bucket: 20 req / 60s. Fire enough to trip it from one client IP.
  let saw429 = false;
  for (let i = 0; i < 30 && !saw429; i++) {
    const res = await fetch(`${BASE}/auth/start`, { redirect: 'manual' });
    if (res.status === 429) saw429 = true;
  }
  assert(saw429, 'no 429 after 30 requests to /auth/start — rate limit not enforced');
});

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`✓ ${r.name}`);
  } else {
    failed++;
    console.error(`✗ ${r.name}\n    ${r.msg}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} control checks passed against ${BASE}`);
process.exit(failed ? 1 : 0);
