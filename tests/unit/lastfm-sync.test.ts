/**
 * Unit tests — Last.fm sync engine
 * Tests dedup, batching, genre enrichment, incremental sync
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the client
const mockGetAllRecentTracks = vi.fn();
const mockGetArtistTags = vi.fn();
vi.mock('../../src/lastfm/client', () => ({
  getAllRecentTracks: (...args: unknown[]) => mockGetAllRecentTracks(...args),
  getArtistTags: (...args: unknown[]) => mockGetArtistTags(...args),
}));

// Mock KV storage
const mockGetLastSync = vi.fn();
const mockStoreLastSync = vi.fn();
vi.mock('../../src/lib/kv-storage', () => ({
  getLastSync: (...args: unknown[]) => mockGetLastSync(...args),
  storeLastSync: (...args: unknown[]) => mockStoreLastSync(...args),
}));

// Mock logger
vi.mock('../../src/lib/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

import { syncLastfmUser } from '../../src/lastfm/sync-engine';

function makeScrobble(name: string, artist: string, album = '', date = '2026-01-15 12:00', mbid = '') {
  return {
    name,
    artist: { '#text': artist, name: artist },
    album: { '#text': album },
    date: { '#text': date, uts: String(Math.floor(new Date(date).getTime() / 1000)) },
    mbid,
  };
}

function mockEnv() {
  const batchFn = vi.fn(() => []);
  const runFn = vi.fn();
  const prepareFn = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(() => null),
      all: vi.fn(() => ({ results: [] })),
      run: runFn,
    })),
  }));
  return {
    WKRP_DB: { prepare: prepareFn, batch: batchFn },
    WKRP_KV: {},
    _batch: batchFn,
    _prepare: prepareFn,
    _run: runFn,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLastSync.mockResolvedValue(null);
  mockStoreLastSync.mockResolvedValue(undefined);
  mockGetArtistTags.mockResolvedValue([]);
});

describe('Last.fm Sync Engine', () => {
  describe('empty scrobbles', () => {
    it('returns early with zero counts when no scrobbles', async () => {
      mockGetAllRecentTracks.mockResolvedValue([]);
      const env = mockEnv();

      const result = await syncLastfmUser(
        env as never,
        'contributor-1',
        'testuser',
        'api-key',
      );

      expect(result.tracks_synced).toBe(0);
      expect(result.tracks_processed).toBe(0);
      expect(result.contributions_created).toBe(0);
      expect(result.artists_tagged).toBe(0);
      expect(result.username).toBe('testuser');
      expect(env._batch).not.toHaveBeenCalled();
    });
  });

  describe('deduplication', () => {
    it('aggregates play_count for same artist+title', async () => {
      mockGetAllRecentTracks.mockResolvedValue([
        makeScrobble('Song A', 'Artist 1', 'Album', '2026-01-10 10:00'),
        makeScrobble('Song A', 'Artist 1', 'Album', '2026-01-11 11:00'),
        makeScrobble('Song A', 'Artist 1', 'Album', '2026-01-12 12:00'),
      ]);
      const env = mockEnv();

      const result = await syncLastfmUser(env as never, 'c1', 'user', 'key');

      expect(result.tracks_synced).toBe(1); // 3 scrobbles → 1 unique track
    });

    it('treats different artist+title as separate tracks', async () => {
      mockGetAllRecentTracks.mockResolvedValue([
        makeScrobble('Song A', 'Artist 1'),
        makeScrobble('Song B', 'Artist 1'),
        makeScrobble('Song A', 'Artist 2'),
      ]);
      const env = mockEnv();

      const result = await syncLastfmUser(env as never, 'c1', 'user', 'key');

      expect(result.tracks_synced).toBe(3);
    });

    it('normalizes case for dedup', async () => {
      mockGetAllRecentTracks.mockResolvedValue([
        makeScrobble('SONG A', 'ARTIST 1'),
        makeScrobble('song a', 'artist 1'),
      ]);
      const env = mockEnv();

      const result = await syncLastfmUser(env as never, 'c1', 'user', 'key');

      expect(result.tracks_synced).toBe(1);
    });

    it('strips feat./ft. for dedup', async () => {
      mockGetAllRecentTracks.mockResolvedValue([
        makeScrobble('Song A (feat. Someone)', 'Artist 1'),
        makeScrobble('Song A', 'Artist 1'),
      ]);
      const env = mockEnv();

      const result = await syncLastfmUser(env as never, 'c1', 'user', 'key');

      expect(result.tracks_synced).toBe(1);
    });
  });

  describe('incremental sync', () => {
    it('passes from timestamp when KV has last sync', async () => {
      mockGetLastSync.mockResolvedValue('2026-01-15T00:00:00Z');
      mockGetAllRecentTracks.mockResolvedValue([]);
      const env = mockEnv();

      await syncLastfmUser(env as never, 'c1', 'user', 'key');

      const fromArg = mockGetAllRecentTracks.mock.calls[0][2];
      expect(fromArg).toBeTypeOf('number');
      expect(fromArg).toBeGreaterThan(0);
    });

    it('does not pass from on first sync', async () => {
      mockGetLastSync.mockResolvedValue(null);
      mockGetAllRecentTracks.mockResolvedValue([]);
      const env = mockEnv();

      await syncLastfmUser(env as never, 'c1', 'user', 'key');

      const fromArg = mockGetAllRecentTracks.mock.calls[0][2];
      expect(fromArg).toBeUndefined();
    });

    it('updates KV after successful sync', async () => {
      mockGetAllRecentTracks.mockResolvedValue([
        makeScrobble('Song', 'Artist'),
      ]);
      const env = mockEnv();

      await syncLastfmUser(env as never, 'c1', 'user', 'key');

      expect(mockStoreLastSync).toHaveBeenCalledWith(env.WKRP_KV, 'lastfm:c1');
    });
  });

  describe('genre enrichment', () => {
    it('sets genre from top artist tag', async () => {
      mockGetAllRecentTracks.mockResolvedValue([
        makeScrobble('Song', 'Kendrick Lamar'),
      ]);
      mockGetArtistTags.mockResolvedValue([
        { name: 'hip-hop', count: 100, url: '' },
        { name: 'rap', count: 80, url: '' },
      ]);
      const env = mockEnv();

      const result = await syncLastfmUser(env as never, 'c1', 'user', 'key');

      expect(result.artists_tagged).toBe(1);
      expect(mockGetArtistTags).toHaveBeenCalledWith('Kendrick Lamar', 'key');
    });

    it('reports 0 artists_tagged when no tags returned', async () => {
      mockGetAllRecentTracks.mockResolvedValue([
        makeScrobble('Song', 'Unknown Artist'),
      ]);
      mockGetArtistTags.mockResolvedValue([]);
      const env = mockEnv();

      const result = await syncLastfmUser(env as never, 'c1', 'user', 'key');

      expect(result.artists_tagged).toBe(0);
    });
  });

  describe('batch processing', () => {
    it('processes tracks in batches of 25', async () => {
      // 30 tracks → should call batch at least twice (25 + 5)
      const scrobbles = Array.from({ length: 30 }, (_, i) =>
        makeScrobble(`Song ${i}`, `Artist ${i}`)
      );
      mockGetAllRecentTracks.mockResolvedValue(scrobbles);
      const env = mockEnv();

      const result = await syncLastfmUser(env as never, 'c1', 'user', 'key');

      expect(result.tracks_synced).toBe(30);
      // At least 2 batch calls for tracks (25+5), plus tag batches
      expect(env._batch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('result shape', () => {
    it('returns correct structure', async () => {
      mockGetAllRecentTracks.mockResolvedValue([
        makeScrobble('Song', 'Artist'),
      ]);
      const env = mockEnv();

      const result = await syncLastfmUser(env as never, 'c1', 'testuser', 'key');

      expect(result).toHaveProperty('username', 'testuser');
      expect(result).toHaveProperty('tracks_synced');
      expect(result).toHaveProperty('tracks_processed');
      expect(result).toHaveProperty('contributions_created');
      expect(result).toHaveProperty('artists_tagged');
      expect(result).toHaveProperty('duration_ms');
      expect(result.duration_ms).toBeTypeOf('number');
    });
  });
});
