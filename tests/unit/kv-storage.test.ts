/**
 * Unit tests — KV storage helpers
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  storeAuthState,
  getAuthState,
  deleteAuthState,
  storeSession,
  getSession,
  storeTokens,
  getTokens,
  storeLastSync,
  getLastSync,
} from '../../src/lib/kv-storage';
import type { AuthState, SessionData, StoredTokens } from '../../src/types';

function createMockKV() {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string) => {
      return store.get(key) ?? null;
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    _store: store,
  } as unknown as KVNamespace;
}

describe('KV Storage', () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  describe('Auth State', () => {
    const state = 'test-state-123';
    const authData: AuthState = {
      code_verifier: 'verifier-abc',
      name: 'Matt',
      gen: 'founder',
    };

    it('stores and retrieves auth state', async () => {
      await storeAuthState(kv, state, authData);
      const result = await getAuthState(kv, state);
      expect(result).toEqual(authData);
    });

    it('returns null for missing state', async () => {
      const result = await getAuthState(kv, 'nonexistent');
      expect(result).toBeNull();
    });

    it('deletes auth state', async () => {
      await storeAuthState(kv, state, authData);
      await deleteAuthState(kv, state);
      const result = await getAuthState(kv, state);
      expect(result).toBeNull();
    });

    it('stores with correct key prefix', async () => {
      await storeAuthState(kv, state, authData);
      expect(kv.put).toHaveBeenCalledWith(
        `wkrp:auth:${state}`,
        JSON.stringify(authData),
        { expirationTtl: 600 },
      );
    });
  });

  describe('Session', () => {
    const token = 'session-token-xyz';
    const sessionData: SessionData = {
      userId: 'user-123',
      name: 'Matt',
      gen: 'founder',
      brand_id: 'wkrp',
    };

    it('stores and retrieves session', async () => {
      await storeSession(kv, token, sessionData);
      const result = await getSession(kv, token);
      expect(result).toEqual(sessionData);
    });

    it('returns null for expired/missing session', async () => {
      const result = await getSession(kv, 'nonexistent');
      expect(result).toBeNull();
    });

    it('stores with 30-day TTL', async () => {
      await storeSession(kv, token, sessionData);
      expect(kv.put).toHaveBeenCalledWith(
        `wkrp:session:${token}`,
        JSON.stringify(sessionData),
        { expirationTtl: 2592000 },
      );
    });
  });

  describe('Tokens', () => {
    const userId = 'user-123';
    const tokens: StoredTokens = {
      access_token: 'access-abc',
      refresh_token: 'refresh-xyz',
      expires_at: Date.now() + 3600000,
    };

    it('stores and retrieves tokens', async () => {
      await storeTokens(kv, userId, tokens);
      const result = await getTokens(kv, userId);
      expect(result).toEqual(tokens);
    });

    it('returns null for missing tokens', async () => {
      const result = await getTokens(kv, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('Last Sync', () => {
    it('stores and retrieves last sync timestamp', async () => {
      await storeLastSync(kv, 'user-123');
      const result = await getLastSync(kv, 'user-123');
      expect(result).toBeTruthy();
      // Should be a valid ISO date
      expect(new Date(result!).getTime()).not.toBeNaN();
    });
  });
});
