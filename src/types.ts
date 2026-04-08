/**
 * ourWKRP — Type definitions
 */

export interface Env {
  // Bindings
  WKRP_KV: KVNamespace;
  WKRP_DB: D1Database;

  // Environment variables
  WORKER_ENV: string;
  WORKER_VERSION: string;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_REDIRECT_URI: string;
  APP_URL: string;
  LASTFM_API_KEY: string;
  LASTFM_SHARED_SECRET: string;
}

export type ContributorRole = 'founder' | 'curator' | 'contributor' | 'dj';
export type ContributorStatus = 'active' | 'inactive' | 'departed';
export type SourceType = 'liked' | 'saved_album' | 'created_playlist' | 'curated_submission' | 'lastfm_history' | 'apple_library' | 'manual';
export type SourcePlatform = 'spotify' | 'lastfm' | 'apple_music' | 'bandcamp' | 'discogs' | 'manual';

export interface Contributor {
  id: string;
  name: string;
  generation: 'founder' | 'gen2' | 'gen3';
  brand_id: string;
  role: ContributorRole;
  status: ContributorStatus;
  spotify_user_id: string | null;
  spotify_display_name: string | null;
  apple_music_id: string | null;
  lastfm_username: string | null;
  created_at: string;
  last_sync_at: string | null;
}

export interface Playlist {
  id: string;
  contributor_id: string;
  name: string;
  description: string | null;
  track_count: number;
  snapshot_id: string | null;
  image_url: string | null;
  created_at: string;
}

export interface Track {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
  preview_url: string | null;
  image_url: string | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  tempo: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  genre: string | null;
  isrc: string | null;
  release_year: number | null;
  canonical_title: string | null;
  canonical_artist: string | null;
  merged_into_id: string | null;
  created_at: string;
}

export interface PlaylistTrack {
  playlist_id: string;
  track_id: string;
  position: number;
  added_at: string | null;
  added_by: string | null;
}

export interface TrackIdentifier {
  track_id: string;
  platform: SourcePlatform;
  platform_id: string;
  platform_uri: string | null;
  created_at: string;
}

export interface Contribution {
  id: string;
  track_id: string;
  contributor_id: string;
  source_type: SourceType;
  source_name: string | null;
  source_platform: SourcePlatform;
  original_submitter_id: string | null;
  play_count: number | null;
  first_listened_at: string | null;
  added_at: string | null;
  created_at: string;
}

export interface Brand {
  id: string;
  name: string;
  subdomain: string;
  primary_color: string;
  accent_color: string;
  logo_url: string | null;
  created_at: string;
}

export interface CursorPage<T> {
  items: T[];
  cursor: string | null;
  has_more: boolean;
}

export interface CatalogStats {
  total_tracks: number;
  total_contributors: number;
  total_playlists: number;
  top_genres: Array<{ genre: string; count: number }>;
  top_decades: Array<{ decade: number; count: number }>;
  has_audio_features: boolean;
}

export interface ImportResult {
  tracks_new: number;
  tracks_matched: number;
  contributions_created: number;
  contributions_skipped: number;
  errors: string[];
  duration_ms: number;
}

/** Normalized track data from any import source */
export interface NormalizedTrackData {
  name: string;
  artist: string;
  album: string;
  duration_ms?: number;
  isrc?: string;
  release_date?: string;
  image_url?: string;
  preview_url?: string;
  energy?: number;
  danceability?: number;
  valence?: number;
  tempo?: number;
  acousticness?: number;
  instrumentalness?: number;
  genre?: string;
  platform: SourcePlatform;
  platform_id?: string;
  platform_uri?: string;
  source_type: SourceType;
  source_name?: string;
  play_count?: number;
  first_listened_at?: string;
  added_at?: string;
}

// KV stored types
export interface AuthState {
  code_verifier: string;
  name: string;
  gen: string;
}

export interface SessionData {
  userId: string;
  name: string;
  gen: string;
  brand_id: string;
}

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp ms
}

// Spotify API response types
export interface SpotifyUserProfile {
  id: string;
  display_name: string | null;
  email?: string;
  images?: Array<{ url: string }>;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  tracks: { total: number };
  snapshot_id: string;
  images: Array<{ url: string }>;
  owner: { id: string };
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
  album: { name: string; images: Array<{ url: string }>; release_date?: string };
  duration_ms: number;
  preview_url: string | null;
  external_ids?: { isrc?: string };
}

export interface SpotifyAudioFeatures {
  id: string;
  energy: number;
  danceability: number;
  valence: number;
  tempo: number;
  acousticness: number;
  instrumentalness: number;
}

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

// Last.fm API response types
export interface LastfmUser {
  name: string;
  realname: string;
  url: string;
  playcount: string;
  registered: { unixtime: string };
  image: Array<{ '#text': string; size: string }>;
}

export interface LastfmTrack {
  name: string;
  artist: { '#text'?: string; name?: string; mbid?: string };
  album: { '#text'?: string; mbid?: string };
  mbid: string;
  url: string;
  date?: { uts: string; '#text': string };
  image?: Array<{ '#text': string; size: string }>;
  playcount?: string;
  duration?: string;
}

export interface LastfmTag {
  name: string;
  count: number;
  url: string;
}

export interface LastfmSession {
  name: string;
  key: string;
  subscriber: number;
}
