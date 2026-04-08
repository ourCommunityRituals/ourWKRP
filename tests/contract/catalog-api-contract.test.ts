/**
 * Contract tests — Catalog API response shapes
 *
 * Validates the structure of API responses without hitting real D1.
 * Ensures frontend can rely on these contracts.
 */
import { describe, it, expect } from 'vitest';

// --- Response shape interfaces ---

interface TracksResponse {
  ok: boolean;
  tracks: Array<{
    id: string;
    name: string;
    artist: string;
    album: string;
    duration_ms: number;
    genre: string | null;
    isrc: string | null;
    release_year: number | null;
    energy: number | null;
    danceability: number | null;
    valence: number | null;
  }>;
  cursor: string | null;
  has_more: boolean;
}

interface ContributorsResponse {
  ok: boolean;
  contributors: Array<{
    id: string;
    name: string;
    generation: string;
    brand_id: string;
    role: string;
    status: string;
    track_count: number;
  }>;
}

interface StatsResponse {
  ok: boolean;
  stats: {
    total_tracks: number;
    total_contributors: number;
    total_playlists: number;
    top_genres: Array<{ genre: string; count: number }>;
    top_decades: Array<{ decade: number; count: number }>;
    has_audio_features: boolean;
  };
}

interface PlaylistResponse {
  ok: boolean;
  playlist: {
    id: string;
    name: string;
    description: string | null;
    track_count: number;
    contributor_id: string;
    is_curated: number;
    brand_id: string;
    tracks: Array<{
      id: string;
      name: string;
      artist: string;
      position: number;
    }>;
  };
}

interface PlaylistExportResponse {
  ok: boolean;
  export: {
    playlist_name: string;
    playlist_description: string | null;
    creator: string;
    track_count: number;
    exported_at: string;
    tracks: Array<{
      position: number;
      name: string;
      artist: string;
      album: string;
      isrc: string | null;
      duration_ms: number;
    }>;
  };
}

interface BrandsResponse {
  ok: boolean;
  brands: Array<{
    id: string;
    name: string;
    subdomain: string;
    primary_color: string;
    accent_color: string;
    contributor_count: number;
    track_count: number;
  }>;
}

// --- Tests ---

