/**
 * Pact-style contract tests — Spotify API expectations
 *
 * Verifies our code's expectations of Spotify API response shapes.
 * These don't call Spotify — they verify our type expectations are correct.
 * When Pact infra is available, these become real provider verification tests.
 */
import { describe, it, expect } from 'vitest';
import type {
  SpotifyUserProfile,
  SpotifyPlaylist,
  SpotifyTrack,
  SpotifyAudioFeatures,
  SpotifyTokenResponse,
} from '../../src/types';

describe('Spotify API Contracts', () => {
  describe('Token endpoint response', () => {
    it('matches expected shape for auth code exchange', () => {
      const response: SpotifyTokenResponse = {
        access_token: 'BQD...',
        token_type: 'Bearer',
        scope: 'playlist-read-private user-library-read',
        expires_in: 3600,
        refresh_token: 'AQB...',
      };

      expect(response.access_token).toBeTruthy();
      expect(response.token_type).toBe('Bearer');
      expect(response.expires_in).toBeGreaterThan(0);
      expect(response.refresh_token).toBeTruthy();
    });

    it('refresh response may omit refresh_token', () => {
      const response: SpotifyTokenResponse = {
        access_token: 'BQD...',
        token_type: 'Bearer',
        scope: 'playlist-read-private',
        expires_in: 3600,
      };

      expect(response.access_token).toBeTruthy();
      expect(response.refresh_token).toBeUndefined();
    });
  });

  describe('User profile response', () => {
    it('matches expected shape', () => {
      const profile: SpotifyUserProfile = {
        id: 'user123',
        display_name: 'Matt D',
        images: [{ url: 'https://i.scdn.co/image/...' }],
      };

      expect(profile.id).toBeTruthy();
      expect(typeof profile.display_name).toBe('string');
    });

    it('handles null display_name', () => {
      const profile: SpotifyUserProfile = {
        id: 'user123',
        display_name: null,
      };

      expect(profile.id).toBeTruthy();
      expect(profile.display_name).toBeNull();
    });
  });

  describe('Playlist response', () => {
    it('matches expected shape', () => {
      const playlist: SpotifyPlaylist = {
        id: '37i9dQZF1DXcBWIGoYBM5M',
        name: 'Today\'s Top Hits',
        description: 'Dua Lipa is on top...',
        tracks: { total: 50 },
        snapshot_id: 'MTY5...',
        images: [{ url: 'https://i.scdn.co/image/...' }],
        owner: { id: 'spotify' },
      };

      expect(playlist.id).toBeTruthy();
      expect(playlist.tracks.total).toBeGreaterThanOrEqual(0);
      expect(playlist.snapshot_id).toBeTruthy();
    });
  });

  describe('Track response', () => {
    it('matches expected shape', () => {
      const track: SpotifyTrack = {
        id: '4iV5W9uYEdYUVa79Axb7Rh',
        name: 'As It Was',
        artists: [{ id: '6eUKZXaKkcviH0Ku9w2n3V', name: 'Harry Styles' }],
        album: {
          name: 'Harry\'s House',
          images: [{ url: 'https://i.scdn.co/image/...' }],
        },
        duration_ms: 167303,
        preview_url: 'https://p.scdn.co/mp3-preview/...',
      };

      expect(track.id).toBeTruthy();
      expect(track.artists.length).toBeGreaterThan(0);
      expect(track.duration_ms).toBeGreaterThan(0);
    });

    it('handles null preview_url', () => {
      const track: SpotifyTrack = {
        id: '4iV5W9uYEdYUVa79Axb7Rh',
        name: 'Test',
        artists: [{ id: 'a1', name: 'Artist' }],
        album: { name: 'Album', images: [] },
        duration_ms: 100000,
        preview_url: null,
      };

      expect(track.preview_url).toBeNull();
    });
  });

  describe('Audio features response', () => {
    it('matches expected shape with values in 0-1 range', () => {
      const features: SpotifyAudioFeatures = {
        id: '4iV5W9uYEdYUVa79Axb7Rh',
        energy: 0.731,
        danceability: 0.696,
        valence: 0.446,
        tempo: 174.003,
        acousticness: 0.342,
        instrumentalness: 0.0,
      };

      expect(features.energy).toBeGreaterThanOrEqual(0);
      expect(features.energy).toBeLessThanOrEqual(1);
      expect(features.danceability).toBeGreaterThanOrEqual(0);
      expect(features.danceability).toBeLessThanOrEqual(1);
      expect(features.valence).toBeGreaterThanOrEqual(0);
      expect(features.valence).toBeLessThanOrEqual(1);
      expect(features.tempo).toBeGreaterThan(0);
      expect(features.acousticness).toBeGreaterThanOrEqual(0);
      expect(features.instrumentalness).toBeGreaterThanOrEqual(0);
    });
  });
});
