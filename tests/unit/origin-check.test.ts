import { describe, it, expect } from 'vitest';
import { isAllowedMutation } from '../../src/lib/origin-check';
import type { Env } from '../../src/types';

function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    WKRP_KV: {} as KVNamespace,
    WKRP_DB: {} as D1Database,
    WORKER_ENV: 'staging',
    WORKER_VERSION: '0.1.0',
    SPOTIFY_CLIENT_ID: 'test',
    SPOTIFY_REDIRECT_URI: 'http://localhost:8787/auth/callback',
    APP_URL: 'http://localhost:8787',
    LASTFM_API_KEY: 'test',
    LASTFM_SHARED_SECRET: 'test',
    ...overrides,
  };
}

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:8787/api/playlists', { method: 'POST', headers });
}

describe('isAllowedMutation', () => {
  const env = mockEnv();

  it('allows safe methods regardless of origin', () => {
    expect(isAllowedMutation(req({ Origin: 'https://evil.com' }), env, 'GET')).toBe(true);
    expect(isAllowedMutation(req({ Origin: 'https://evil.com' }), env, 'HEAD')).toBe(true);
  });

  it('allows mutation from an allowlisted Origin', () => {
    expect(isAllowedMutation(req({ Origin: 'http://localhost:8787' }), env, 'POST')).toBe(true);
  });

  it('blocks mutation from a foreign Origin', () => {
    expect(isAllowedMutation(req({ Origin: 'https://evil.com' }), env, 'POST')).toBe(false);
    expect(isAllowedMutation(req({ Origin: 'https://evil.com' }), env, 'DELETE')).toBe(false);
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(isAllowedMutation(req({ Referer: 'http://localhost:8787/create' }), env, 'POST')).toBe(true);
    expect(isAllowedMutation(req({ Referer: 'https://evil.com/x' }), env, 'POST')).toBe(false);
  });

  it('rejects a malformed Referer on a mutation', () => {
    expect(isAllowedMutation(req({ Referer: 'not a url' }), env, 'POST')).toBe(false);
  });

  it('allows mutations with neither Origin nor Referer (non-browser clients)', () => {
    expect(isAllowedMutation(req(), env, 'POST')).toBe(true);
  });

  it('honors the production APP_URL origin', () => {
    const prod = mockEnv({ APP_URL: 'https://ourwkrp.com', WORKER_ENV: 'production' });
    expect(isAllowedMutation(req({ Origin: 'https://ourwkrp.com' }), prod, 'POST')).toBe(true);
    expect(isAllowedMutation(req({ Origin: 'http://localhost:8787' }), prod, 'POST')).toBe(true);
    expect(isAllowedMutation(req({ Origin: 'https://stg.ourwkrp.com' }), prod, 'POST')).toBe(false);
  });
});
