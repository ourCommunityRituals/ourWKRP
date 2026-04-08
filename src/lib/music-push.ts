/**
 * Music service push — save tracks to the listener's connected platform
 *
 * Detects which music service the listener has connected (Spotify, Apple Music, or none)
 * and pushes discovered tracks to their library. Creates "Discovered at [venue]"
 * playlists when event context is present.
 *
 * Platform detection order:
 *   1. Spotify tokens in KV (wkrp:tokens:{userId})
 *   2. Apple Music token in KV (wkrp:apple_token:{userId})
 *   3. No platform — attribution still recorded, no push
 */

import { getTokens } from './kv-storage';
import { log, logError } from './logger';

export type MusicPlatform = 'spotify' | 'apple_music' | 'none';

export interface PushResult {
  platform: MusicPlatform;
  saved: boolean;
  playlist_id?: string;
  error?: string;
}

/**
 * Detect which music platform a listener has connected.
 */
export async function detectPlatform(kv: KVNamespace, userId: string): Promise<MusicPlatform> {
  // Check Spotify first
  const spotifyTokens = await getTokens(kv, userId);
  if (spotifyTokens && spotifyTokens.access_token) {
    return 'spotify';
  }

  // Check Apple Music
  const appleToken = await kv.get(`wkrp:apple_token:${userId}`);
  if (appleToken) {
    return 'apple_music';
  }

  return 'none';
}

/**
 * Save a track to the listener's connected music service.
 * Returns the result including which platform was used.
 */
export async function pushTrackToLibrary(
  kv: KVNamespace,
  userId: string,
  trackId: string,
  trackIsrc: string | null,
): Promise<PushResult> {
  const platform = await detectPlatform(kv, userId);

  if (platform === 'none') {
    return { platform: 'none', saved: false };
  }

  if (platform === 'spotify') {
    return await pushToSpotify(kv, userId, trackId);
  }

  if (platform === 'apple_music') {
    return await pushToAppleMusic(kv, userId, trackIsrc);
  }

  return { platform: 'none', saved: false };
}

/**
 * Save a track to the listener's Spotify library.
 * Uses the Spotify Web API PUT /me/tracks endpoint.
 */
async function pushToSpotify(
  kv: KVNamespace,
  userId: string,
  trackId: string,
): Promise<PushResult> {
  try {
    const tokens = await getTokens(kv, userId);
    if (!tokens) {
      return { platform: 'spotify', saved: false, error: 'No Spotify tokens' };
    }

    // Look up the Spotify URI for this track
    const spotifyUri = await kv.get(`wkrp:track_spotify_uri:${trackId}`);
    if (!spotifyUri) {
      log('PUSH_SKIP_NO_URI', { platform: 'spotify', userId, trackId });
      return { platform: 'spotify', saved: false, error: 'No Spotify URI for this track' };
    }

    // Save to library
    const response = await fetch('https://api.spotify.com/v1/me/tracks', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids: [spotifyUri.replace('spotify:track:', '')] }),
    });

    if (response.ok) {
      log('PUSH_SPOTIFY_SAVED', { userId, trackId });
      return { platform: 'spotify', saved: true };
    }

    const errorText = await response.text();
    logError('PUSH_SPOTIFY_FAILED', new Error(errorText), { userId, trackId, status: response.status });
    return { platform: 'spotify', saved: false, error: `Spotify API ${response.status}` };
  } catch (error) {
    logError('PUSH_SPOTIFY_ERROR', error, { userId, trackId });
    return { platform: 'spotify', saved: false, error: 'Spotify push failed' };
  }
}

/**
 * Save a track to the listener's Apple Music library.
 * Uses MusicKit API with the user's Music User Token (MUT).
 * Matches by ISRC since Apple Music IDs differ from our internal IDs.
 */
