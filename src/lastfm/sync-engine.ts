/**
 * Last.fm sync engine — import scrobble history into D1
 *
 * Syncs a contributor's Last.fm listening history:
 *   1. Fetch recent tracks (scrobbles) — incremental via timestamp
 *   2. Deduplicate tracks by artist+title (Last.fm has no ISRCs)
 *   3. Upsert tracks into D1 with play counts
 *   4. Record contributions (provenance: who listened to what)
 *   5. Fetch top tags per artist for genre enrichment
 *
 * Designed for multi-user: each contributor connects their own Last.fm account.
 * Session keys are permanent — no token refresh needed.
 */

import type { Env } from '../types';
import { getAllRecentTracks, getArtistTags } from './client';
import { storeLastSync, getLastSync } from '../lib/kv-storage';
import { log } from '../lib/logger';

interface LastfmSyncResult {
  username: string;
  tracks_synced: number;
  tracks_processed: number;
  contributions_created: number;
  artists_tagged: number;
  duration_ms: number;
}

// Normalize for dedup: lowercase, strip feat./ft./&, collapse whitespace
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*[([[][^)\]]*feat[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([[][^)\]]*ft\.?[^)\]]*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sync a contributor's Last.fm listening history into D1.
 */
export async function syncLastfmUser(
  env: Env,
  contributorId: string,
  username: string,
  apiKey: string,
): Promise<LastfmSyncResult> {
  const start = Date.now();
  let tracksProcessed = 0;
  let contributionsCreated = 0;
  let artistsTagged = 0;

  // Get last sync timestamp for incremental sync
  const lastSyncStr = await getLastSync(env.WKRP_KV, `lastfm:${contributorId}`);
  const fromTimestamp = lastSyncStr ? Math.floor(new Date(lastSyncStr).getTime() / 1000) : undefined;

  log('LASTFM_SYNC_START', { contributor_id: contributorId, username, from: fromTimestamp ?? 'full' });

  // Fetch scrobbles
  const scrobbles = await getAllRecentTracks(username, apiKey, fromTimestamp);

  if (scrobbles.length === 0) {
    log('LASTFM_SYNC_EMPTY', { username, contributor_id: contributorId });
    return {
      username,
      tracks_synced: 0,
      tracks_processed: 0,
      contributions_created: 0,
      artists_tagged: 0,
      duration_ms: Date.now() - start,
    };
  }

  // Deduplicate scrobbles by artist+title, aggregate play counts
  const trackMap = new Map<string, {
    name: string;
    artist: string;
    album: string;
    play_count: number;
    first_listened: string;
    last_listened: string;
    mbid: string;
  }>();

  for (const scrobble of scrobbles) {
    const artistName = scrobble.artist['#text'] ?? scrobble.artist.name ?? 'Unknown';
    const key = `${normalize(artistName)}|||${normalize(scrobble.name)}`;
    const timestamp = scrobble.date?.['#text'] ?? new Date().toISOString();

    const existing = trackMap.get(key);
    if (existing) {
      existing.play_count++;
      if (timestamp < existing.first_listened) existing.first_listened = timestamp;
      if (timestamp > existing.last_listened) existing.last_listened = timestamp;
    } else {
      trackMap.set(key, {
        name: scrobble.name,
        artist: artistName,
        album: scrobble.album?.['#text'] ?? '',
        play_count: 1,
        first_listened: timestamp,
        last_listened: timestamp,
        mbid: scrobble.mbid || '',
      });
    }
  }

  log('LASTFM_DEDUP', { scrobbles: scrobbles.length, unique_tracks: trackMap.size });

  // Batch upsert tracks + contributions (25 per batch, matching Spotify sync pattern)
  const BATCH_SIZE = 25;
  const entries = Array.from(trackMap.values());

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const statements = [];

    for (const entry of batch) {
      const trackId = crypto.randomUUID();
      const canonicalTitle = normalize(entry.name);
      const canonicalArtist = normalize(entry.artist);

      // Try to find existing track by canonical match
      // Upsert: insert if new, update play data if exists
      statements.push(
        env.WKRP_DB.prepare(`
          INSERT INTO tracks (id, name, artist, album, duration_ms, canonical_title, canonical_artist, created_at)
          VALUES (?, ?, ?, ?, 0, ?, ?, datetime('now'))
          ON CONFLICT(canonical_title, canonical_artist) DO UPDATE SET
            album = CASE WHEN excluded.album != '' THEN excluded.album ELSE tracks.album END
        `).bind(trackId, entry.name, entry.artist, entry.album, canonicalTitle, canonicalArtist)
      );

      // Get the actual track ID (might be existing)
      // We use a subquery in the contribution insert to handle both new and existing tracks
      statements.push(
        env.WKRP_DB.prepare(`
          INSERT INTO contributions (id, track_id, contributor_id, source_type, source_name, source_platform, play_count, first_listened_at, added_at, created_at)
          SELECT ?, t.id, ?, 'lastfm_history', ?, 'lastfm', ?, ?, datetime('now'), datetime('now')
          FROM tracks t WHERE t.canonical_title = ? AND t.canonical_artist = ?
          LIMIT 1
          ON CONFLICT(track_id, contributor_id, source_type, source_name) DO UPDATE SET
            play_count = excluded.play_count,
            first_listened_at = MIN(contributions.first_listened_at, excluded.first_listened_at)
        `).bind(
          crypto.randomUUID(),
          contributorId,
          username,
          entry.play_count,
          entry.first_listened,
          canonicalTitle,
          canonicalArtist,
        )
      );
    }

    await env.WKRP_DB.batch(statements);
    tracksProcessed += batch.length;
    contributionsCreated += batch.length;

    log('LASTFM_BATCH', { batch_start: i, batch_size: batch.length });
  }

  // Tag enrichment: fetch top tags for unique artists (batch of 10 to stay under rate limit)
  const uniqueArtists = [...new Set(entries.map(e => e.artist))];
  const TAG_BATCH = 10; // ~2 seconds at 5 req/sec rate limit

  for (let i = 0; i < Math.min(uniqueArtists.length, TAG_BATCH * 5); i += TAG_BATCH) {
    const artistBatch = uniqueArtists.slice(i, i + TAG_BATCH);
    const tagPromises = artistBatch.map(artist => getArtistTags(artist, apiKey));
    const tagResults = await Promise.all(tagPromises);

    const tagStatements = [];
    for (let j = 0; j < artistBatch.length; j++) {
      const tags = tagResults[j];
      if (tags.length > 0) {
        // Use the top tag as the genre for all tracks by this artist
        const topTag = tags[0].name.toLowerCase();
        const artistCanonical = normalize(artistBatch[j]);
        tagStatements.push(
          env.WKRP_DB.prepare(
            `UPDATE tracks SET genre = ? WHERE canonical_artist = ? AND genre IS NULL`
          ).bind(topTag, artistCanonical)
        );
        artistsTagged++;
      }
    }

    if (tagStatements.length > 0) {
      await env.WKRP_DB.batch(tagStatements);
    }
  }

  // Update last sync timestamp
  await storeLastSync(env.WKRP_KV, `lastfm:${contributorId}`);

  // Update contributor's lastfm_username in D1
  await env.WKRP_DB.prepare(
    'UPDATE contributors SET lastfm_username = ?, last_sync_at = datetime(\'now\') WHERE id = ?'
  ).bind(username, contributorId).run();

  const result: LastfmSyncResult = {
    username,
    tracks_synced: entries.length,
    tracks_processed: tracksProcessed,
    contributions_created: contributionsCreated,
    artists_tagged: artistsTagged,
    duration_ms: Date.now() - start,
  };

  log('LASTFM_SYNC_COMPLETE', { ...result, contributor_id: contributorId });
  return result;
}
