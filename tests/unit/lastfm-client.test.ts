/**
 * Unit tests — Last.fm client
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAuthUrl, getTrackTags, getArtistTags } from '../../src/lastfm/client';

// Mock logger
vi.mock('../../src/lib/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

describe('Last.fm Client', () => {
  describe('getAuthUrl', () => {
    it('builds correct auth URL with API key and callback', () => {
      const url = getAuthUrl('test-api-key', 'http://localhost:8787/auth/lastfm/callback');
      expect(url).toContain('https://www.last.fm/api/auth/');
      expect(url).toContain('api_key=test-api-key');
      expect(url).toContain('cb=http');
      expect(url).toContain('auth%2Flastfm%2Fcallback');
    });

    it('encodes callback URL properly', () => {
      const url = getAuthUrl('key', 'https://ourwkrp.com/auth/lastfm/callback');
      expect(url).toContain('cb=https');
    });
  });

  describe('getTrackTags', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns tags on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          toptags: {
            tag: [
              { name: 'rock', count: 100, url: 'https://last.fm/tag/rock' },
              { name: 'indie', count: 50, url: 'https://last.fm/tag/indie' },
            ],
          },
        }),
      });

      const tags = await getTrackTags('Radiohead', 'Creep', 'test-key');
      expect(tags).toHaveLength(2);
      expect(tags[0].name).toBe('rock');
    });

    it('returns empty array on API error', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: 6, message: 'Track not found' }),
      });

      const tags = await getTrackTags('Unknown', 'Track', 'test-key');
      expect(tags).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const tags = await getTrackTags('Artist', 'Track', 'test-key');
      expect(tags).toEqual([]);
    });
  });

  describe('getArtistTags', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns tags on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          toptags: {
            tag: [
              { name: 'hip-hop', count: 100, url: '' },
            ],
          },
        }),
      });

      const tags = await getArtistTags('Kendrick Lamar', 'test-key');
      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('hip-hop');
    });

    it('sends autocorrect parameter', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ toptags: { tag: [] } }),
      });

      await getArtistTags('Artist', 'test-key');
      const fetchUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(fetchUrl).toContain('autocorrect=1');
    });

    it('returns empty array on error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));

      const tags = await getArtistTags('Artist', 'test-key');
      expect(tags).toEqual([]);
    });
  });
});
