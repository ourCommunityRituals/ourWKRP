import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env, SessionData } from '../../src/types';
import { storeSession, getSession, deleteSession } from '../../src/lib/kv-storage';
import { getSessionToken, buildSessionCookie, buildClearSessionCookie } from '../../src/lib/session-cookie';
import { requireSession } from '../../src/lib/require-session';
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

describe('Session Lifecycle', () => {
  let kv: ReturnType<typeof createMockKV>;
  let env: Env;

  const sessionData: SessionData = {
    userId: 'user-lifecycle-123',
    name: 'Matt',
    gen: 'founder',
    brand_id: 'wkrp',
  };

  beforeEach(() => {
    kv = createMockKV();
    env = mockEnv(kv);
  });

  it('full cycle: store → cookie → retrieve → logout → gone', async () => {
    // 1. Store session (simulates auth-callback.ts after OAuth)
    const token = crypto.randomUUID();
    await storeSession(kv, token, sessionData);

    // 2. Build cookie (simulates Set-Cookie header in auth-callback response)
    const cookie = buildSessionCookie(token, false);
    expect(cookie).toContain(`wkrp_session=${token}`);
    expect(cookie).toContain('HttpOnly');

    // 3. Retrieve session via cookie (simulates frontend calling /auth/session/me)
    const authenticatedRequest = new Request('http://localhost:8787/auth/session/me', {
      headers: { Cookie: `wkrp_session=${token}` },
    });

    const extractedToken = getSessionToken(authenticatedRequest);
    expect(extractedToken).toBe(token);

    const session = await getSession(kv, extractedToken!);
    expect(session).toEqual(sessionData);

    // 4. requireSession also works
    const authResult = await requireSession(authenticatedRequest, env);
    expect(authResult).not.toBeInstanceOf(Response);
    expect(authResult).toEqual(sessionData);

    // 5. Logout (simulates POST /auth/logout)
    const logoutRequest = new Request('http://localhost:8787/auth/logout', {
      method: 'POST',
      headers: { Cookie: `wkrp_session=${token}` },
    });

    const logoutResponse = await handleLogout(logoutRequest, env);
    expect(logoutResponse.status).toBe(200);

    const logoutCookie = logoutResponse.headers.get('Set-Cookie')!;
    expect(logoutCookie).toContain('Max-Age=0');

    // 6. Session is gone from KV
    const afterLogout = await getSession(kv, token);
    expect(afterLogout).toBeNull();

    // 7. requireSession returns 401 now
    const postLogoutResult = await requireSession(authenticatedRequest, env);
    expect(postLogoutResult).toBeInstanceOf(Response);
    expect((postLogoutResult as Response).status).toBe(401);
  });

  it('deleteSession removes session from KV', async () => {
    const token = 'delete-test-token';
    await storeSession(kv, token, sessionData);

    // Verify it exists
    const before = await getSession(kv, token);
    expect(before).toEqual(sessionData);

    // Delete
    await deleteSession(kv, token);

    // Verify it's gone
    const after = await getSession(kv, token);
    expect(after).toBeNull();
  });

  it('buildClearSessionCookie produces a cookie that would clear the browser cookie', () => {
    const clearCookie = buildClearSessionCookie();
    expect(clearCookie).toContain('wkrp_session=');
    expect(clearCookie).toContain('Max-Age=0');
    expect(clearCookie).toContain('HttpOnly');
    expect(clearCookie).toContain('Path=/');
  });
});
