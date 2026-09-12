/**
 * Cross-product service-token gate (OSE-1299).
 *
 * The two cross-product seams — GET /api/events/:id/music and
 * GET /api/sponsors/:eventId/report — export floored aggregates to OSE. Before
 * this gate they were unauthenticated: `isCrossProductRequest()` only checks
 * that a request LOOKS cross-product (origin/header PRESENCE), which is not
 * authorization, and the sponsor report leaked venue/event_date for any
 * arbitrary eventId (a bare existence oracle).
 *
 * This mirrors OSE's shared-report-auth.ts service-token posture: a presented
 * bearer/header token is compared CONSTANT-TIME against a WKRP secret
 * (`env.OSE_INTEGRATION_TOKEN`). Missing secret or missing/invalid token →
 * FAIL CLOSED (401) BEFORE any DB read. WKRP has no live OSE caller yet, so
 * mandatory auth breaks no live integration.
 */

import type { Env } from '../types';

/**
 * Constant-time string compare. Length-independent leak on the length itself is
 * accepted (same as OSE's shared-report-auth.ts): tokens are fixed-length
 * secrets and the value comparison is timing-safe.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Extract the presented cross-product token from a request. Accepts either an
 * `Authorization: Bearer <token>` header or an `X-OSE-Integration: <token>`
 * value. Returns null when neither is present/well-formed.
 */
function extractPresentedToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const header = request.headers.get('X-OSE-Integration');
  if (header && header.trim().length > 0) return header.trim();
  return null;
}

/**
 * Verify a cross-product request holds the WKRP integration secret.
 *
 * Returns true iff a presented token matches `env.OSE_INTEGRATION_TOKEN`
 * (constant-time). Fails closed on missing env secret, missing token, or
 * mismatch. Pure — no D1, no fetch.
 */
export function verifyCrossProductToken(request: Request, env: Env): boolean {
  const expected = env.OSE_INTEGRATION_TOKEN?.trim();
  if (!expected) return false; // fail closed when the secret is unset
  const presented = extractPresentedToken(request);
  if (!presented) return false;
  return constantTimeEqual(presented, expected);
}

/**
 * Gate a cross-product seam handler. Returns a 401 Response when the token is
 * missing/invalid (so the handler can `return` it BEFORE any DB read), or null
 * when the caller is authorized and the handler may proceed.
 */
export function requireCrossProductToken(request: Request, env: Env): Response | null {
  if (verifyCrossProductToken(request, env)) return null;
  return Response.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
}
