/**
 * Sync engine — progressive deep sync from Spotify
 *
 * Sync order: playlists → tracks → audio features
 * Uses snapshot_id for change detection (skip unchanged playlists)
 * Batches D1 writes for performance
 */

import type { Env } from '../types';
import { getUserPlaylists, getPlaylistTracks, getAudioFeatures } from './client';
import { storeLastSync } from '../lib/kv-storage';
import { log, logError } from '../lib/logger';

export interface SyncResult {
  playlists_synced: number;
  playlists_skipped: number;
  tracks_synced: number;
  audio_features_synced: number;
  duration_ms: number;
}

/**
 * Full sync: pull all playlists, tracks, and audio features for a contributor
 */
export async function syncContributor(
  env: Env,
  contributorId: string,
  accessToken: string,
): Promise<SyncResult> {
  const start = Date.now();
  const result: SyncResult = {
    playlists_synced: 0,
    playlists_skipped: 0,
    tracks_synced: 0,
    audio_features_synced: 0,
    duration_ms: 0,
  };

  log('SYNC_START', { contributorId });

  // Step 1: Fetch all playlists from Spotify
  const spotifyPlaylists = await getUserPlaylists(accessToken);
  log('SYNC_PLAYLISTS_FETCHED', { count: spotifyPlaylists.length, contributorId });

  // Get existing playlist snapshot_ids from D1 for change detection
  const existingPlaylists = await env.WKRP_DB.prepare(
    'SELECT id, snapshot_id FROM playlists WHERE contributor_id = ?'
  ).bind(contributorId).all();

  const existingSnapshots = new Map<string, string>();
  for (const row of existingPlaylists.results) {
    existingSnapshots.set(row.id as string, row.snapshot_id as string);
  }

  const allTrackIds = new Set<string>();

  // Step 2: For each playlist, upsert metadata and sync tracks
  for (const playlist of spotifyPlaylists) {
    const existing = existingSnapshots.get(playlist.id);

    // Upsert playlist metadata
    await env.WKRP_DB.prepare(`
      INSERT INTO playlists (id, contributor_id, name, description, track_count, snapshot_id, image_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        track_count = excluded.track_count,
        snapshot_id = excluded.snapshot_id,
        image_url = excluded.image_url
    `).bind(
      playlist.id,
      contributorId,
      playlist.name,
      playlist.description,
      playlist.tracks.total,
      playlist.snapshot_id,
      playlist.images?.[0]?.url ?? null,
      new Date().toISOString(),
    ).run();

    // Skip tracks if playlist hasn't changed
    if (existing === playlist.snapshot_id) {
      result.playlists_skipped++;
      log('SYNC_PLAYLIST_SKIP', { playlist: playlist.name, snapshot: playlist.snapshot_id });
      continue;
    }

    result.playlists_synced++;

    // Fetch tracks for this playlist
    try {
      const playlistTracks = await getPlaylistTracks(playlist.id, accessToken);

      // Clear existing playlist_tracks for this playlist
      await env.WKRP_DB.prepare(
        'DELETE FROM playlist_tracks WHERE playlist_id = ?'
      ).bind(playlist.id).run();

      for (let i = 0; i < playlistTracks.length; i++) {
        const item = playlistTracks[i];
        const track = item.track;

        // Upsert track
        await env.WKRP_DB.prepare(`
          INSERT INTO tracks (id, name, artist, album, duration_ms, preview_url, image_url, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            artist = excluded.artist,
            album = excluded.album
        `).bind(
          track.id,
          track.name,
          track.artists.map((a) => a.name).join(', '),
          track.album.name,
          track.duration_ms,
          track.preview_url,
          track.album.images?.[0]?.url ?? null,
          new Date().toISOString(),
        ).run();

        // Insert playlist_track link
        await env.WKRP_DB.prepare(`
          INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_id, position, added_at, added_by)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          playlist.id,
          track.id,
          i,
          item.added_at,
          contributorId,
        ).run();

        allTrackIds.add(track.id);
        result.tracks_synced++;
      }

      log('SYNC_PLAYLIST_TRACKS', {
        playlist: playlist.name,
        tracks: playlistTracks.length,
      });
    } catch (err) {
      logError('SYNC_PLAYLIST_ERROR', err, { playlist: playlist.id });
    }
  }

  // Step 3: Fetch audio features for all new tracks
  const trackIdsArray = Array.from(allTrackIds);
  if (trackIdsArray.length > 0) {
    try {
      const features = await getAudioFeatures(trackIdsArray, accessToken);

      for (const f of features) {
        await env.WKRP_DB.prepare(`
          UPDATE tracks SET
            energy = ?, danceability = ?, valence = ?,
            tempo = ?, acousticness = ?, instrumentalness = ?
          WHERE id = ?
        `).bind(
          f.energy, f.danceability, f.valence,
          f.tempo, f.acousticness, f.instrumentalness,
          f.id,
        ).run();
        result.audio_features_synced++;
      }

      log('SYNC_AUDIO_FEATURES', { total: features.length });
    } catch (err) {
      logError('SYNC_AUDIO_FEATURES_ERROR', err);
    }
  }

  // Update contributor's last_sync_at
  await env.WKRP_DB.prepare(
    'UPDATE contributors SET last_sync_at = ? WHERE id = ?'
  ).bind(new Date().toISOString(), contributorId).run();

  await storeLastSync(env.WKRP_KV, contributorId);

  result.duration_ms = Date.now() - start;
  log('SYNC_COMPLETE', { contributorId, ...result });

  return result;
}
