/**
 * Admin service-token gate (F1 auth hardening, 2026-09-12).
 *
 * Privileged roles (dj/curator) are conferred only through POST /admin/roles/grant.
 * That route is not something a self-service user may reach, so it is gated by a
 * WKRP admin secret rather than a session: a presented bearer/header token is
 * compared CONSTANT-TIME against `env.WKRP_ADMIN_TOKEN`. Missing secret or
 * missing/invalid token → FAIL CLOSED (401) BEFORE any DB read.
 *
 * This mirrors cross-product-auth.ts (the OSE integration seam); the two are
 * deliberately separate secrets so an OSE integration token can never grant
 * roles and vice versa.
 */

import type { Env } from '../types';

/**
 * Constant-time string compare. A length-only leak is accepted (tokens are
 * fixed-length secrets); the value comparison is timing-safe.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Extract the presented admin token: `Authorization: Bearer <token>` or an
 * `X-WKRP-Admin: <token>` header. Returns null when neither is present/well-formed.
 */
function extractPresentedToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (auth) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  const header = request.headers.get('X-WKRP-Admin');
  if (header && header.trim().length > 0) return header.trim();
  return null;
}

/**
 * Returns true iff a presented token matches `env.WKRP_ADMIN_TOKEN`
 * (constant-time). Fails closed on missing env secret, missing token, or
 * mismatch. Pure — no D1, no fetch.
 */
export function verifyAdminToken(request: Request, env: Env): boolean {
  const expected = env.WKRP_ADMIN_TOKEN?.trim();
  if (!expected) return false; // fail closed when the secret is unset
  const presented = extractPresentedToken(request);
  if (!presented) return false;
  return constantTimeEqual(presented, expected);
}

/**
 * Gate an admin handler. Returns a 401 Response when the token is missing/invalid
 * (so the handler can `return` it BEFORE any DB read), or null when authorized.
 */
export function requireAdminToken(request: Request, env: Env): Response | null {
  if (verifyAdminToken(request, env)) return null;
  return Response.json({ ok: false, error: 'Admin authorization required' }, { status: 401 });
}
