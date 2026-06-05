/**
 * Unit tests — Playlist Builder (WKRP-7 MVP)
 * Tests handler logic for create, get, add/remove tracks, and export.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock kv-storage
const mockGetSession = vi.fn();
vi.mock('../../src/lib/kv-storage', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  // validateSession touches/backfills sessions via storeSession on read.
  storeSession: vi.fn(),
  deleteSession: vi.fn(),
}));

// Mock session-cookie
const mockGetSessionToken = vi.fn();
vi.mock('../../src/lib/session-cookie', () => ({
  getSessionToken: (...args: unknown[]) => mockGetSessionToken(...args),
}));

// Mock brand extraction
vi.mock('../../src/lib/brand', () => ({
  extractBrandId: () => 'wkrp',
}));

// Mock logger
vi.mock('../../src/lib/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  redact: (v: unknown) => v,
}));

import {
  handleCreatePlaylist,
  handleGetPlaylist,
  handleAddPlaylistTracks,
  handleRemovePlaylistTracks,
  handleExportPlaylist,
} from '../../src/handlers/playlist';

// --- Mock D1 + KV ---

function makeRequest(path: string, method = 'GET', body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { Cookie: 'wkrp_session=test-token' },
  };
  if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  return new Request(`http://localhost:8787${path}`, init);
}

function mockDB(overrides: Record<string, unknown> = {}) {
  const defaultPrepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(() => null),
      all: vi.fn(() => ({ results: [] })),
      run: vi.fn(() => ({})),
    })),
  }));
  return {
    prepare: overrides.prepare || defaultPrepare,
    batch: overrides.batch || vi.fn(() => []),
  };
}

const mockEnv = {
  WKRP_KV: {} as KVNamespace,
  WKRP_DB: mockDB(),
  SPOTIFY_CLIENT_ID: 'test-id',
  SPOTIFY_REDIRECT_URI: 'http://localhost:8787/auth/callback',
  APP_URL: 'http://localhost:8787',
} as unknown;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionToken.mockReturnValue('test-token');
});

describe('Playlist Builder', () => {
  describe('handleCreatePlaylist', () => {
    it('rejects unauthenticated requests', async () => {
      mockGetSessionToken.mockReturnValue(null);

      const req = makeRequest('/api/playlists', 'POST', { name: 'My Mix' });
      const res = await handleCreatePlaylist(req, mockEnv as never);

      expect(res.status).toBe(401);
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(false);
    });

    it('rejects expired sessions', async () => {
      mockGetSessionToken.mockReturnValue('expired-token');
      mockGetSession.mockResolvedValue(null);

      const req = makeRequest('/api/playlists', 'POST', { name: 'My Mix' });
      const res = await handleCreatePlaylist(req, mockEnv as never);

      expect(res.status).toBe(401);
    });

    it('rejects non-founder/curator roles', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'gen3', brand_id: 'wkrp' });

      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'user1', role: 'contributor' })),
          all: vi.fn(() => ({ results: [] })),
          run: vi.fn(),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists', 'POST', { name: 'My Mix' });
      const res = await handleCreatePlaylist(req, env as never);

      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/founders.*curators|curators.*DJs/);
    });

    it('rejects missing name', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'founder', brand_id: 'wkrp' });

      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'user1', role: 'founder' })),
          all: vi.fn(() => ({ results: [] })),
          run: vi.fn(),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists', 'POST', {});
      const res = await handleCreatePlaylist(req, env as never);

      expect(res.status).toBe(400);
    });

    it('rejects names over 200 characters', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'founder', brand_id: 'wkrp' });

      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'user1', role: 'founder' })),
          all: vi.fn(() => ({ results: [] })),
          run: vi.fn(),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists', 'POST', { name: 'A'.repeat(201) });
      const res = await handleCreatePlaylist(req, env as never);

      expect(res.status).toBe(400);
    });

    it('rejects invalid JSON body', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'founder', brand_id: 'wkrp' });

      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'user1', role: 'founder' })),
          all: vi.fn(() => ({ results: [] })),
          run: vi.fn(),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = new Request('http://localhost:8787/api/playlists', {
        method: 'POST',
        headers: { Cookie: 'wkrp_session=test-token', 'Content-Type': 'text/plain' },
        body: 'not json',
      });
      const res = await handleCreatePlaylist(req, env as never);

      expect(res.status).toBe(400);
    });

    it('creates playlist for founder role', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'founder', brand_id: 'wkrp' });

      const mockRun = vi.fn();
      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'user1', role: 'founder' })),
          all: vi.fn(() => ({ results: [] })),
          run: mockRun,
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists', 'POST', { name: 'Summer Jams', description: 'Hot tracks' });
      const res = await handleCreatePlaylist(req, env as never);

      expect(res.status).toBe(201);
      const body = await res.json() as { ok: boolean; playlist: { name: string; description: string } };
      expect(body.ok).toBe(true);
      expect(body.playlist.name).toBe('Summer Jams');
      expect(body.playlist.description).toBe('Hot tracks');
    });

    it('creates playlist for curator role', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'gen2', brand_id: 'wkrp' });

      const mockRun = vi.fn();
      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'user1', role: 'curator' })),
          all: vi.fn(() => ({ results: [] })),
          run: mockRun,
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists', 'POST', { name: 'Curator Pick' });
      const res = await handleCreatePlaylist(req, env as never);

      expect(res.status).toBe(201);
    });
  });

  describe('handleGetPlaylist', () => {
    it('returns 404 for non-existent playlist', async () => {
      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => null),
          all: vi.fn(() => ({ results: [] })),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists/fake-id');
      const res = await handleGetPlaylist(req, env as never, 'fake-id');

      expect(res.status).toBe(404);
    });

    it('returns playlist with embedded tracks', async () => {
      let callCount = 0;
      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => {
            if (callCount++ === 0) {
              return { id: 'pl1', name: 'Test Playlist', track_count: 2, creator_name: 'Matt' };
            }
            return null;
          }),
          all: vi.fn(() => ({
            results: [
              { id: 't1', name: 'Track 1', artist: 'Artist 1', position: 0 },
              { id: 't2', name: 'Track 2', artist: 'Artist 2', position: 1 },
            ],
          })),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists/pl1');
      const res = await handleGetPlaylist(req, env as never, 'pl1');

      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; playlist: { tracks: unknown[] } };
      expect(body.ok).toBe(true);
      expect(body.playlist.tracks).toHaveLength(2);
    });
  });

  describe('handleAddPlaylistTracks', () => {
    it('rejects unauthenticated requests', async () => {
      mockGetSessionToken.mockReturnValue(null);

      const req = makeRequest('/api/playlists/pl1/tracks', 'POST', { track_ids: ['t1'] });
      const res = await handleAddPlaylistTracks(req, mockEnv as never, 'pl1');

      expect(res.status).toBe(401);
    });

    it('rejects empty track_ids', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'founder', brand_id: 'wkrp' });

      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'pl1', contributor_id: 'user1', track_count: 0 })),
          all: vi.fn(() => ({ results: [] })),
          run: vi.fn(),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists/pl1/tracks', 'POST', { track_ids: [] });
      const res = await handleAddPlaylistTracks(req, env as never, 'pl1');

      expect(res.status).toBe(400);
    });

    it('rejects more than 100 tracks', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'founder', brand_id: 'wkrp' });

      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'pl1', contributor_id: 'user1', track_count: 0 })),
          all: vi.fn(() => ({ results: [] })),
          run: vi.fn(),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const ids = Array.from({ length: 101 }, (_, i) => `t${i}`);
      const req = makeRequest('/api/playlists/pl1/tracks', 'POST', { track_ids: ids });
      const res = await handleAddPlaylistTracks(req, env as never, 'pl1');

      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/100/);
    });

    it('rejects if playlist not owned by user', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'founder', brand_id: 'wkrp' });

      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'pl1', contributor_id: 'other-user', track_count: 5 })),
          all: vi.fn(() => ({ results: [] })),
          run: vi.fn(),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists/pl1/tracks', 'POST', { track_ids: ['t1'] });
      const res = await handleAddPlaylistTracks(req, env as never, 'pl1');

      expect(res.status).toBe(403);
    });

    it('adds tracks to owned playlist', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'founder', brand_id: 'wkrp' });

      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'pl1', contributor_id: 'user1', track_count: 0 })),
          all: vi.fn(() => ({ results: [] })),
          run: vi.fn(),
        })),
      }));
      const mockBatch = vi.fn(() => []);

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: mockBatch } };
      const req = makeRequest('/api/playlists/pl1/tracks', 'POST', { track_ids: ['t1', 't2'] });
      const res = await handleAddPlaylistTracks(req, env as never, 'pl1');

      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; added: number };
      expect(body.ok).toBe(true);
      expect(body.added).toBe(2);
      expect(mockBatch).toHaveBeenCalled();
    });
  });

  describe('handleRemovePlaylistTracks', () => {
    it('rejects if not playlist owner', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'founder', brand_id: 'wkrp' });

      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'pl1', contributor_id: 'other-user', track_count: 5 })),
          all: vi.fn(() => ({ results: [] })),
          run: vi.fn(),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists/pl1/tracks', 'DELETE', { track_ids: ['t1'] });
      const res = await handleRemovePlaylistTracks(req, env as never, 'pl1');

      expect(res.status).toBe(403);
    });

    it('removes tracks from owned playlist', async () => {
      mockGetSession.mockResolvedValue({ userId: 'user1', name: 'Test', gen: 'founder', brand_id: 'wkrp' });

      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => ({ id: 'pl1', contributor_id: 'user1', track_count: 3 })),
          all: vi.fn(() => ({ results: [] })),
          run: vi.fn(),
        })),
      }));
      const mockBatch = vi.fn(() => []);

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: mockBatch } };
      const req = makeRequest('/api/playlists/pl1/tracks', 'DELETE', { track_ids: ['t1'] });
      const res = await handleRemovePlaylistTracks(req, env as never, 'pl1');

      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; removed: number };
      expect(body.ok).toBe(true);
      expect(body.removed).toBe(1);
    });
  });

  describe('handleExportPlaylist', () => {
    it('returns 404 for non-existent playlist', async () => {
      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => null),
          all: vi.fn(() => ({ results: [] })),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists/fake-id/export');
      const res = await handleExportPlaylist(req, env as never, 'fake-id');

      expect(res.status).toBe(404);
    });

    it('exports playlist with ISRCs', async () => {
      let callCount = 0;
      const prepare = vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(() => {
            if (callCount++ === 0) {
              return { id: 'pl1', name: 'Export Test', description: 'For Apple Music', creator_name: 'Matt' };
            }
            return null;
          }),
          all: vi.fn(() => ({
            results: [
              { name: 'Song A', artist: 'Artist A', album: 'Album A', isrc: 'USRC12345678', duration_ms: 240000, position: 0 },
              { name: 'Song B', artist: 'Artist B', album: 'Album B', isrc: null, duration_ms: 180000, position: 1 },
            ],
          })),
        })),
      }));

      const env = { ...mockEnv, WKRP_DB: { prepare, batch: vi.fn() } };
      const req = makeRequest('/api/playlists/pl1/export');
      const res = await handleExportPlaylist(req, env as never, 'pl1');

      expect(res.status).toBe(200);
      const body = await res.json() as {
        ok: boolean;
        export: {
          playlist_name: string;
          creator: string;
          track_count: number;
          exported_at: string;
          tracks: Array<{ isrc: string | null; position: number }>;
        };
      };
      expect(body.ok).toBe(true);
      expect(body.export.playlist_name).toBe('Export Test');
      expect(body.export.creator).toBe('Matt');
      expect(body.export.track_count).toBe(2);
      expect(body.export.exported_at).toBeTruthy();
      expect(body.export.tracks[0].isrc).toBe('USRC12345678');
      expect(body.export.tracks[1].isrc).toBeNull();
      expect(body.export.tracks[0].position).toBe(1);
      expect(body.export.tracks[1].position).toBe(2);
    });
  });
});
