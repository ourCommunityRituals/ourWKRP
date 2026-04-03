/**
 * CSV parser for multi-platform music library imports.
 *
 * Supports:
 * - Exportify (Spotify CSV export) — richest data, includes audio features + ISRCs
 * - Last.fm export — scrobble history with play counts
 * - Apple Music library export — library data with ISRCs
 */

import type { NormalizedTrackData, SourceType } from '../types';

export type CsvFormat = 'exportify' | 'lastfm' | 'apple_music' | 'unknown';

/** Detect the CSV format from header row */
export function detectFormat(headers: string[]): CsvFormat {
  const normalized = headers.map((h) => h.trim().toLowerCase());

  // Exportify: has "Spotify URI" or "spotify id" or "Track URI"
  if (normalized.some((h) => h.includes('spotify uri') || h.includes('track uri') || h === 'spotify id')) {
    return 'exportify';
  }

  // Last.fm: has "uts" (unix timestamp) or typical last.fm headers
  if (normalized.includes('uts') || (normalized.includes('artist') && normalized.includes('track') && !normalized.includes('album name'))) {
    return 'lastfm';
  }

  // Apple Music: has "content type" or "apple music" indicators
  if (normalized.includes('content type') || normalized.some((h) => h.includes('apple'))) {
    return 'apple_music';
  }

  // Fallback: check for common patterns
  if (normalized.includes('isrc') && normalized.includes('track name')) {
    return 'exportify';
  }

  return 'unknown';
}

/** Parse a CSV string into rows, handling quoted fields */
export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  const lines = csv.split('\n');

  for (const line of lines) {
    if (line.trim() === '') continue;
    rows.push(parseCsvLine(line));
  }

  return rows;
}

/** Parse a single CSV line, handling quoted fields with commas and escaped quotes */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

/** Map header names to column indexes */
function buildHeaderMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => map.set(h.trim().toLowerCase(), i));
  return map;
}

/** Get a field value by header name, case-insensitive */
function getField(row: string[], headerMap: Map<string, number>, ...names: string[]): string {
  for (const name of names) {
    const idx = headerMap.get(name.toLowerCase());
    if (idx !== undefined && idx < row.length) {
      return row[idx].trim();
    }
  }
  return '';
}

/** Validate and sanitize a URL — only allow http/https schemes */
function sanitizeUrl(value: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }
  return undefined;
}

/** Parse float, returning undefined if invalid */
function parseFloat_(value: string): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  return isNaN(n) ? undefined : n;
}

/** Parse int, returning undefined if invalid */
function parseInt_(value: string): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

/**
 * Parse an Exportify CSV into normalized track data.
 * Source type is determined by the source_name parameter.
 */
export function parseExportifyCsv(
  rows: string[][],
  sourceType: SourceType,
  sourceName?: string,
): NormalizedTrackData[] {
  if (rows.length < 2) return [];

  const headerMap = buildHeaderMap(rows[0]);
  const tracks: NormalizedTrackData[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 3) continue;

    const name = getField(row, headerMap, 'track name', 'name');
    const artist = getField(row, headerMap, 'artist name(s)', 'artist names', 'artist name', 'artist');
    const album = getField(row, headerMap, 'album name', 'album');

    if (!name || !artist) continue;

    const spotifyUri = getField(row, headerMap, 'spotify uri', 'track uri', 'uri');
    const spotifyId = spotifyUri.replace('spotify:track:', '') || getField(row, headerMap, 'spotify id');

    tracks.push({
      name,
      artist,
      album: album || 'Unknown Album',
      duration_ms: parseInt_(getField(row, headerMap, 'track duration (ms)', 'duration (ms)', 'duration_ms')),
      isrc: getField(row, headerMap, 'isrc') || undefined,
      release_date: getField(row, headerMap, 'album release date', 'release date') || undefined,
      image_url: sanitizeUrl(getField(row, headerMap, 'album image url', 'image url')),
      preview_url: sanitizeUrl(getField(row, headerMap, 'track preview url', 'preview url')),
      energy: parseFloat_(getField(row, headerMap, 'energy')),
      danceability: parseFloat_(getField(row, headerMap, 'danceability')),
      valence: parseFloat_(getField(row, headerMap, 'valence')),
      tempo: parseFloat_(getField(row, headerMap, 'tempo')),
      acousticness: parseFloat_(getField(row, headerMap, 'acousticness')),
      instrumentalness: parseFloat_(getField(row, headerMap, 'instrumentalness')),
      genre: getField(row, headerMap, 'artist genres', 'genre', 'genres') || undefined,
      platform: 'spotify',
      platform_id: spotifyId || undefined,
      platform_uri: spotifyUri || undefined,
      source_type: sourceType,
      source_name: sourceName,
      added_at: getField(row, headerMap, 'added at', 'added_at') || undefined,
    });
  }

  return tracks;
}

