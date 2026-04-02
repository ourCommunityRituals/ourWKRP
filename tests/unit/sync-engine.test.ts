/**
 * Unit tests — Sync engine
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the spotify client
vi.mock('../../src/spotify/client', () => ({
  getUserPlaylists: vi.fn(async () => [
    {
      id: 'playlist-1',
      name: 'Test Playlist',
      description: 'A test playlist',
      tracks: { total: 2 },
      snapshot_id: 'snap-1',
      images: [{ url: 'https://img.spotify.com/1' }],
      owner: { id: 'owner-1' },
    },
  ]),
  getPlaylistTracks: vi.fn(async () => [
    {
      track: {
        id: 'track-1',
        name: 'Test Song',
        artists: [{ id: 'artist-1', name: 'Test Artist' }],
        album: { name: 'Test Album', images: [{ url: 'https://img.spotify.com/album1' }] },
        duration_ms: 180000,
        preview_url: null,
      },
      added_at: '2024-01-01T00:00:00Z',
      added_by: { id: 'user-1' },
    },
  ]),
  getAudioFeatures: vi.fn(async () => [
    {
      id: 'track-1',
      energy: 0.8,
      danceability: 0.7,
      valence: 0.6,
      tempo: 120,
      acousticness: 0.2,
      instrumentalness: 0.1,
    },
  ]),
}));

// Mock kv-storage
vi.mock('../../src/lib/kv-storage', () => ({
  storeLastSync: vi.fn(),
}));

describe('Sync Engine', () => {
  it('exports syncContributor function', async () => {
    const { syncContributor } = await import('../../src/spotify/sync-engine');
    expect(typeof syncContributor).toBe('function');
  });

  it('syncs playlists, tracks, and audio features', async () => {
    const mockD1 = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn(async () => ({ success: true })),
          first: vi.fn(async () => null),
          all: vi.fn(async () => ({ results: [] })),
        })),
      })),
    };

    const mockKV = {
      put: vi.fn(),
      get: vi.fn(async () => null),
    };

    const mockEnv = {
      WKRP_DB: mockD1,
      WKRP_KV: mockKV,
    };

    const { syncContributor } = await import('../../src/spotify/sync-engine');
    const result = await syncContributor(
      mockEnv as never,
      'contributor-123',
      'test-access-token',
    );

    expect(result.playlists_synced).toBe(1);
    expect(result.tracks_synced).toBe(1);
    expect(result.audio_features_synced).toBe(1);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
