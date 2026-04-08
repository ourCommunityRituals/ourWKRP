/**
 * Last.fm API client — native fetch, zero dependencies
 *
 * Handles: auth, user profile, recent tracks, top tracks/artists, track tags
 * Rate limit: 5 req/sec averaged over 5 minutes (self-enforced)
 *
 * Auth model: Session keys are permanent — no refresh needed.
 * API key + shared secret are required. No OAuth2, no PKCE.
 *
 * Last.fm auth flow:
 *   1. Redirect user to last.fm/api/auth/?api_key=KEY&cb=CALLBACK
 *   2. User approves → redirected back with ?token=TOKEN
 *   3. Exchange token for permanent session key via auth.getSession
 */

import type { LastfmUser, LastfmTrack, LastfmTag, LastfmSession } from '../types';
import { log, logError } from '../lib/logger';

const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const AUTH_URL = 'https://www.last.fm/api/auth/';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Make a Last.fm API request with retry on rate limit / transient errors.
 * All Last.fm API calls use GET with query params + JSON format.
 */
async function lastfmFetch<T>(
  params: Record<string, string>,
  apiKey: string,
): Promise<T> {
  const searchParams = new URLSearchParams({
    ...params,
    api_key: apiKey,
    format: 'json',
  });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(`${BASE_URL}?${searchParams.toString()}`);

    if (response.ok) {
      const data = await response.json() as T & { error?: number; message?: string };
      // Last.fm returns 200 with error object for API errors
      if (data.error) {
        throw new Error(`Last.fm API error ${data.error}: ${data.message}`);
      }
      return data;
    }

    if (response.status === 429 || response.status >= 500) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      log('LASTFM_RATE_LIMITED', { status: response.status, attempt, delay_ms: delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    const errorBody = await response.text();
    logError('LASTFM_API_ERROR', new Error(`${response.status}: ${errorBody}`), { params });
    throw new Error(`Last.fm API error ${response.status}: ${errorBody}`);
  }

  throw new Error(`Last.fm API failed after ${MAX_RETRIES} retries`);
}

/**
 * Generate the API method signature for authenticated requests.
 * Last.fm uses md5(sorted_params + shared_secret) for signing.
 *
 * Uses Web Crypto API (available in Cloudflare Workers).
 */
async function generateApiSig(
  params: Record<string, string>,
  sharedSecret: string,
): Promise<string> {
  // Sort params alphabetically by key, concatenate key+value pairs
  const sorted = Object.keys(params).sort();
  let sigString = '';
  for (const key of sorted) {
    sigString += key + params[key];
  }
  sigString += sharedSecret;

  // MD5 hash via Web Crypto
  const encoder = new TextEncoder();
  const data = encoder.encode(sigString);
  const hashBuffer = await crypto.subtle.digest('MD5', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Auth ---

/**
 * Build the Last.fm authorization URL.
 * User visits this, approves, gets redirected to callbackUrl with ?token=TOKEN.
 */
export function getAuthUrl(apiKey: string, callbackUrl: string): string {
  const params = new URLSearchParams({
    api_key: apiKey,
    cb: callbackUrl,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange a one-time token for a permanent session key.
 * This is the final step of Last.fm auth — the session key never expires.
 */
export async function getSession(
  token: string,
  apiKey: string,
  sharedSecret: string,
): Promise<LastfmSession> {
  const params: Record<string, string> = {
    method: 'auth.getSession',
    api_key: apiKey,
    token,
  };

  const apiSig = await generateApiSig(params, sharedSecret);

  const searchParams = new URLSearchParams({
    ...params,
    api_sig: apiSig,
    format: 'json',
  });

  const response = await fetch(`${BASE_URL}?${searchParams.toString()}`);
  const data = await response.json() as { session?: LastfmSession; error?: number; message?: string };

  if (data.error || !data.session) {
    throw new Error(`Last.fm auth failed: ${data.message ?? 'No session returned'}`);
  }

  log('LASTFM_SESSION_OBTAINED', { username: data.session.name });
  return data.session;
}

// --- User Profile ---

export async function getUserInfo(username: string, apiKey: string): Promise<LastfmUser> {
  const data = await lastfmFetch<{ user: LastfmUser }>(
    { method: 'user.getInfo', user: username },
    apiKey,
  );
  return data.user;
}

// --- Recent Tracks (scrobble history) ---

interface RecentTracksResponse {
  recenttracks: {
    track: LastfmTrack[];
    '@attr': { page: string; perPage: string; totalPages: string; total: string };
  };
}

/**
 * Fetch a page of recent tracks (scrobble history).
 * Max 200 per page. Returns newest first.
 */
export async function getRecentTracks(
  username: string,
  apiKey: string,
  page = 1,
  limit = 200,
  from?: number,
): Promise<{ tracks: LastfmTrack[]; totalPages: number; total: number }> {
  const params: Record<string, string> = {
    method: 'user.getRecentTracks',
    user: username,
    page: String(page),
    limit: String(Math.min(limit, 200)),
    extended: '0',
  };

  // 'from' = UTC timestamp to fetch scrobbles after (for incremental sync)
  if (from) {
    params.from = String(from);
  }

  const data = await lastfmFetch<RecentTracksResponse>(params, apiKey);
  const attr = data.recenttracks['@attr'];

  // Filter out "now playing" tracks (they have no date)
  const tracks = data.recenttracks.track.filter(t => t.date !== undefined);

  log('LASTFM_RECENT_TRACKS_PAGE', {
    username,
    page,
    tracks_on_page: tracks.length,
    total: attr.total,
    total_pages: attr.totalPages,
  });

  return {
    tracks,
    totalPages: parseInt(attr.totalPages, 10),
    total: parseInt(attr.total, 10),
  };
}

/**
 * Fetch ALL recent tracks, paginating through the full history.
 * Use `from` timestamp for incremental sync (only fetch new scrobbles).
 * Caps at maxPages to avoid runaway syncs on first load.
 */
export async function getAllRecentTracks(
  username: string,
  apiKey: string,
  from?: number,
  maxPages = 50,
): Promise<LastfmTrack[]> {
  const allTracks: LastfmTrack[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await getRecentTracks(username, apiKey, page, 200, from);
    allTracks.push(...result.tracks);
    totalPages = result.totalPages;
    page++;
  } while (page <= totalPages && page <= maxPages);

  log('LASTFM_RECENT_TRACKS_COMPLETE', {
    username,
    total_fetched: allTracks.length,
    pages_fetched: page - 1,
    total_pages: totalPages,
    capped: page > maxPages,
  });

  return allTracks;
}

// --- Top Tracks ---

interface TopTracksResponse {
  toptracks: {
    track: Array<LastfmTrack & { playcount: string; '@attr': { rank: string } }>;
    '@attr': { page: string; totalPages: string; total: string };
  };
}

export async function getTopTracks(
  username: string,
  apiKey: string,
  period: 'overall' | '7day' | '1month' | '3month' | '6month' | '12month' = 'overall',
  limit = 200,
): Promise<LastfmTrack[]> {
  const data = await lastfmFetch<TopTracksResponse>(
    { method: 'user.getTopTracks', user: username, period, limit: String(Math.min(limit, 1000)) },
    apiKey,
  );
  return data.toptracks.track;
}

// --- Top Artists ---

interface TopArtistsResponse {
  topartists: {
    artist: Array<{ name: string; playcount: string; mbid: string; url: string }>;
  };
}

export async function getTopArtists(
  username: string,
  apiKey: string,
  period: 'overall' | '7day' | '1month' | '3month' | '6month' | '12month' = 'overall',
  limit = 100,
): Promise<Array<{ name: string; playcount: string; mbid: string }>> {
  const data = await lastfmFetch<TopArtistsResponse>(
    { method: 'user.getTopArtists', user: username, period, limit: String(Math.min(limit, 1000)) },
    apiKey,
  );
  return data.topartists.artist;
}

// --- Track Tags (community genre/mood tags) ---

interface TrackTagsResponse {
  toptags: {
    tag: LastfmTag[];
  };
}

/**
 * Get community tags for a track. These serve as genre/mood metadata
 * since audio features are unavailable.
 */
export async function getTrackTags(
  artist: string,
  track: string,
  apiKey: string,
): Promise<LastfmTag[]> {
  try {
    const data = await lastfmFetch<TrackTagsResponse>(
      { method: 'track.getTopTags', artist, track, autocorrect: '1' },
      apiKey,
    );
    return data.toptags.tag;
  } catch {
    // Tags not found is not fatal — many tracks have no tags
    return [];
  }
}

// --- Artist Tags ---

interface ArtistTagsResponse {
  toptags: {
    tag: LastfmTag[];
  };
}

export async function getArtistTags(
  artist: string,
  apiKey: string,
): Promise<LastfmTag[]> {
  try {
    const data = await lastfmFetch<ArtistTagsResponse>(
      { method: 'artist.getTopTags', artist, autocorrect: '1' },
      apiKey,
    );
    return data.toptags.tag;
  } catch {
    return [];
  }
}