/**
 * Parse a Last.fm scrobble export CSV into normalized track data.
 */
export function parseLastfmCsv(rows: string[][]): NormalizedTrackData[] {
  if (rows.length < 2) return [];

  const headerMap = buildHeaderMap(rows[0]);
  const tracks: NormalizedTrackData[] = [];

  // Last.fm exports may have multiple scrobbles of the same track.
  // Aggregate play counts and find earliest listen.
  const seen = new Map<string, NormalizedTrackData>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 2) continue;

    const artist = getField(row, headerMap, 'artist', 'artist name');
    const name = getField(row, headerMap, 'track', 'track name', 'name');
    const album = getField(row, headerMap, 'album', 'album name');
    const timestamp = getField(row, headerMap, 'date', 'uts', 'timestamp', 'datetime');

    if (!name || !artist) continue;

    const key = `${name.toLowerCase()}|||${artist.toLowerCase()}`;
    const existing = seen.get(key);

    if (existing) {
      existing.play_count = (existing.play_count ?? 0) + 1;
      if (timestamp && (!existing.first_listened_at || timestamp < existing.first_listened_at)) {
        existing.first_listened_at = timestamp;
      }
    } else {
      const track: NormalizedTrackData = {
        name,
        artist,
        album: album || 'Unknown Album',
        platform: 'lastfm',
        source_type: 'lastfm_history',
        play_count: 1,
        first_listened_at: timestamp || undefined,
      };
      seen.set(key, track);
      tracks.push(track);
    }
  }

  return tracks;
}

/**
 * Parse an Apple Music library export CSV into normalized track data.
 */
export function parseAppleMusicCsv(rows: string[][]): NormalizedTrackData[] {
  if (rows.length < 2) return [];

  const headerMap = buildHeaderMap(rows[0]);
  const tracks: NormalizedTrackData[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 2) continue;

    const name = getField(row, headerMap, 'name', 'title', 'track name', 'song');
    const artist = getField(row, headerMap, 'artist', 'artist name');
    const album = getField(row, headerMap, 'album', 'album name');

    if (!name || !artist) continue;

    // Filter to songs only (skip podcasts, audiobooks, etc.)
    const contentType = getField(row, headerMap, 'content type', 'type');
    if (contentType && contentType.toLowerCase() !== 'song' && contentType.toLowerCase() !== 'music') {
      continue;
    }

    tracks.push({
      name,
      artist,
      album: album || 'Unknown Album',
      duration_ms: parseInt_(getField(row, headerMap, 'total time', 'duration', 'time')),
      isrc: getField(row, headerMap, 'isrc') || undefined,
      release_date: getField(row, headerMap, 'release date', 'year') || undefined,
      genre: getField(row, headerMap, 'genre', 'genres') || undefined,
      platform: 'apple_music',
      source_type: 'apple_library',
    });
  }

  return tracks;
}

/**
 * Parse CSV content, auto-detecting format.
 * Returns normalized track data from any supported format.
 */
export function parseCsv(
  csvContent: string,
  sourceType?: SourceType,
  sourceName?: string,
): { format: CsvFormat; tracks: NormalizedTrackData[] } {
  const rows = parseCsvRows(csvContent);
  if (rows.length < 2) return { format: 'unknown', tracks: [] };

  const format = detectFormat(rows[0]);

  switch (format) {
    case 'exportify':
      return { format, tracks: parseExportifyCsv(rows, sourceType ?? 'liked', sourceName) };
    case 'lastfm':
      return { format, tracks: parseLastfmCsv(rows) };
    case 'apple_music':
      return { format, tracks: parseAppleMusicCsv(rows) };
    default:
      return { format: 'unknown', tracks: [] };
  }
}
