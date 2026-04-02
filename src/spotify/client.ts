/**
 * Spotify Web API client — native fetch, zero dependencies
 *
 * Handles: user profile, playlists, tracks, audio features, playlist creation
 * Respects rate limits (429 + Retry-After header)
 */

import type {
  SpotifyUserProfile,
  SpotifyPlaylist,
  SpotifyTrack,
  SpotifyAudioFeatures,
} from '../types';
import { log, logError } from '../lib/logger';

const BASE_URL = 'https://api.spotify.com/v1';
const MAX_RETRIES = 3;

interface PaginatedResponse<T> {
  items: T[];
  next: string | null;
  total: number;
}

/**
 * Make an authenticated Spotify API request with rate limit retry
 */
async function spotifyFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.ok) {
      return await response.json() as T;
    }

    // Rate limited — wait and retry
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') ?? '1', 10);
      log('SPOTIFY_RATE_LIMITED', { path, retry_after: retryAfter, attempt });
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    const errorBody = await response.text();
    logError('SPOTIFY_API_ERROR', new Error(`${response.status}: ${errorBody}`), { path });
    throw new Error(`Spotify API error ${response.status}: ${errorBody}`);
  }

  throw new Error(`Spotify API failed after ${MAX_RETRIES} retries: ${path}`);
}

/**
 * Fetch all pages of a paginated Spotify endpoint
 */
async function fetchAllPages<T>(
  path: string,
  accessToken: string,
  limit = 50,
): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = `${BASE_URL}${path}${path.includes('?') ? '&' : '?'}limit=${limit}`;

  while (url) {
    const page: PaginatedResponse<T> = await spotifyFetch<PaginatedResponse<T>>(url, accessToken);
    items.push(...page.items);
    url = page.next;
    log('SPOTIFY_PAGE_FETCHED', { total: page.total, fetched: items.length });
  }

  return items;
}

// --- Public API ---

export async function getUserProfile(accessToken: string): Promise<SpotifyUserProfile> {
  return spotifyFetch<SpotifyUserProfile>('/me', accessToken);
}

export async function getUserPlaylists(accessToken: string): Promise<SpotifyPlaylist[]> {
  return fetchAllPages<SpotifyPlaylist>('/me/playlists', accessToken);
}

export async function getPlaylistTracks(
  playlistId: string,
  accessToken: string,
): Promise<Array<{ track: SpotifyTrack; added_at: string; added_by: { id: string } }>> {
  const items = await fetchAllPages<{
    track: SpotifyTrack | null;
    added_at: string;
    added_by: { id: string };
  }>(`/playlists/${playlistId}/tracks`, accessToken);

  // Filter out null tracks (deleted/unavailable)
  return items.filter((item): item is { track: SpotifyTrack; added_at: string; added_by: { id: string } } =>
    item.track !== null && item.track.id !== null
  );
}

/**
 * Batch fetch audio features for up to 100 track IDs at a time
 */
export async function getAudioFeatures(
  trackIds: string[],
  accessToken: string,
): Promise<SpotifyAudioFeatures[]> {
  const features: SpotifyAudioFeatures[] = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
    const batch = trackIds.slice(i, i + BATCH_SIZE);
    const ids = batch.join(',');

    const response = await spotifyFetch<{ audio_features: (SpotifyAudioFeatures | null)[] }>(
      `/audio-features?ids=${ids}`,
      accessToken,
    );

    // Filter nulls (tracks without audio features)
    const valid = response.audio_features.filter(
      (f): f is SpotifyAudioFeatures => f !== null,
    );
    features.push(...valid);

    log('SPOTIFY_AUDIO_FEATURES_BATCH', {
      batch_start: i,
      batch_size: batch.length,
      features_found: valid.length,
    });
  }

  return features;
}

/**
 * Create a new playlist on Spotify
 */
export async function createPlaylist(
  userId: string,
  name: string,
  description: string,
  isPublic: boolean,
  accessToken: string,
): Promise<SpotifyPlaylist> {
  return spotifyFetch<SpotifyPlaylist>(
    `/users/${userId}/playlists`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ name, description, public: isPublic }),
    },
  );
}

/**
 * Add tracks to a playlist (max 100 per request)
 */
export async function addTracksToPlaylist(
  playlistId: string,
  trackUris: string[],
  accessToken: string,
): Promise<void> {
  const BATCH_SIZE = 100;

  for (let i = 0; i < trackUris.length; i += BATCH_SIZE) {
    const batch = trackUris.slice(i, i + BATCH_SIZE);
    await spotifyFetch<{ snapshot_id: string }>(
      `/playlists/${playlistId}/tracks`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ uris: batch }),
      },
    );
    log('SPOTIFY_TRACKS_ADDED', { playlist: playlistId, batch_start: i, count: batch.length });
  }
}