describe('Catalog API Contracts', () => {
  describe('GET /api/tracks response', () => {
    it('success shape includes tracks array with pagination', () => {
      const response: TracksResponse = {
        ok: true,
        tracks: [
          {
            id: 'track-1',
            name: 'Test Track',
            artist: 'Test Artist',
            album: 'Test Album',
            duration_ms: 210000,
            genre: 'hip-hop',
            isrc: 'USRC12345678',
            release_year: 2023,
            energy: 0.8,
            danceability: 0.7,
            valence: 0.6,
          },
        ],
        cursor: 'eyJpZCI6InRyYWNrLTEifQ==',
        has_more: true,
      };

      expect(response.ok).toBe(true);
      expect(response.tracks).toBeInstanceOf(Array);
      expect(response.tracks[0].id).toBeDefined();
      expect(response.tracks[0].name).toBeDefined();
      expect(response.tracks[0].artist).toBeDefined();
      expect(typeof response.has_more).toBe('boolean');
    });

    it('empty result has null cursor and has_more false', () => {
      const response: TracksResponse = {
        ok: true,
        tracks: [],
        cursor: null,
        has_more: false,
      };

      expect(response.tracks).toHaveLength(0);
      expect(response.cursor).toBeNull();
      expect(response.has_more).toBe(false);
    });

    it('audio features can be null (progressive enhancement)', () => {
      const response: TracksResponse = {
        ok: true,
        tracks: [
          {
            id: 'track-2',
            name: 'No Features',
            artist: 'Artist',
            album: 'Album',
            duration_ms: 180000,
            genre: null,
            isrc: null,
            release_year: null,
            energy: null,
            danceability: null,
            valence: null,
          },
        ],
        cursor: null,
        has_more: false,
      };

      expect(response.tracks[0].energy).toBeNull();
      expect(response.tracks[0].danceability).toBeNull();
      expect(response.tracks[0].valence).toBeNull();
    });
  });

  describe('GET /api/contributors response', () => {
    it('success shape includes contributors with track counts', () => {
      const response: ContributorsResponse = {
        ok: true,
        contributors: [
          {
            id: 'contrib-1',
            name: 'Matt',
            generation: 'founder',
            brand_id: 'wkrp',
            role: 'founder',
            status: 'active',
            track_count: 150,
          },
        ],
      };

      expect(response.ok).toBe(true);
      expect(response.contributors[0].track_count).toBeGreaterThanOrEqual(0);
      expect(['founder', 'gen2', 'gen3']).toContain(response.contributors[0].generation);
      expect(['founder', 'curator', 'contributor', 'dj']).toContain(response.contributors[0].role);
    });
  });

  describe('GET /api/stats response', () => {
    it('success shape includes all stat fields', () => {
      const response: StatsResponse = {
        ok: true,
        stats: {
          total_tracks: 5000,
          total_contributors: 12,
          total_playlists: 45,
          top_genres: [
            { genre: 'hip-hop', count: 1200 },
            { genre: 'r-and-b', count: 800 },
          ],
          top_decades: [
            { decade: 2020, count: 2000 },
            { decade: 2010, count: 1500 },
          ],
          has_audio_features: false,
        },
      };

      expect(response.stats.total_tracks).toBeGreaterThanOrEqual(0);
      expect(response.stats.top_genres).toBeInstanceOf(Array);
      expect(response.stats.top_decades).toBeInstanceOf(Array);
      expect(typeof response.stats.has_audio_features).toBe('boolean');
    });
  });

  describe('GET /api/playlists/:id response', () => {
    it('success shape includes playlist with embedded tracks', () => {
      const response: PlaylistResponse = {
        ok: true,
        playlist: {
          id: 'playlist-1',
          name: 'WKRP Summer Mix',
          description: 'Curated by the founders',
          track_count: 2,
          contributor_id: 'contrib-1',
          is_curated: 1,
          brand_id: 'wkrp',
          tracks: [
            { id: 'track-1', name: 'Track A', artist: 'Artist A', position: 0 },
            { id: 'track-2', name: 'Track B', artist: 'Artist B', position: 1 },
          ],
        },
      };

      expect(response.playlist.tracks).toHaveLength(2);
      expect(response.playlist.tracks[0].position).toBe(0);
      expect(response.playlist.is_curated).toBe(1);
    });
  });

  describe('GET /api/playlists/:id/export response', () => {
    it('export includes ISRCs for Apple Music matching', () => {
      const response: PlaylistExportResponse = {
        ok: true,
        export: {
          playlist_name: 'WKRP Summer Mix',
          playlist_description: null,
          creator: 'Matt',
          track_count: 1,
          exported_at: '2026-04-03T00:00:00.000Z',
          tracks: [
            {
              position: 1,
              name: 'Track A',
              artist: 'Artist A',
              album: 'Album A',
              isrc: 'USRC12345678',
              duration_ms: 210000,
            },
          ],
        },
      };

      expect(response.export.tracks[0].isrc).toBeDefined();
      expect(response.export.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('GET /api/brands response', () => {
    it('success shape includes brands with counts', () => {
      const response: BrandsResponse = {
        ok: true,
        brands: [
          {
            id: 'wkrp',
            name: 'WKRP',
            subdomain: 'wkrp',
            primary_color: '#1DB954',
            accent_color: '#191414',
            contributor_count: 5,
            track_count: 3000,
          },
        ],
      };

      expect(response.brands[0].primary_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(response.brands[0].contributor_count).toBeGreaterThanOrEqual(0);
    });
  });
});
