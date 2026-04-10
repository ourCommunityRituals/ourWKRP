import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env, SessionData } from '../../src/types';
import { requireSession } from '../../src/lib/require-session';

function createMockKV() {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    _store: store,
  } as unknown as KVNamespace;
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

describe('requireSession', () => {
  let kv: KVNamespace;
  let env: Env;

  const sessionData: SessionData = {
    userId: 'user-abc-123',
    name: 'Matt',
    gen: 'founder',
    brand_id: 'wkrp',
  };

  beforeEach(() => {
    kv = createMockKV();
    env = mockEnv(kv);
  });

  it('returns session data when valid cookie and KV hit', async () => {
    // Store session in KV
    await kv.put('wkrp:session:valid-token', JSON.stringify(sessionData));

    const request = new Request('http://localhost:8787/api/playlists', {
      method: 'POST',
      headers: { Cookie: 'wkrp_session=valid-token' },
    });

    const result = await requireSession(request, env);
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toEqual(sessionData);
  });

  it('returns 401 when no cookie present', async () => {
    const request = new Request('http://localhost:8787/api/playlists', {
      method: 'POST',
    });

    const result = await requireSession(request, env);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await response.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 401 when cookie present but session expired (KV miss)', async () => {
    const request = new Request('http://localhost:8787/api/playlists', {
      method: 'POST',
      headers: { Cookie: 'wkrp_session=expired-token' },
    });

    const result = await requireSession(request, env);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const body = await response.json() as { ok: boolean; error: string };
    expect(body.error).toBe('Session expired');
  });

  it('returns 401 when cookie header exists but no wkrp_session cookie', async () => {
    const request = new Request('http://localhost:8787/api/playlists', {
      method: 'POST',
      headers: { Cookie: 'other_cookie=something' },
    });

    const result = await requireSession(request, env);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
  });
});
