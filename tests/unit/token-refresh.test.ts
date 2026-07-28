/**
 * Unit tests — Token refresh logic
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getValidAccessToken } from '../../src/auth/token-refresh';

describe('Token Refresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns valid token when not expired', async () => {
    // Token valid for another hour
    const tokens = {
      access_token: 'valid-token',
      refresh_token: 'refresh-abc',
      expires_at: Date.now() + 3600000,
    };

    const mockKV = {
      get: vi.fn(async () => JSON.stringify(tokens)),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace;

    const mockEnv = {
      WKRP_KV: mockKV,
      SPOTIFY_CLIENT_ID: 'test-client-id',
    };

    const result = await getValidAccessToken(mockEnv as never, 'user-123');
    expect(result).toBe('valid-token');
  });

  it('returns null when no tokens exist', async () => {
    const mockKV = {
      get: vi.fn(async () => null),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace;

    const mockEnv = {
      WKRP_KV: mockKV,
      SPOTIFY_CLIENT_ID: 'test-client-id',
    };

    const result = await getValidAccessToken(mockEnv as never, 'user-123');
    expect(result).toBeNull();
  });

  it('attempts refresh when token is near expiry', async () => {
    // Token expires in 2 minutes (within 5-min buffer)
    const tokens = {
      access_token: 'expiring-token',
      refresh_token: 'refresh-abc',
      expires_at: Date.now() + 120000,
    };

    const mockKV = {
      get: vi.fn(async () => JSON.stringify(tokens)),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace;

    const mockEnv = {
      WKRP_KV: mockKV,
      SPOTIFY_CLIENT_ID: 'test-client-id',
    };

    // Mock fetch for token refresh
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'new-access-token',
      token_type: 'Bearer',
      scope: 'test',
      expires_in: 3600,
      refresh_token: 'new-refresh-token',
    }), { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const result = await getValidAccessToken(mockEnv as never, 'user-123');

    expect(result).toBe('new-access-token');
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockKV.put).toHaveBeenCalled();
  });
});
