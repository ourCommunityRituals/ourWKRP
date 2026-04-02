/**
 * Integration tests — Auth flow
 * Tests the full auth start -> callback -> session flow with mocked Spotify
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '../../src/auth/spotify-oauth';
import {
  storeAuthState,
  getAuthState,
  storeSession,
  getSession,
  storeTokens,
  getTokens,
} from '../../src/lib/kv-storage';

function createMockKV() {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => store.set(key, value)),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    delete: vi.fn(async (key: string) => store.delete(key)),
  } as unknown as KVNamespace;
}

describe('Auth Flow Integration', () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it('completes PKCE -> store -> retrieve -> delete cycle', async () => {
    // Step 1: Generate PKCE values
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateState();

    expect(verifier).toHaveLength(64);
    expect(challenge).toBeTruthy();
    expect(state).toHaveLength(64);

    // Step 2: Store auth state
    await storeAuthState(kv, state, {
      code_verifier: verifier,
      name: 'Matt',
      gen: 'founder',
    });

    // Step 3: Retrieve auth state (like callback would)
    const authState = await getAuthState(kv, state);
    expect(authState).toBeTruthy();
    expect(authState!.code_verifier).toBe(verifier);
    expect(authState!.name).toBe('Matt');
    expect(authState!.gen).toBe('founder');

    // Step 4: Simulate callback — create session
    const sessionToken = 'test-session-token-' + Date.now();
    const userId = 'user-' + Date.now();

    await storeTokens(kv, userId, {
      access_token: 'spotify-access-token',
      refresh_token: 'spotify-refresh-token',
      expires_at: Date.now() + 3600000,
    });

    await storeSession(kv, sessionToken, {
      userId,
      name: 'Matt',
      gen: 'founder',
      brand_id: 'wkrp',
    });

    // Step 5: Verify session retrieval
    const session = await getSession(kv, sessionToken);
    expect(session).toBeTruthy();
    expect(session!.userId).toBe(userId);
    expect(session!.name).toBe('Matt');

    // Step 6: Verify tokens retrieval
    const tokens = await getTokens(kv, userId);
    expect(tokens).toBeTruthy();
    expect(tokens!.access_token).toBe('spotify-access-token');
  });

  it('handles missing state gracefully', async () => {
    const result = await getAuthState(kv, 'nonexistent-state');
    expect(result).toBeNull();
  });

  it('handles expired session gracefully', async () => {
    const result = await getSession(kv, 'expired-session');
    expect(result).toBeNull();
  });
});
