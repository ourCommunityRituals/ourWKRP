/**
 * Unit tests — saving a played song to the listener's Spotify library.
 *
 * Spotify's February 2026 change removed PUT /me/tracks; the replacement is
 * PUT /me/library with Spotify URIs in a comma-separated `uris` query
 * parameter and no body.
 * https://developer.spotify.com/documentation/web-api/reference/save-library-items
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/lib/kv-storage', () => ({
  getTokens: vi.fn(async () => ({ access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 60_000 })),
}));

import { pushTrackToLibrary } from '../../src/lib/music-push';

let fetchMock: ReturnType<typeof vi.fn>;
const kv = {
  get: vi.fn(async (key: string) =>
    key === 'wkrp:track_spotify_uri:track-1' ? 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh' : null,
  ),
} as unknown as KVNamespace;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pushTrackToLibrary (Spotify)', () => {
  test('PUTs the track URI to /me/library, not /me/tracks', async () => {
    const result = await pushTrackToLibrary(kv, 'user-1', 'track-1', 'USRC17607839');

    expect(result).toEqual({ platform: 'spotify', saved: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://api.spotify.com/v1/me/library');
    expect(u.searchParams.get('uris')).toBe('spotify:track:4iV5W9uYEdYUVa79Axb7Rh');
    expect(init.method).toBe('PUT');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  test('reports a Spotify refusal without throwing', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Insufficient client scope', { status: 403 }));

    const result = await pushTrackToLibrary(kv, 'user-1', 'track-1', null);

    expect(result).toEqual({ platform: 'spotify', saved: false, error: 'Spotify API 403' });
  });

  test('skips the call when the track has no Spotify URI', async () => {
    const result = await pushTrackToLibrary(kv, 'user-1', 'unknown', null);

    expect(result.saved).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
