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
}

export interface Contributor {
  id: string;
  name: string;
  generation: 'founder' | 'gen2' | 'gen3';
  brand_id: string;
  spotify_user_id: string | null;
  spotify_display_name: string | null;
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
  created_at: string;
}

export interface PlaylistTrack {
  playlist_id: string;
  track_id: string;
  position: number;
  added_at: string | null;
  added_by: string | null;
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
  album: { name: string; images: Array<{ url: string }> };
  duration_ms: number;
  preview_url: string | null;
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
