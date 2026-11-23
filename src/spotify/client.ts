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
 * Why a request failed.
 *
 * `not_entitled` — the app's credentials are not allowed to call this
 * endpoint. Spotify returns a hard 403 here and it never clears on retry:
 * newer Spotify apps have no access to /audio-features at all.
 * `request_failed` — anything else non-OK. Treated as transient.
 */
export type SpotifyErrorCode = 'not_entitled' | 'request_failed';

/**
 * Typed Spotify failure so callers can tell "this endpoint will never work
 * for this app" apart from "this attempt did not work".
 */
export class SpotifyApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly code: SpotifyErrorCode;
  readonly permanent: boolean;

  constructor(status: number, path: string, body: string) {
    super(`Spotify API error ${status}: ${body}`);
    this.name = 'SpotifyApiError';
    this.status = status;
    this.path = path;
    this.code = status === 403 ? 'not_entitled' : 'request_failed';
    this.permanent = status === 403;
  }
}

/**
 * True when the failure is Spotify refusing this app the endpoint outright.
 * Duck-typed on `code` so it also recognises errors crossing a module or
 * test-mock boundary.
 */
export function isNotEntitledError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'not_entitled'
  );
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

    // 403 is Spotify saying "not for this app" — retrying cannot change it.
    // Surfaced as a distinct code so callers can degrade instead of failing.
    if (response.status === 403) {
      log('SPOTIFY_NOT_ENTITLED', { path, status: 403 });
      throw new SpotifyApiError(403, path, errorBody);
    }

    logError('SPOTIFY_API_ERROR', new Error(`${response.status}: ${errorBody}`), { path });
    throw new SpotifyApiError(response.status, path, errorBody);
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

/**
 * One entry of GET /playlists/{id}/items as Spotify returns it.
 *
 * Spotify's February 2026 Web API change (development-mode apps, in force
 * from 2026-03-09) moved the track from `track` to `item`; `track` is kept
 * only as a deprecated alias that extended-quota apps may still receive.
 * Entries can also be podcast episodes, which carry no album or ISRC.
 */
interface SpotifyPlaylistItemEntry {
  item?: (SpotifyTrack & { type?: string }) | null;
  track?: (SpotifyTrack & { type?: string }) | null;
  added_at: string;
  added_by: { id: string };
}

/**
 * Fetch the tracks of one playlist via GET /playlists/{id}/items.
 *
 * Spotify only serves this for playlists the user owns or collaborates on;
 * any other playlist answers 403, surfaced as a `not_entitled` SpotifyApiError.
 */
export async function getPlaylistTracks(
  playlistId: string,
  accessToken: string,
): Promise<Array<{ track: SpotifyTrack; added_at: string; added_by: { id: string } }>> {
  const entries = await fetchAllPages<SpotifyPlaylistItemEntry>(
    `/playlists/${playlistId}/items`,
    accessToken,
  );

  const tracks: Array<{ track: SpotifyTrack; added_at: string; added_by: { id: string } }> = [];
  for (const entry of entries) {
    const track = entry.item ?? entry.track ?? null;
    // Deleted/unavailable tracks come back null; episodes are not tracks.
    if (!track || track.id === null || (track.type !== undefined && track.type !== 'track')) continue;
    tracks.push({ track, added_at: entry.added_at, added_by: entry.added_by });
  }
  return tracks;
}

/**
 * How many tracks a playlist holds, from the listing in GET /me/playlists.
 *
 * Since February 2026 the count lives at `items.total` (it was
 * `tracks.total`). Spotify omits it for playlists the user neither owns nor
 * collaborates on, so this falls back to the old field and then to 0.
 */
export function playlistTrackTotal(playlist: SpotifyPlaylist): number {
  return playlist.items?.total ?? playlist.tracks?.total ?? 0;
}

/**
 * Outcome of the audio-features stage.
 *
 * `ok`          — every batch requested came back.
 * `partial`     — some features were fetched, some batches failed.
 * `unavailable` — nothing was fetched (typically a 403: this Spotify app has
 *                 no access to /audio-features).
 */
export type AudioFeaturesStatus = 'ok' | 'partial' | 'unavailable';

export interface AudioFeaturesResult {
  features: SpotifyAudioFeatures[];
  status: AudioFeaturesStatus;
}

/**
 * Batch fetch audio features for up to 100 track IDs at a time.
 *
 * Each batch is isolated: one failing batch does not abort the rest. A
 * `not_entitled` 403 stops further requests (every remaining batch would fail
 * identically) and the caller is told via `status` rather than by a throw.
 */
export async function getAudioFeatures(
  trackIds: string[],
  accessToken: string,
): Promise<AudioFeaturesResult> {
  const features: SpotifyAudioFeatures[] = [];
  const BATCH_SIZE = 100;
  let batchesAttempted = 0;
  let batchesFailed = 0;

  for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
    const batch = trackIds.slice(i, i + BATCH_SIZE);
    const ids = batch.join(',');
    batchesAttempted++;

    try {
      const response = await spotifyFetch<{ audio_features: (SpotifyAudioFeatures | null)[] }>(
        `/audio-features?ids=${ids}`,
        accessToken,
      );

      // Filter nulls (tracks without audio features)
      const valid = (response.audio_features ?? []).filter(
        (f): f is SpotifyAudioFeatures => f !== null,
      );
      features.push(...valid);

      log('SPOTIFY_AUDIO_FEATURES_BATCH', {
        batch_start: i,
        batch_size: batch.length,
        features_found: valid.length,
      });
    } catch (err) {
      batchesFailed++;

      if (isNotEntitledError(err)) {
        const batchesSkipped = Math.ceil((trackIds.length - i - batch.length) / BATCH_SIZE);
        log('SPOTIFY_AUDIO_FEATURES_UNAVAILABLE', {
          batch_start: i,
          batches_skipped: batchesSkipped,
          reason: 'not_entitled',
        });
        break;
      }

      logError('SPOTIFY_AUDIO_FEATURES_BATCH_ERROR', err, {
        batch_start: i,
        batch_size: batch.length,
      });
    }
  }

  const status: AudioFeaturesStatus =
    batchesFailed === 0 ? 'ok' : features.length === 0 ? 'unavailable' : 'partial';

  log('SPOTIFY_AUDIO_FEATURES_RESULT', {
    tracks_requested: trackIds.length,
    features_found: features.length,
    batches_attempted: batchesAttempted,
    batches_failed: batchesFailed,
    status,
  });

  return { features, status };
}

/**
 * Create a new playlist in the current user's Spotify account.
 *
 * POST /me/playlists. Spotify removed POST /users/{user_id}/playlists in its
 * February 2026 Web API change, so the playlist is always created for the
 * user the access token belongs to.
 */
export async function createPlaylist(
  name: string,
  description: string,
  isPublic: boolean,
  accessToken: string,
): Promise<SpotifyPlaylist> {
  return spotifyFetch<SpotifyPlaylist>(
    '/me/playlists',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ name, description, public: isPublic }),
    },
  );
}

/**
 * Add tracks to a playlist (max 100 per request).
 *
 * POST /playlists/{id}/items; the `/tracks` form was removed in February 2026.
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
      `/playlists/${playlistId}/items`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ uris: batch }),
      },
    );
    log('SPOTIFY_TRACKS_ADDED', { playlist: playlistId, batch_start: i, count: batch.length });
  }
}
