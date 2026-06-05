/**
 * Unit tests — self-service erasure handler authz (OW-83).
 *
 * The DELETE /api/contributors/:id/identity route is self-only: a session may
 * erase its own contributor id and nobody else's. These tests isolate the
 * authz branches by mocking the session + erasure dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireSession = vi.fn();
vi.mock('../../src/lib/require-session', () => ({
  requireSession: (...a: unknown[]) => mockRequireSession(...a),
}));

const mockEraseContributor = vi.fn();
vi.mock('../../src/lib/erasure', () => ({
  eraseContributor: (...a: unknown[]) => mockEraseContributor(...a),
}));

const mockRecordAudit = vi.fn();
vi.mock('../../src/lib/audit', () => ({
  recordAudit: (...a: unknown[]) => mockRecordAudit(...a),
}));

vi.mock('../../src/lib/session-cookie', () => ({
  getSessionToken: () => 'tok',
  buildClearSessionCookie: () => 'wkrp_session=; Max-Age=0',
}));

const mockDeleteSession = vi.fn();
vi.mock('../../src/lib/kv-storage', () => ({
  deleteSession: (...a: unknown[]) => mockDeleteSession(...a),
}));

import { handleEraseIdentity } from '../../src/handlers/privacy';

const env = { WKRP_KV: {} } as never;
const req = () => new Request('https://ourwkrp.com/api/contributors/c1/identity', {
  method: 'DELETE',
  headers: { Cookie: 'wkrp_session=tok' },
});

beforeEach(() => vi.clearAllMocks());

describe('handleEraseIdentity', () => {
  it('passes through the 401 when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue(Response.json({ ok: false }, { status: 401 }));
    const res = await handleEraseIdentity(req(), env, 'c1');
    expect(res.status).toBe(401);
    expect(mockEraseContributor).not.toHaveBeenCalled();
  });

  it('denies erasing another contributor (not self) and audits it', async () => {
    mockRequireSession.mockResolvedValue({ userId: 'attacker' });
    const res = await handleEraseIdentity(req(), env, 'c1');
    expect(res.status).toBe(403);
    expect(mockEraseContributor).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(env, expect.anything(), expect.objectContaining({
      action: 'privacy.erasure', outcome: 'denied', actorId: 'attacker',
    }));
  });

  it('erases self, tears down the session, and clears the cookie', async () => {
    mockRequireSession.mockResolvedValue({ userId: 'c1' });
    mockEraseContributor.mockResolvedValue({ erased: true });
    const res = await handleEraseIdentity(req(), env, 'c1');
    expect(res.status).toBe(200);
    expect(mockEraseContributor).toHaveBeenCalledWith(env, expect.anything(), 'c1');
    expect(mockDeleteSession).toHaveBeenCalledWith(env.WKRP_KV, 'tok');
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await res.json()).toEqual({ ok: true, erased: true });
  });

  it('returns 404 when the contributor row does not exist', async () => {
    mockRequireSession.mockResolvedValue({ userId: 'c1' });
    mockEraseContributor.mockResolvedValue({ erased: false });
    const res = await handleEraseIdentity(req(), env, 'c1');
    expect(res.status).toBe(404);
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });
});
