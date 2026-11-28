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

import { handleEraseIdentity, handleExportMyData } from '../../src/handlers/privacy';

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

describe('handleExportMyData (download my data)', () => {
  function dbFor(rows: Record<string, unknown[]>, binds: unknown[]) {
    return {
      prepare: (sql: string) => ({
        bind: (...a: unknown[]) => {
          binds.push(...a);
          return {
            all: async () => {
              if (sql.includes('FROM flag_facets')) throw new Error('boom');
              const key = Object.keys(rows).find((k) => sql.includes(`FROM ${k}`));
              return { results: key ? rows[key] : [] };
            },
          };
        },
      }),
    };
  }
  const exportReq = () => new Request('https://ourwkrp.com/api/me/export', { headers: { Cookie: 'wkrp_session=tok' } });

  it('passes through the 401 when unauthenticated', async () => {
    mockRequireSession.mockResolvedValue(Response.json({ ok: false }, { status: 401 }));
    const res = await handleExportMyData(exportReq(), { WKRP_DB: dbFor({}, []) } as never);
    expect(res.status).toBe(401);
  });

  it('reads only by the session id, returns a download, and audits it', async () => {
    mockRequireSession.mockResolvedValue({ userId: 'c1' });
    const binds: unknown[] = [];
    const db = dbFor({ contributors: [{ id: 'c1', name: 'Matt' }], playlists: [{ id: 'p1' }] }, binds);
    const res = await handleExportMyData(exportReq(), { WKRP_DB: db } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = JSON.parse(await res.text());
    expect(body.contributor_id).toBe('c1');
    expect(body.profile).toEqual({ id: 'c1', name: 'Matt' });
    expect(body.playlists).toEqual([{ id: 'p1' }]);
    // A failed section says so instead of failing the whole download.
    expect(body.declared_domains).toHaveProperty('error');
    expect(binds.length).toBeGreaterThan(5);
    expect(binds.every((b) => b === 'c1')).toBe(true);
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      action: 'privacy.export', outcome: 'success', actorId: 'c1',
    }));
  });

  it('never selects a token column', async () => {
    mockRequireSession.mockResolvedValue({ userId: 'c1' });
    const sqls: string[] = [];
    const db = { prepare: (sql: string) => { sqls.push(sql); return { bind: () => ({ all: async () => ({ results: [] }) }) }; } };
    await handleExportMyData(exportReq(), { WKRP_DB: db } as never);
    for (const sql of sqls) expect(sql).not.toMatch(/token/i);
  });
});
