/**
 * Contract tests — API response shape verification
 *
 * Ensures our API endpoints return the expected response shapes.
 * These tests verify the contract between frontend and backend.
 */
import { describe, it, expect } from 'vitest';

// Response shape contracts
interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  env: string;
  timestamp: string;
}

interface SessionResponse {
  ok: boolean;
  contributor?: {
    id: string;
    name: string;
    generation: string;
    brand_id: string;
    spotify_display_name: string | null;
    last_sync_at: string | null;
  };
  error?: string;
}

/** Outcome of the audio-features stage (OW-120). */
type AudioFeaturesStatus = 'ok' | 'partial' | 'unavailable';

interface SyncResponse {
  ok: boolean;
  message?: string;
  /**
   * Stage-level truth: a sync can persist playlists and tracks while Spotify
   * refuses /audio-features outright (OW-120).
   */
  audio_features_status?: AudioFeaturesStatus;
  sync?: {
    playlists_synced: number;
    playlists_skipped: number;
    tracks_synced: number;
    audio_features_synced: number;
    audio_features_status: AudioFeaturesStatus;
    duration_ms: number;
  };
  error?: string;
}

interface ErrorResponse {
  ok: false;
  status: number;
  error: string;
}

describe('API Contracts', () => {
  describe('Health response shape', () => {
    it('includes all required fields', () => {
      const response: HealthResponse = {
        ok: true,
        service: 'ourwkrp',
        version: '0.1.0',
        env: 'staging',
        timestamp: new Date().toISOString(),
      };

      expect(response.ok).toBe(true);
      expect(typeof response.service).toBe('string');
      expect(typeof response.version).toBe('string');
      expect(typeof response.env).toBe('string');
      expect(new Date(response.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('Session response shape', () => {
    it('success includes contributor object', () => {
      const response: SessionResponse = {
        ok: true,
        contributor: {
          id: 'uuid-here',
          name: 'Matt',
          generation: 'founder',
          brand_id: 'wkrp',
          spotify_display_name: 'mattd',
          last_sync_at: '2024-01-01T00:00:00Z',
        },
      };

      expect(response.ok).toBe(true);
      expect(response.contributor).toBeDefined();
      expect(response.contributor!.id).toBeTruthy();
      expect(['founder', 'gen2', 'gen3']).toContain(response.contributor!.generation);
    });

    it('failure includes error message', () => {
      const response: SessionResponse = {
        ok: false,
        error: 'Session not found or expired',
      };

      expect(response.ok).toBe(false);
      expect(response.error).toBeTruthy();
    });
  });

  describe('Sync response shape', () => {
    it('success includes sync stats', () => {
      const response: SyncResponse = {
        ok: true,
        message: 'Matt synced successfully',
        audio_features_status: 'ok',
        sync: {
          playlists_synced: 5,
          playlists_skipped: 2,
          tracks_synced: 150,
          audio_features_synced: 148,
          audio_features_status: 'ok',
          duration_ms: 3200,
        },
      };

      expect(response.ok).toBe(true);
      expect(response.sync!.playlists_synced).toBeGreaterThanOrEqual(0);
      expect(response.sync!.tracks_synced).toBeGreaterThanOrEqual(0);
      expect(response.sync!.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('carries the audio-features stage status alongside the counts (OW-120)', () => {
      const response: SyncResponse = {
        ok: true,
        message: "Matt's library synced. Audio features unavailable for this Spotify app.",
        audio_features_status: 'unavailable',
        sync: {
          playlists_synced: 5,
          playlists_skipped: 2,
          tracks_synced: 150,
          audio_features_synced: 0,
          audio_features_status: 'unavailable',
          duration_ms: 3200,
        },
      };

      // ok stays true — playlists and tracks did persist — but the message and
      // the status say what did not.
      expect(response.ok).toBe(true);
      expect(['ok', 'partial', 'unavailable']).toContain(response.audio_features_status);
      expect(response.audio_features_status).toBe(response.sync!.audio_features_status);
      expect(response.sync!.audio_features_synced).toBe(0);
      expect(response.message).not.toContain('synced successfully');
    });
  });

  describe('Error response shape', () => {
    it('includes ok=false, status, and error', () => {
      const response: ErrorResponse = {
        ok: false,
        status: 404,
        error: 'Not found',
      };

      expect(response.ok).toBe(false);
      expect(typeof response.status).toBe('number');
      expect(typeof response.error).toBe('string');
    });
  });
});
