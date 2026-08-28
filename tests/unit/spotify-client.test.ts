/**
 * Unit tests — Spotify client failure handling (OW-120)
 *
 * Spotify returns a permanent 403 on /audio-features for apps created after
 * the endpoint was restricted. These tests lock the two behaviours that keeps
 * honest: a 403 is a distinct, recognisable failure, and one failed batch does
 * not take the whole stage down with it.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getAudioFeatures,
  isNotEntitledError,
  SpotifyApiError,
} from '../../src/spotify/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body = 'nope', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

/** N ids, enough to span `Math.ceil(n / 100)` batches. */
function trackIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `track-${i}`);
}

function featurePayload(ids: string[]) {
  return {
    audio_features: ids.map((id) => ({
      id,
      energy: 0.5,
      danceability: 0.5,
      valence: 0.5,
      tempo: 120,
      acousticness: 0.5,
      instrumentalness: 0.5,
    })),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================
// Where: a Spotify endpoint this app is not entitled to
// ============================================
describe('403 from the Spotify API (OW-120)', () => {
  describe('spotifyFetch (via getAudioFeatures)', () => {
    test('throws a SpotifyApiError carrying code "not_entitled" and permanent: true', async () => {
      fetchMock.mockImplementation(async () => errorResponse(403, 'Forbidden'));

      // spotifyFetch is module-private; createPlaylist is the thinnest public
      // wrapper over it, so the error it surfaces is spotifyFetch's.
      const { createPlaylist } = await import('../../src/spotify/client');
      const captured = await createPlaylist('user-1', 'name', 'desc', false, 'token')
        .catch((err: unknown) => err);

      expect(captured).toBeInstanceOf(SpotifyApiError);
      expect((captured as SpotifyApiError).code).toBe('not_entitled');
      expect((captured as SpotifyApiError).permanent).toBe(true);
      expect((captured as SpotifyApiError).status).toBe(403);
    });

    test('does not retry a 403 — retry cannot change an entitlement decision', async () => {
      fetchMock.mockImplementation(async () => errorResponse(403, 'Forbidden'));

      const { getUserProfile } = await import('../../src/spotify/client');
      await expect(getUserProfile('token')).rejects.toBeInstanceOf(SpotifyApiError);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('marks other non-OK statuses as transient — code "request_failed", permanent: false', async () => {
      fetchMock.mockImplementation(async () => errorResponse(500, 'boom'));

      const { getUserProfile } = await import('../../src/spotify/client');
      const err = await getUserProfile('token').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SpotifyApiError);
      expect((err as SpotifyApiError).code).toBe('request_failed');
      expect((err as SpotifyApiError).permanent).toBe(false);
    });

    test('still retries a 429 and returns the retried result (429 behaviour untouched)', async () => {
      fetchMock
        .mockImplementationOnce(async () => errorResponse(429, 'slow down', { 'Retry-After': '0' }))
        .mockImplementationOnce(async () => jsonResponse({ id: 'user-1' }));

      const { getUserProfile } = await import('../../src/spotify/client');
      const profile = await getUserProfile('token');

      expect(profile).toEqual({ id: 'user-1' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('isNotEntitledError', () => {
    test('recognises a SpotifyApiError raised by a 403', () => {
      expect(isNotEntitledError(new SpotifyApiError(403, '/audio-features', 'Forbidden'))).toBe(true);
    });

    test('rejects a transient failure and non-error values', () => {
      expect(isNotEntitledError(new SpotifyApiError(500, '/me', 'boom'))).toBe(false);
      expect(isNotEntitledError(new Error('network down'))).toBe(false);
      expect(isNotEntitledError(null)).toBe(false);
      expect(isNotEntitledError('not_entitled')).toBe(false);
    });
  });
});

// ============================================
// Where: /audio-features fetched in batches of 100
// ============================================
describe('audio-features batching (OW-120)', () => {
  describe('getAudioFeatures', () => {
    test('returns status "ok" with every feature when all batches succeed', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        const ids = new URL(url).searchParams.get('ids')!.split(',');
        return jsonResponse(featurePayload(ids));
      });

      const result = await getAudioFeatures(trackIds(250), 'token');

      expect(result.status).toBe('ok');
      expect(result.features).toHaveLength(250);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test('returns status "unavailable" and no features when the first batch 403s', async () => {
      fetchMock.mockImplementation(async () => errorResponse(403, 'Forbidden'));

      const result = await getAudioFeatures(trackIds(250), 'token');

      expect(result.status).toBe('unavailable');
      expect(result.features).toEqual([]);
    });

    test('stops requesting further batches after a 403 — remaining batches would 403 identically', async () => {
      fetchMock.mockImplementation(async () => errorResponse(403, 'Forbidden'));

      await getAudioFeatures(trackIds(250), 'token');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('keeps features fetched before a 403 and reports status "partial"', async () => {
      let call = 0;
      fetchMock.mockImplementation(async (url: string) => {
        call++;
        if (call === 1) {
          const ids = new URL(url).searchParams.get('ids')!.split(',');
          return jsonResponse(featurePayload(ids));
        }
        return errorResponse(403, 'Forbidden');
      });

      const result = await getAudioFeatures(trackIds(250), 'token');

      expect(result.features).toHaveLength(100);
      expect(result.status).toBe('partial');
      // Batch 1 ok, batch 2 403, batch 3 never attempted.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('one transiently failed batch does not abort the batches after it (OW-120)', async () => {
      let call = 0;
      fetchMock.mockImplementation(async (url: string) => {
        call++;
        if (call === 2) return errorResponse(500, 'boom');
        const ids = new URL(url).searchParams.get('ids')!.split(',');
        return jsonResponse(featurePayload(ids));
      });

      const result = await getAudioFeatures(trackIds(250), 'token');

      // Batches 1 and 3 landed; the middle one was skipped, not fatal.
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.features).toHaveLength(150);
      expect(result.status).toBe('partial');
    });

    test('returns status "unavailable" when every batch fails transiently', async () => {
      fetchMock.mockImplementation(async () => errorResponse(500, 'boom'));

      const result = await getAudioFeatures(trackIds(250), 'token');

      expect(result.status).toBe('unavailable');
      expect(result.features).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    test('returns status "ok" with no request when there are no track ids', async () => {
      const result = await getAudioFeatures([], 'token');

      expect(result).toEqual({ features: [], status: 'ok' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('drops null entries Spotify returns for tracks without features', async () => {
      fetchMock.mockImplementation(async () =>
        jsonResponse({ audio_features: [null, { id: 'track-1', energy: 0.5, danceability: 0.5, valence: 0.5, tempo: 120, acousticness: 0.5, instrumentalness: 0.5 }] }),
      );

      const result = await getAudioFeatures(trackIds(2), 'token');

      expect(result.features).toHaveLength(1);
      expect(result.status).toBe('ok');
    });
  });
});
