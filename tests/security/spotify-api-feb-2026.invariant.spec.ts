/**
 * Spotify Web API February 2026 lock
 * ==================================
 *
 * Spotify's February 2026 change (development-mode apps; new apps from
 * 2026-02-11, existing apps migrated 2026-03-09) removed endpoints this
 * Worker used. ourWKRP's Spotify app is in development mode, so a call to a
 * removed path fails in staging and production. Source:
 *   https://developer.spotify.com/documentation/web-api/references/changes/february-2026
 *   https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
 *
 * Forbidden here (with the replacement Spotify names):
 *   POST /users/{id}/playlists        -> POST /me/playlists
 *   GET  /users/{id}, /users/{id}/playlists (removed)
 *   GET|POST|PUT|DELETE /playlists/{id}/tracks -> /playlists/{id}/items
 *   PUT|DELETE /me/tracks|albums|episodes|shows|audiobooks|following -> /me/library
 *   GET /browse/*, /markets, /artists/{id}/top-tracks (removed)
 *   User object fields email, country, product, explicit_content, followers
 *
 * ISRC stays: `external_ids` was listed as removed in February and restored
 * in the March 2026 changelog. This spec asserts the sync still reads it.
 *
 * STRUCTURAL tripwire, like deprecation-lock.invariant.spec.ts: it catches a
 * literal re-introduction, not a path built by indirection. The behaviour is
 * locked separately in tests/unit/spotify-client.test.ts and
 * tests/unit/music-push.test.ts. Born red: the self-test block below runs each
 * pattern against the exact line the old code had.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

function srcFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...srcFiles(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Strip comments so the migration notes in doc blocks do not trip the scan. */
function code(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * A Spotify path is either an absolute api.spotify.com URL or a string
 * literal passed to the client in src/spotify/. ourWKRP's own routes
 * (`/api/playlists/:id/tracks`) never start with these, so they cannot match.
 */
const PREFIX = String.raw`(?:api\.spotify\.com\/v1|[\`'"])`;
const REMOVED: Array<[string, RegExp]> = [
  ['POST /users/{id}/playlists and other /users/ paths', new RegExp(`${PREFIX}\\/users\\/`)],
  ['/playlists/{id}/tracks', new RegExp(`${PREFIX}\\/playlists\\/[^\\s'"\`]*\\/tracks\\b`)],
  ['/me/tracks, /me/albums, /me/following and the other per-type library paths', new RegExp(`${PREFIX}\\/me\\/(?:tracks|albums|episodes|shows|audiobooks|following)\\b`)],
  ['/browse/*', new RegExp(`${PREFIX}\\/browse\\/`)],
  ['/markets', new RegExp(`${PREFIX}\\/markets\\b`)],
  ['/artists/{id}/top-tracks', new RegExp(`${PREFIX}\\/artists\\/[^\\s'"\`]*\\/top-tracks`)],
];

/** A source file that builds a Spotify Web API URL (anchored on the scheme and host). */
const SPOTIFY_API_URL = /https:\/\/api\.spotify\.com\/v1\//;

/** Files that call Spotify: the client folder plus any file with a Spotify Web API URL. */
function spotifyFiles(): string[] {
  return srcFiles().filter(
    (f) => f.includes(`${path.sep}spotify${path.sep}`) || SPOTIFY_API_URL.test(fs.readFileSync(f, 'utf8')),
  );
}

export function removedEndpointHits(source: string): string[] {
  return REMOVED.filter(([, re]) => re.test(source)).map(([name]) => name);
}

describe('Spotify February 2026: removed endpoints stay out of src/', () => {
  it('finds the Spotify-calling files (the scan is not empty)', () => {
    const files = spotifyFiles().map((f) => path.relative(ROOT, f));
    expect(files).toContain(path.join('src', 'spotify', 'client.ts'));
    expect(files).toContain(path.join('src', 'lib', 'music-push.ts'));
  });

  for (const [name] of REMOVED) {
    it(`no source calls ${name}`, () => {
      const offenders = spotifyFiles()
        .filter((f) => removedEndpointHits(code(f)).includes(name))
        .map((f) => path.relative(ROOT, f));
      expect(offenders).toEqual([]);
    });
  }

  it('uses the replacements Spotify names', () => {
    const client = code(path.join(SRC, 'spotify', 'client.ts'));
    expect(client).toContain("'/me/playlists'");
    expect(client).toMatch(/\/playlists\/\$\{playlistId\}\/items/);
    const push = code(path.join(SRC, 'lib', 'music-push.ts'));
    expect(push).toContain('api.spotify.com/v1/me/library');
  });

  it('reads the playlist track count through playlistTrackTotal, not tracks.total', () => {
    const sync = code(path.join(SRC, 'spotify', 'sync-engine.ts'));
    expect(sync).not.toMatch(/\.tracks\.total/);
    expect(sync).toContain('playlistTrackTotal(playlist)');
  });

  it('keeps ISRC from external_ids as the cross-platform key', () => {
    const sync = code(path.join(SRC, 'spotify', 'sync-engine.ts'));
    expect(sync).toMatch(/external_ids\?\.isrc/);
  });

  it('the Spotify user type carries none of the removed profile fields', () => {
    const types = code(path.join(SRC, 'types.ts'));
    const block = types.match(/export interface SpotifyUserProfile \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(block).not.toBe('');
    for (const field of ['email', 'country', 'product', 'explicit_content', 'followers']) {
      expect(block).not.toMatch(new RegExp(`\\b${field}\\??:`));
    }
  });
});

describe('born red: each pattern catches the code it replaced', () => {
  const OLD_LINES: Array<[string, string]> = [
    ['POST /users/{id}/playlists and other /users/ paths', '    `/users/${userId}/playlists`,'],
    ['/playlists/{id}/tracks', '  }>(`/playlists/${playlistId}/tracks`, accessToken);'],
    ['/me/tracks, /me/albums, /me/following and the other per-type library paths', "    const response = await fetch('https://api.spotify.com/v1/me/tracks', {"],
    ['/browse/*', "spotifyFetch('/browse/new-releases', token)"],
    ['/markets', "spotifyFetch('/markets', token)"],
    ['/artists/{id}/top-tracks', 'spotifyFetch(`/artists/${id}/top-tracks`, token)'],
  ];
  for (const [name, line] of OLD_LINES) {
    it(`flags: ${line.trim()}`, () => {
      expect(removedEndpointHits(line)).toContain(name);
    });
  }

  it('does not flag ourWKRP routes or the new Spotify paths', () => {
    for (const ok of [
      "path.startsWith('/api/playlists/') && path.endsWith('/tracks')",
      "'/me/playlists'",
      '`/playlists/${playlistId}/items`',
      "new URL('https://api.spotify.com/v1/me/library')",
      "fetchAllPages<SpotifyPlaylist>('/me/playlists', accessToken)",
    ]) {
      expect(removedEndpointHits(ok)).toEqual([]);
    }
  });
});
