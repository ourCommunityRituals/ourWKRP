/**
 * Unit tests — Playlist URL parser
 */
import { describe, it, expect } from 'vitest';
import { parsePlaylistUrl, playlistEmbedUrl } from '../../src/lib/playlist-url';

const ID = '37i9dQZF1DXcBWIGoYBM5M'; // 22 base62 chars

describe('parsePlaylistUrl', () => {
  it('parses a standard Spotify playlist URL', () => {
    expect(parsePlaylistUrl(`https://open.spotify.com/playlist/${ID}`)).toEqual({
      platform: 'spotify',
      externalId: ID,
      url: `https://open.spotify.com/playlist/${ID}`,
    });
  });

  it('ignores a ?si= tracking query string and normalizes the URL', () => {
    const r = parsePlaylistUrl(`https://open.spotify.com/playlist/${ID}?si=abc123`);
    expect(r?.externalId).toBe(ID);
    expect(r?.url).toBe(`https://open.spotify.com/playlist/${ID}`);
  });

  it('parses a localized /intl-xx/ playlist URL', () => {
    expect(parsePlaylistUrl(`https://open.spotify.com/intl-de/playlist/${ID}`)?.externalId).toBe(ID);
  });

  it('parses a spotify:playlist: URI', () => {
    expect(parsePlaylistUrl(`spotify:playlist:${ID}`)).toEqual({
      platform: 'spotify',
      externalId: ID,
      url: `https://open.spotify.com/playlist/${ID}`,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parsePlaylistUrl(`  https://open.spotify.com/playlist/${ID}  `)?.externalId).toBe(ID);
  });

  it('rejects a Spotify track URL', () => {
    expect(parsePlaylistUrl(`https://open.spotify.com/track/${ID}`)).toBeNull();
  });

  it('rejects an Apple Music playlist URL (not yet supported)', () => {
    expect(parsePlaylistUrl('https://music.apple.com/us/playlist/chill/pl.u-abc')).toBeNull();
  });

  it('rejects a non-Spotify host', () => {
    expect(parsePlaylistUrl(`https://evil.example.com/playlist/${ID}`)).toBeNull();
  });

  it('rejects a malformed playlist id', () => {
    expect(parsePlaylistUrl('https://open.spotify.com/playlist/tooshort')).toBeNull();
  });

  it('rejects empty and non-URL input', () => {
    expect(parsePlaylistUrl('')).toBeNull();
    expect(parsePlaylistUrl('   ')).toBeNull();
    expect(parsePlaylistUrl('not a url')).toBeNull();
  });
});

describe('playlistEmbedUrl', () => {
  it('builds the Spotify embed player URL', () => {
    expect(playlistEmbedUrl('spotify', ID)).toBe(`https://open.spotify.com/embed/playlist/${ID}`);
  });
});
