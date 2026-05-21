/**
 * Playlist URL parsing — recognizes Spotify playlist links and URIs.
 *
 * Used by the portfolio feature: a contributor points at playlist URLs to build
 * their portfolio of preferred playlists. Spotify only for now; Apple Music is
 * a deliberate follow-up.
 */

export type PlaylistPlatform = 'spotify';

export interface ParsedPlaylistUrl {
  platform: PlaylistPlatform;
  externalId: string;
  /** Normalized canonical playlist URL. */
  url: string;
}

// Spotify playlist ids are 22 base62 characters.
const SPOTIFY_PLAYLIST_ID = /^[A-Za-z0-9]{22}$/;

/**
 * Parse a Spotify playlist URL or URI. Returns null for anything unrecognized.
 *
 * Accepts:
 *   https://open.spotify.com/playlist/{id}
 *   https://open.spotify.com/intl-xx/playlist/{id}
 *   spotify:playlist:{id}
 * Query strings (e.g. ?si=...) are ignored.
 */
export function parsePlaylistUrl(input: string): ParsedPlaylistUrl | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  // spotify:playlist:{id} URI form
  const uri = raw.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uri) return spotifyPlaylist(uri[1]);

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.hostname.toLowerCase() === 'open.spotify.com') {
    // /playlist/{id} or /intl-xx/playlist/{id}
    const match = parsed.pathname.match(/\/playlist\/([A-Za-z0-9]{22})(?:\/|$)/);
    if (match && SPOTIFY_PLAYLIST_ID.test(match[1])) return spotifyPlaylist(match[1]);
  }

  return null;
}

/** The embeddable player URL for a parsed playlist (used by the profile UI). */
export function playlistEmbedUrl(platform: PlaylistPlatform, externalId: string): string {
  // platform is 'spotify' only for now; switch here when Apple Music lands.
  void platform;
  return `https://open.spotify.com/embed/playlist/${externalId}`;
}

function spotifyPlaylist(id: string): ParsedPlaylistUrl {
  return {
    platform: 'spotify',
    externalId: id,
    url: `https://open.spotify.com/playlist/${id}`,
  };
}
