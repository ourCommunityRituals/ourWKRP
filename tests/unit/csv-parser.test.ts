import { describe, it, expect } from 'vitest';
import {
  detectFormat,
  parseCsvRows,
  parseExportifyCsv,
  parseLastfmCsv,
  parseAppleMusicCsv,
  parseCsv,
  MAX_ROWS,
  MAX_LINE_LENGTH,
  MAX_FIELDS_PER_ROW,
} from '../../src/import/csv-parser';

describe('CSV Parser', () => {
  describe('detectFormat', () => {
    it('detects Exportify by Spotify URI header', () => {
      expect(detectFormat(['Spotify URI', 'Track Name', 'Artist Name(s)'])).toBe('exportify');
    });

    it('detects Exportify by Track URI header', () => {
      expect(detectFormat(['Track URI', 'Track Name', 'ISRC'])).toBe('exportify');
    });

    it('detects Last.fm by uts header', () => {
      expect(detectFormat(['artist', 'album', 'track', 'uts'])).toBe('lastfm');
    });

    it('detects Last.fm by artist+track without album name', () => {
      expect(detectFormat(['artist', 'track', 'date'])).toBe('lastfm');
    });

    it('detects Apple Music by content type header', () => {
      expect(detectFormat(['Name', 'Artist', 'Album', 'Content Type'])).toBe('apple_music');
    });

    it('returns unknown for unrecognized headers', () => {
      expect(detectFormat(['foo', 'bar', 'baz'])).toBe('unknown');
    });
  });

  describe('parseCsvRows', () => {
    it('parses simple CSV', () => {
      const rows = parseCsvRows('a,b,c\n1,2,3');
      expect(rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    });

    it('handles quoted fields with commas', () => {
      const rows = parseCsvRows('name,artist\n"Hello, World","Artist, The"');
      expect(rows[1]).toEqual(['Hello, World', 'Artist, The']);
    });

    it('handles escaped quotes', () => {
      const rows = parseCsvRows('name\n"Say ""Hello"""');
      expect(rows[1]).toEqual(['Say "Hello"']);
    });

    it('skips empty lines', () => {
      const rows = parseCsvRows('a,b\n\n1,2\n\n');
      expect(rows).toEqual([['a', 'b'], ['1', '2']]);
    });

    it('caps the number of rows to bound hostile input', () => {
      const line = 'a,b,c';
      const csv = Array.from({ length: MAX_ROWS + 50 }, () => line).join('\n');
      const rows = parseCsvRows(csv);
      expect(rows.length).toBe(MAX_ROWS);
    });

    it('drops pathologically long lines instead of building them', () => {
      const longLine = 'x'.repeat(MAX_LINE_LENGTH + 1);
      const rows = parseCsvRows(`a,b\n${longLine}\n1,2`);
      expect(rows).toEqual([['a', 'b'], ['1', '2']]);
    });

    it('caps the number of fields per row', () => {
      const manyFields = Array.from({ length: MAX_FIELDS_PER_ROW + 100 }, (_, i) => String(i)).join(',');
      const rows = parseCsvRows(manyFields);
      expect(rows[0].length).toBeLessThanOrEqual(MAX_FIELDS_PER_ROW);
    });
  });

  describe('parseExportifyCsv', () => {
    const headers = ['Spotify URI', 'Track Name', 'Artist Name(s)', 'Album Name', 'ISRC', 'Energy', 'Danceability', 'Album Release Date'];

    it('parses tracks with audio features', () => {
      const rows = [
        headers,
        ['spotify:track:abc123', 'Bohemian Rhapsody', 'Queen', 'A Night at the Opera', 'GBAYE0601498', '0.4', '0.3', '1975-10-31'],
      ];
      const tracks = parseExportifyCsv(rows, 'liked');
      expect(tracks).toHaveLength(1);
      expect(tracks[0].name).toBe('Bohemian Rhapsody');
      expect(tracks[0].artist).toBe('Queen');
      expect(tracks[0].isrc).toBe('GBAYE0601498');
      expect(tracks[0].energy).toBe(0.4);
      expect(tracks[0].danceability).toBe(0.3);
      expect(tracks[0].platform_id).toBe('abc123');
      expect(tracks[0].platform_uri).toBe('spotify:track:abc123');
    });

    it('sets source_type and source_name', () => {
      const rows = [headers, ['spotify:track:abc', 'Song', 'Artist', 'Album', '', '', '', '']];
      const tracks = parseExportifyCsv(rows, 'created_playlist', 'My Playlist');
      expect(tracks[0].source_type).toBe('created_playlist');
      expect(tracks[0].source_name).toBe('My Playlist');
    });

    it('skips rows with missing name or artist', () => {
      const rows = [headers, ['spotify:track:abc', '', 'Artist', 'Album', '', '', '', '']];
      expect(parseExportifyCsv(rows, 'liked')).toHaveLength(0);
    });

    it('returns empty for header-only CSV', () => {
      expect(parseExportifyCsv([headers], 'liked')).toHaveLength(0);
    });
  });

  describe('parseLastfmCsv', () => {
    it('parses scrobbles and aggregates play counts', () => {
      const rows = [
        ['artist', 'album', 'track', 'date'],
        ['Radiohead', 'OK Computer', 'Paranoid Android', '2024-01-01'],
        ['Radiohead', 'OK Computer', 'Paranoid Android', '2024-01-15'],
        ['Radiohead', 'OK Computer', 'Paranoid Android', '2024-02-01'],
        ['Fela Kuti', 'Zombie', 'Zombie', '2024-01-05'],
      ];
      const tracks = parseLastfmCsv(rows);
      expect(tracks).toHaveLength(2);

      const paranoid = tracks.find((t) => t.name === 'Paranoid Android');
      expect(paranoid?.play_count).toBe(3);
      expect(paranoid?.first_listened_at).toBe('2024-01-01');
      expect(paranoid?.source_type).toBe('lastfm_history');
      expect(paranoid?.platform).toBe('lastfm');

      const zombie = tracks.find((t) => t.name === 'Zombie');
      expect(zombie?.play_count).toBe(1);
    });

    it('tracks earliest listen date', () => {
      const rows = [
        ['artist', 'track', 'date'],
        ['Artist', 'Song', '2024-06-15'],
        ['Artist', 'Song', '2024-01-01'],
      ];
      const tracks = parseLastfmCsv(rows);
      expect(tracks[0].first_listened_at).toBe('2024-01-01');
    });
  });

  describe('parseAppleMusicCsv', () => {
    it('parses Apple Music library export', () => {
      const rows = [
        ['Name', 'Artist', 'Album', 'Genre', 'Content Type', 'ISRC'],
        ['Come Together', 'The Beatles', 'Abbey Road', 'Rock', 'Song', 'GBAYE0601234'],
      ];
      const tracks = parseAppleMusicCsv(rows);
      expect(tracks).toHaveLength(1);
      expect(tracks[0].name).toBe('Come Together');
      expect(tracks[0].isrc).toBe('GBAYE0601234');
      expect(tracks[0].platform).toBe('apple_music');
      expect(tracks[0].source_type).toBe('apple_library');
    });

    it('filters out non-song content types', () => {
      const rows = [
        ['Name', 'Artist', 'Album', 'Content Type'],
        ['My Song', 'Artist', 'Album', 'Song'],
        ['My Podcast', 'Host', 'Show', 'Podcast'],
      ];
      const tracks = parseAppleMusicCsv(rows);
      expect(tracks).toHaveLength(1);
      expect(tracks[0].name).toBe('My Song');
    });
  });

  describe('parseCsv (auto-detect)', () => {
    it('auto-detects Exportify format', () => {
      const csv = 'Spotify URI,Track Name,Artist Name(s),Album Name\nspotify:track:abc,Song,Artist,Album';
      const result = parseCsv(csv, 'liked');
      expect(result.format).toBe('exportify');
      expect(result.tracks).toHaveLength(1);
    });

    it('auto-detects Last.fm format', () => {
      const csv = 'artist,album,track,uts\nRadiohead,OK Computer,Karma Police,1704067200';
      const result = parseCsv(csv);
      expect(result.format).toBe('lastfm');
      expect(result.tracks).toHaveLength(1);
    });

    it('returns unknown for empty CSV', () => {
      const result = parseCsv('');
      expect(result.format).toBe('unknown');
      expect(result.tracks).toHaveLength(0);
    });
  });
});