async function pushToAppleMusic(
  kv: KVNamespace,
  userId: string,
  trackIsrc: string | null,
): Promise<PushResult> {
  try {
    if (!trackIsrc) {
      return { platform: 'apple_music', saved: false, error: 'No ISRC for Apple Music matching' };
    }

    const mutRaw = await kv.get(`wkrp:apple_token:${userId}`);
    if (!mutRaw) {
      return { platform: 'apple_music', saved: false, error: 'No Apple Music token' };
    }

    const mut = JSON.parse(mutRaw) as { music_user_token: string; developer_token: string };

    // Search Apple Music catalog by ISRC to get the Apple Music ID
    const searchResponse = await fetch(
      `https://api.music.apple.com/v1/catalog/us/songs?filter[isrc]=${encodeURIComponent(trackIsrc)}`,
      {
        headers: {
          'Authorization': `Bearer ${mut.developer_token}`,
          'Music-User-Token': mut.music_user_token,
        },
      },
    );

    if (!searchResponse.ok) {
      return { platform: 'apple_music', saved: false, error: `Apple Music search ${searchResponse.status}` };
    }

    const searchData = await searchResponse.json() as { data?: Array<{ id: string }> };
    if (!searchData.data || searchData.data.length === 0) {
      return { platform: 'apple_music', saved: false, error: 'Track not found on Apple Music' };
    }

    const appleMusicId = searchData.data[0].id;

    // Add to user's library
    const addResponse = await fetch('https://api.music.apple.com/v1/me/library', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mut.developer_token}`,
        'Music-User-Token': mut.music_user_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: [{ id: appleMusicId, type: 'songs' }],
      }),
    });

    if (addResponse.ok || addResponse.status === 202) {
      log('PUSH_APPLE_SAVED', { userId, trackIsrc, appleMusicId });
      return { platform: 'apple_music', saved: true };
    }

    return { platform: 'apple_music', saved: false, error: `Apple Music add ${addResponse.status}` };
  } catch (error) {
    logError('PUSH_APPLE_ERROR', error, { userId, trackIsrc });
    return { platform: 'apple_music', saved: false, error: 'Apple Music push failed' };
  }
}

/**
 * Create or update a "Discovered at [venue]" playlist for the listener.
 * Adds the attributed track to it. Uses D1 curated playlists.
 */
export async function addToDiscoveryPlaylist(
  db: D1Database,
  kv: KVNamespace,
  listenerId: string,
  trackId: string,
  venueName: string | null,
  eventId: string | null,
): Promise<string | null> {
  if (!venueName && !eventId) return null;

  const playlistName = venueName
    ? `Discovered at ${venueName}`
    : `Discovered (event)`;

  try {
    // Find existing discovery playlist for this venue/event
    let playlist = await db.prepare(
      `SELECT id FROM playlists
       WHERE contributor_id = ? AND name = ? AND is_curated = 1
       LIMIT 1`
    ).bind(listenerId, playlistName).first<{ id: string }>();

    if (!playlist) {
      // Create the playlist
      const playlistId = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO playlists (id, contributor_id, name, description, track_count, is_curated, brand_id, created_at)
        VALUES (?, ?, ?, ?, 0, 1, 'wkrp', datetime('now'))
      `).bind(playlistId, listenerId, playlistName, `Tracks discovered live`).run();
      playlist = { id: playlistId };

      log('DISCOVERY_PLAYLIST_CREATED', { playlist_id: playlistId, listener: listenerId, venue: venueName });
    }

    // Add track (ignore if already there)
    await db.prepare(`
      INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_at, added_by)
      VALUES (?, ?, COALESCE((SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = ?), 0), datetime('now'), ?)
    `).bind(playlist.id, trackId, playlist.id, listenerId).run();

    // Update count
    await db.prepare(
      `UPDATE playlists SET track_count = (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?) WHERE id = ?`
    ).bind(playlist.id, playlist.id).run();

    return playlist.id;
  } catch (error) {
    logError('DISCOVERY_PLAYLIST_ERROR', error, { listenerId, trackId, venueName });
    return null;
  }
}
