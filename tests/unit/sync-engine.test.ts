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
  getAudioFeatures: vi.fn(async () => ({
    features: [
      {
        id: 'track-1',
        energy: 0.8,
        danceability: 0.7,
        valence: 0.6,
        tempo: 120,
        acousticness: 0.2,
        instrumentalness: 0.1,
      },
    ],
    status: 'ok',
  })),
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
    const result = await syncContributor(
      mockEnv as never,
      'contributor-123',
      'test-access-token',
    );

    expect(result.playlists_synced).toBe(1);
    expect(result.tracks_synced).toBe(1);
    expect(result.audio_features_synced).toBe(1);
    expect(result.contributions_created).toBe(1);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

// Where: a sync whose audio-features stage does not fully succeed
describe('audio-features stage outcome (OW-120)', () => {
  // Who: syncContributor
  function mockEnv() {
    const mockD1 = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          run: vi.fn(async () => ({ success: true })),
          first: vi.fn(async () => null),
          all: vi.fn(async () => ({ results: [] })),
        })),
      })),
      batch: vi.fn(async (stmts: unknown[]) => stmts.map(() => ({ success: true }))),
    };
    return { WKRP_DB: mockD1, WKRP_KV: { put: vi.fn(), get: vi.fn(async () => null) } };
  }

  it('records audio_features_status "ok" when every batch returns', async () => {
    const { syncContributor } = await import('../../src/spotify/sync-engine');
    const result = await syncContributor(mockEnv() as never, 'contributor-123', 'token');

    expect(result.audio_features_status).toBe('ok');
  });

  it('records audio_features_status "unavailable" when the stage returns nothing (OW-120)', async () => {
    const client = await import('../../src/spotify/client');
    vi.mocked(client.getAudioFeatures).mockResolvedValueOnce({
      features: [],
      status: 'unavailable',
    });

    const { syncContributor } = await import('../../src/spotify/sync-engine');
    const result = await syncContributor(mockEnv() as never, 'contributor-123', 'token');

    // Playlists and tracks still persisted — only the features stage degraded.
    expect(result.tracks_synced).toBe(1);
    expect(result.audio_features_synced).toBe(0);
    expect(result.audio_features_status).toBe('unavailable');
  });

  it('records audio_features_status "partial" when only some batches returned (OW-120)', async () => {
    const client = await import('../../src/spotify/client');
    vi.mocked(client.getAudioFeatures).mockResolvedValueOnce({
      features: [
        {
          id: 'track-1',
          energy: 0.8,
          danceability: 0.7,
          valence: 0.6,
          tempo: 120,
          acousticness: 0.2,
          instrumentalness: 0.1,
        },
      ],
      status: 'partial',
    });

    const { syncContributor } = await import('../../src/spotify/sync-engine');
    const result = await syncContributor(mockEnv() as never, 'contributor-123', 'token');

    expect(result.audio_features_synced).toBe(1);
    expect(result.audio_features_status).toBe('partial');
  });

  it('falls back to "unavailable" when the features stage throws (regression)', async () => {
    const client = await import('../../src/spotify/client');
    vi.mocked(client.getAudioFeatures).mockRejectedValueOnce(new Error('network down'));

    const { syncContributor } = await import('../../src/spotify/sync-engine');
    const result = await syncContributor(mockEnv() as never, 'contributor-123', 'token');

    // The whole sync still resolves — a features failure is not a sync failure.
    expect(result.tracks_synced).toBe(1);
    expect(result.audio_features_status).toBe('unavailable');
  });
});
