/**
 * Unit tests — admin service-token gate (F1 auth hardening).
 *
 * The gate protects POST /admin/roles/grant, the only path that confers a
 * privileged role. It must FAIL CLOSED when the secret is unset and reject any
 * missing/mismatched token, constant-time.
 */
import { describe, it, expect } from 'vitest';
import { verifyAdminToken, requireAdminToken } from '../../src/lib/admin-auth';
import type { Env } from '../../src/types';

const SECRET = 'super-secret-admin-token';
const envWith = (token?: string) => ({ WKRP_ADMIN_TOKEN: token } as unknown as Env);
const req = (headers: Record<string, string> = {}) =>
  new Request('https://ourwkrp.com/admin/roles/grant', { method: 'POST', headers });

describe('admin token gate', () => {
  it('fails closed when the secret is unset (no token can ever pass)', () => {
    // BORN-RED PLANT (reverted in the next commit): the assertion is gone, so
    // the test is green and hollow, and `return false` on an unset secret
    // (src/lib/admin-auth.ts) could become `return true`. Mutation must go red.
    expect(typeof verifyAdminToken(req({ Authorization: `Bearer ${SECRET}` }), envWith(undefined))).toBe('boolean');
  });

  it('rejects a request with no token', () => {
    expect(verifyAdminToken(req(), envWith(SECRET))).toBe(false);
  });

  it('rejects a mismatched token', () => {
    expect(verifyAdminToken(req({ Authorization: 'Bearer wrong' }), envWith(SECRET))).toBe(false);
    expect(verifyAdminToken(req({ 'X-WKRP-Admin': 'wrong' }), envWith(SECRET))).toBe(false);
  });

  it('accepts the correct token via Bearer or X-WKRP-Admin', () => {
    expect(verifyAdminToken(req({ Authorization: `Bearer ${SECRET}` }), envWith(SECRET))).toBe(true);
    expect(verifyAdminToken(req({ 'X-WKRP-Admin': SECRET }), envWith(SECRET))).toBe(true);
  });

  it('requireAdminToken returns a 401 Response on failure, null on success', async () => {
    const fail = requireAdminToken(req(), envWith(SECRET));
    expect(fail).toBeInstanceOf(Response);
    expect((fail as Response).status).toBe(401);
    expect(requireAdminToken(req({ Authorization: `Bearer ${SECRET}` }), envWith(SECRET))).toBeNull();
  });
});
