/**
 * Performance tests — Sync benchmark
 *
 * Tests that sync operations complete within acceptable time bounds.
 * Uses mocked Spotify responses to isolate Worker performance.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock spotify client with realistic response sizes
vi.mock('../../src/spotify/client', () => ({
  getUserPlaylists: vi.fn(async () => {
    // Simulate 20 playlists
    return Array.from({ length: 20 }, (_, i) => ({
      id: `playlist-${i}`,
      name: `Playlist ${i}`,
      description: `Description ${i}`,
      tracks: { total: 50 },
      snapshot_id: `snap-${i}-${Date.now()}`,
      images: [{ url: `https://img.spotify.com/${i}` }],
      owner: { id: 'owner-1' },
    }));
  }),
  getPlaylistTracks: vi.fn(async () => {
    // Simulate 50 tracks per playlist
    return Array.from({ length: 50 }, (_, i) => ({
      track: {
        id: `track-${i}-${Math.random().toString(36).substring(7)}`,
        name: `Track ${i}`,
        artists: [{ id: `artist-${i}`, name: `Artist ${i}` }],
        album: {
          name: `Album ${i}`,
          images: [{ url: `https://img.spotify.com/album-${i}` }],
        },
        duration_ms: 180000 + i * 1000,
        preview_url: null,
      },
      added_at: new Date().toISOString(),
      added_by: { id: 'user-1' },
    }));
  }),
  getAudioFeatures: vi.fn(async (trackIds: string[]) => ({
    features: trackIds.map((id) => ({
      id,
      energy: Math.random(),
      danceability: Math.random(),
      valence: Math.random(),
      tempo: 80 + Math.random() * 100,
      acousticness: Math.random(),
      instrumentalness: Math.random(),
    })),
    status: 'ok' as const,
  })),
}));

vi.mock('../../src/lib/kv-storage', () => ({
  storeLastSync: vi.fn(),
}));

describe('Sync Performance', () => {
  it('sync engine processes 20 playlists x 50 tracks in under 5 seconds', async () => {
    const mockD1 = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn(async () => ({ success: true })),
          all: vi.fn(async () => ({ results: [] })),
        })),
      })),
      batch: vi.fn(async (stmts: unknown[]) => stmts.map(() => ({ success: true }))),
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

    const start = performance.now();
    const result = await syncContributor(
      mockEnv as never,
      'perf-test-user',
      'test-token',
    );
    const elapsed = performance.now() - start;

    console.log(`Sync performance: ${result.playlists_synced} playlists, ${result.tracks_synced} tracks in ${elapsed.toFixed(0)}ms`);

    expect(result.playlists_synced).toBe(20);
    expect(result.tracks_synced).toBe(1000); // 20 * 50
    expect(elapsed).toBeLessThan(5000); // Under 5 seconds
  });
});
