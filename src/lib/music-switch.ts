/**
 * The music switch: one MUSIC_ENABLED setting (OW-224, step 7 of OSE-2222).
 *
 * ourWKRP launches as the named, plant-your-flag side of the scan-to-vote
 * launch, without its music slice (owner, 2026-11-24; ADR-040 decision 12 on
 * ourSharedEvents; plan "Option A": one setting, no repo split, no file or
 * table removed). Music can come back later by changing this one [vars] value,
 * with no rebuild of the code.
 *
 * It replaces the 2026-11-23 SPOTIFY_AND_DJ switch, which closed only Spotify
 * and DJ. Music is the larger set, so one setting now closes all of it.
 *
 * MUSIC_ENABLED, a [vars] value:
 *   "off"         -> every music path below answers the router's own 404, and
 *                    pages swap their marked music blocks for their marked
 *                    music-off blocks.
 *   anything else -> music is on, unchanged (local dev, the e2e config, tests).
 *
 * staging ([vars]) and production ([env.production.vars]) carry "off";
 * tests/security/music-switch.invariant.spec.ts fails if either stops saying
 * it. CI runs the page smoke twice, once with music on and once with it off.
 *
 * Closed with music off (any method on the path):
 *   - Spotify sign-in and sync: /auth/start, /auth/callback, /spotify/*
 *   - Last.fm sign-in and sync: /auth/lastfm/*, /lastfm/*
 *   - CSV import: /import/:id
 *   - catalog and stats APIs: /api/tracks, /api/stats, /api/layers, /api/export/*
 *   - playlists and the portfolio: /api/playlists*, /api/portfolio*,
 *     /api/contributors/:id/portfolio
 *   - DJ sets and attributions: /api/sets*, /api/attributions, /dj/*
 *   - the OurSharedEvents music and sponsor seams: /api/events/*, /api/sponsors/*
 *   - the music pages: /catalog, /create, /import, /dashboard, /stats
 *
 * Kept on: sign-up by name, sessions, the admin role grant, profiles
 * (/contributor/:id, /c/:slug, /api/contributors[/:id[/brands]], slug, type and
 * votable), /api/brands, facets, erasure, /health and /ui.css. The router's
 * header comment lists every route; tests/unit/music-switch.test.ts reads it
 * and checks that each route is either closed here or named as kept.
 */

export interface MusicSwitchEnv {
  MUSIC_ENABLED?: string;
}

export function musicOff(env: MusicSwitchEnv): boolean {
  return env.MUSIC_ENABLED === 'off';
}

const MUSIC_EXACT = new Set([
  '/auth/start',
  '/auth/callback',
  '/api/tracks',
  '/api/stats',
  '/api/layers',
  '/api/playlists',
  '/api/portfolio',
  '/api/sets',
  '/api/attributions',
  '/catalog',
  '/create',
  '/import',
  '/dashboard',
  '/stats',
]);

const MUSIC_PREFIXES = [
  '/spotify/',
  '/auth/lastfm/',
  '/lastfm/',
  '/import/',
  '/api/export/',
  '/api/playlists/',
  '/api/portfolio/',
  '/api/sets/',
  '/dj/',
  '/api/events/',
  '/api/sponsors/',
];

/** True for every path the switch closes. */
export function isMusicPath(path: string): boolean {
  if (MUSIC_EXACT.has(path)) return true;
  if (MUSIC_PREFIXES.some((p) => path.startsWith(p))) return true;
  return path.startsWith('/api/contributors/') && path.endsWith('/portfolio');
}

/**
 * Keep one kind of marked block in a page and drop the other. Templates mark
 * music as `<!-- music:start -->...<!-- music:end -->` in markup or
 * `/* music:start *\/.../* music:end *\/` in a script, and what replaces it
 * with music off as `music-off:start` / `music-off:end` in the same two forms.
 * Both kinds are always resolved, so no marker reaches a browser.
 */
const MUSIC_BLOCK = /(?:<!-- music:start -->[\s\S]*?<!-- music:end -->|\/\* music:start \*\/[\s\S]*?\/\* music:end \*\/)/g;
const MUSIC_OFF_BLOCK = /(?:<!-- music-off:start -->[\s\S]*?<!-- music-off:end -->|\/\* music-off:start \*\/[\s\S]*?\/\* music-off:end \*\/)/g;
const MUSIC_OFF_MARKER = /<!-- music-off:(?:start|end) -->|\/\* music-off:(?:start|end) \*\//g;
const MUSIC_MARKER = /<!-- music:(?:start|end) -->|\/\* music:(?:start|end) \*\//g;

export function applyMusicSwitch(html: string, off: boolean): string {
  return off
    ? html.replace(MUSIC_BLOCK, '').replace(MUSIC_OFF_MARKER, '')
    : html.replace(MUSIC_OFF_BLOCK, '').replace(MUSIC_MARKER, '');
}
