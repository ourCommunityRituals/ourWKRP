/**
 * Unit tests — POST /spotify/sync/:userId response honesty (OW-120)
 *
 * The sync response used to claim "synced successfully" even when the
 * audio-features stage returned nothing. Playlists and tracks really do
 * persist, so ok stays true — but the response has to say which stage did not
 * run.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { SyncResult } from '../../src/spotify/sync-engine';

vi.mock('../../src/spotify/sync-engine', () => ({
  syncContributor: vi.fn(),
}));

vi.mock('../../src/auth/token-refresh', () => ({
  getValidAccessToken: vi.fn(async () => 'access-token'),
}));

vi.mock('../../src/lib/kv-storage', () => ({
  getSession: vi.fn(async () => ({ userId: 'contributor-1234567890' })),
  getLastSync: vi.fn(async () => null),
}));

const USER_ID = 'contributor-1234567890';

function syncRequest(): Request {
  return new Request(`https://ourwkrp.com/spotify/sync/${USER_ID}`, {
    method: 'POST',
    headers: { Cookie: 'wkrp_session=session-token' },
  });
}

function mockEnv() {
  return {
    WKRP_KV: { get: vi.fn(async () => null), put: vi.fn() },
    WKRP_DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({ id: USER_ID, name: 'Matt' })),
          run: vi.fn(async () => ({ success: true })),
          all: vi.fn(async () => ({ results: [] })),
        })),
      })),
    },
  } as never;
}

function syncResult(overrides: Partial<SyncResult>): SyncResult {
  return {
    playlists_synced: 5,
    playlists_skipped: 0,
    tracks_synced: 150,
    audio_features_synced: 148,
    audio_features_status: 'ok',
    contributions_created: 150,
    duration_ms: 3200,
    ...overrides,
  };
}

interface SyncBody {
  ok: boolean;
  message: string;
  audio_features_status: string;
  sync: SyncResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================
// Where: a sync whose playlists and tracks persisted
// ============================================
describe('sync response when the audio-features stage degrades (OW-120)', () => {
  describe('handleSync', () => {
    test('reports success plainly when every stage ran', async () => {
      const { syncContributor } = await import('../../src/spotify/sync-engine');
      vi.mocked(syncContributor).mockResolvedValue(syncResult({}));

      const { handleSync } = await import('../../src/handlers/sync');
      const res = await handleSync(syncRequest(), mockEnv());
      const body = await res.json() as SyncBody;

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.audio_features_status).toBe('ok');
      expect(body.message).toContain('synced successfully');
    });

    test('keeps ok true but says features are unavailable when the stage returned nothing (OW-120)', async () => {
      const { syncContributor } = await import('../../src/spotify/sync-engine');
      vi.mocked(syncContributor).mockResolvedValue(
        syncResult({ audio_features_synced: 0, audio_features_status: 'unavailable' }),
      );

      const { handleSync } = await import('../../src/handlers/sync');
      const res = await handleSync(syncRequest(), mockEnv());
      const body = await res.json() as SyncBody;

      // Playlists and tracks did persist — this is not a failed sync.
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.sync.tracks_synced).toBe(150);
      // ...but the user is not told the features stage worked.
      expect(body.message).not.toContain('synced successfully');
      expect(body.message).toContain('Audio features unavailable for this Spotify app.');
      expect(body.audio_features_status).toBe('unavailable');
    });

    test('says some features are missing when the stage partly succeeded (OW-120)', async () => {
      const { syncContributor } = await import('../../src/spotify/sync-engine');
      vi.mocked(syncContributor).mockResolvedValue(
        syncResult({ audio_features_synced: 60, audio_features_status: 'partial' }),
      );

      const { handleSync } = await import('../../src/handlers/sync');
      const res = await handleSync(syncRequest(), mockEnv());
      const body = await res.json() as SyncBody;

      expect(body.ok).toBe(true);
      expect(body.message).not.toContain('synced successfully');
      expect(body.message).toContain('Some audio features could not be fetched.');
      expect(body.audio_features_status).toBe('partial');
    });

    test('echoes the stage status inside sync as well as at the top level (contract)', async () => {
      const { syncContributor } = await import('../../src/spotify/sync-engine');
      vi.mocked(syncContributor).mockResolvedValue(
        syncResult({ audio_features_synced: 0, audio_features_status: 'unavailable' }),
      );

      const { handleSync } = await import('../../src/handlers/sync');
      const res = await handleSync(syncRequest(), mockEnv());
      const body = await res.json() as SyncBody;

      expect(body.sync.audio_features_status).toBe(body.audio_features_status);
    });
  });
});
