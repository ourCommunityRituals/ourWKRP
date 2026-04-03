/**
 * Track resolver — cross-platform deduplication via ISRC, platform ID, or title+artist.
 *
 * Priority chain:
 * 1. ISRC match (strongest — universal recording identifier)
 * 2. Platform ID match (same track on same platform)
 * 3. Canonical title+artist match (fuzzy fallback)
 * 4. No match — create new track
 */

import type { NormalizedTrackData } from '../types';
import { normalizeTitle, normalizeArtist, extractReleaseYear } from './normalize';
import { log } from './logger';

export interface ResolveResult {
  trackId: string;
  isNew: boolean;
}

/**
 * Resolve a track to an existing ID or create a new one.
 * Returns the track ID and whether it was newly created.
 */
export async function resolveOrCreateTrack(
  db: D1Database,
  data: NormalizedTrackData,
): Promise<ResolveResult> {
  const canonTitle = normalizeTitle(data.name);
  const canonArtist = normalizeArtist(data.artist);

  // Step 1: ISRC match
  if (data.isrc) {
    const existing = await db.prepare(
      'SELECT id FROM tracks WHERE isrc = ? AND merged_into_id IS NULL LIMIT 1'
    ).bind(data.isrc).first<{ id: string }>();

    if (existing) {
      log('TRACK_RESOLVED', { method: 'isrc', isrc: data.isrc, trackId: existing.id });
      return { trackId: existing.id, isNew: false };
    }
  }

  // Step 2: Platform ID match
  if (data.platform && data.platform_id) {
    const existing = await db.prepare(
      'SELECT track_id FROM track_identifiers WHERE platform = ? AND platform_id = ? LIMIT 1'
    ).bind(data.platform, data.platform_id).first<{ track_id: string }>();

    if (existing) {
      log('TRACK_RESOLVED', { method: 'platform_id', platform: data.platform, trackId: existing.track_id });
      return { trackId: existing.track_id, isNew: false };
    }
  }

  // Step 3: Canonical title+artist match
  const canonMatch = await db.prepare(
    'SELECT id FROM tracks WHERE canonical_title = ? AND canonical_artist = ? AND merged_into_id IS NULL LIMIT 1'
  ).bind(canonTitle, canonArtist).first<{ id: string }>();

  if (canonMatch) {
    log('TRACK_RESOLVED', { method: 'canonical', title: canonTitle, trackId: canonMatch.id });

    // Backfill ISRC if we have it and the existing track doesn't
    if (data.isrc) {
      await db.prepare(
        'UPDATE tracks SET isrc = ? WHERE id = ? AND isrc IS NULL'
      ).bind(data.isrc, canonMatch.id).run();
    }

    return { trackId: canonMatch.id, isNew: false };
  }

  // Step 4: No match — create new track
  const newId = crypto.randomUUID();
  const releaseYear = extractReleaseYear(data.release_date);
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO tracks (id, name, artist, album, duration_ms, preview_url, image_url,
      energy, danceability, valence, tempo, acousticness, instrumentalness,
      genre, isrc, release_year, canonical_title, canonical_artist, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newId,
    data.name,
    data.artist,
    data.album,
    data.duration_ms ?? null,
    data.preview_url ?? null,
    data.image_url ?? null,
    data.energy ?? null,
    data.danceability ?? null,
    data.valence ?? null,
    data.tempo ?? null,
    data.acousticness ?? null,
    data.instrumentalness ?? null,
    data.genre ?? null,
    data.isrc ?? null,
    releaseYear,
    canonTitle,
    canonArtist,
    now,
  ).run();

  // Register platform identifier if available
  if (data.platform_id) {
    await db.prepare(`
      INSERT OR IGNORE INTO track_identifiers (track_id, platform, platform_id, platform_uri, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(newId, data.platform, data.platform_id, data.platform_uri ?? null, now).run();
  }

  log('TRACK_CREATED', { trackId: newId, name: data.name, artist: data.artist });
  return { trackId: newId, isNew: true };
}
