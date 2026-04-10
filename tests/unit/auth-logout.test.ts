import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env, SessionData } from '../../src/types';
import { handleLogout } from '../../src/handlers/auth-logout';

function createMockKV() {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

function mockEnv(kv: KVNamespace): Env {
  return {
    WKRP_KV: kv,
    WKRP_DB: {} as D1Database,
    WORKER_ENV: 'staging',
    WORKER_VERSION: '0.1.0',
    SPOTIFY_CLIENT_ID: 'test',
    SPOTIFY_REDIRECT_URI: 'http://localhost:8787/auth/callback',
    APP_URL: 'http://localhost:8787',
    LASTFM_API_KEY: 'test',
    LASTFM_SHARED_SECRET: 'test',
  };
}

describe('handleLogout', () => {
  let kv: ReturnType<typeof createMockKV>;
  let env: Env;

  const sessionData: SessionData = {
    userId: 'user-123',
    name: 'Matt',
    gen: 'founder',
    brand_id: 'wkrp',
  };

  beforeEach(() => {
    kv = createMockKV();
    env = mockEnv(kv);
  });

  it('returns 200 and clears session cookie when valid session', async () => {
    const token = 'active-session-token';
    kv._store.set(`wkrp:session:${token}`, JSON.stringify(sessionData));

    const request = new Request('http://localhost:8787/auth/logout', {
      method: 'POST',
      headers: { Cookie: `wkrp_session=${token}` },
    });

    const response = await handleLogout(request, env);
    expect(response.status).toBe(200);

    const body = await response.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    // Cookie should be cleared
    const setCookie = response.headers.get('Set-Cookie');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('wkrp_session=');

    // Session should be deleted from KV
    expect(kv.delete).toHaveBeenCalledWith(`wkrp:session:${token}`);
  });

  it('returns 200 even when no session exists (idempotent)', async () => {
    const request = new Request('http://localhost:8787/auth/logout', {
      method: 'POST',
    });

    const response = await handleLogout(request, env);
    expect(response.status).toBe(200);

    const body = await response.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    // Cookie should still be cleared
    const setCookie = response.headers.get('Set-Cookie');
    expect(setCookie).toContain('Max-Age=0');

    // No KV delete called (no token to delete)
    expect(kv.delete).not.toHaveBeenCalled();
  });

  it('clears cookie with HttpOnly flag', async () => {
    const request = new Request('http://localhost:8787/auth/logout', {
      method: 'POST',
    });

    const response = await handleLogout(request, env);
    const setCookie = response.headers.get('Set-Cookie');
    expect(setCookie).toContain('HttpOnly');
  });
});
