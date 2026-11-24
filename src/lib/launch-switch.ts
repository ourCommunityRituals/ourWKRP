/**
 * Launch switch: Spotify and DJ (owner decision, 2026-11-23).
 *
 * ourWKRP launches as public profiles and events that private people vote on.
 * Spotify and the DJ product are switched off for that launch, and their code
 * is kept: DJ may become its own product with its own music licensing, and
 * Spotify's development mode caps the app at 5 users.
 *
 * One setting, SPOTIFY_AND_DJ, a [vars] value:
 *   "off"         -> every route below answers 404, and pages drop their
 *                    Spotify and DJ links (the marked blocks in templates/).
 *   anything else -> unchanged behaviour (local dev, the e2e config, tests).
 *
 * The deployed environments carry "off" in wrangler.toml, staging and
 * production both. tests/security/launch-switch.invariant.spec.ts fails if
 * either one stops saying "off", so the switch cannot silently open on deploy.
 *
 * Left on, on purpose:
 *   - name-only sign-up, CSV import and Last.fm (not Spotify, no seat cap);
 *   - /auth/session/me and /auth/logout (every signed-in person needs them);
 *   - the OurSharedEvents seams (/api/events/:id/music, /api/sponsors/:id/report):
 *     service-token gated, and with no DJ sets they answer with empty, floored
 *     data rather than breaking the other product.
 */

export interface LaunchSwitchEnv {
  SPOTIFY_AND_DJ?: string;
}

export function spotifyAndDjOff(env: LaunchSwitchEnv): boolean {
  return env.SPOTIFY_AND_DJ === 'off';
}

/** True for every route the switch closes. */
export function isSpotifyOrDjRoute(method: string, path: string): boolean {
  if (method === 'GET' && (path === '/auth/start' || path === '/auth/callback')) return true;
  if (method === 'POST' && path.startsWith('/spotify/sync/')) return true;
  if (method === 'POST' && (path === '/api/sets' || path.startsWith('/api/sets/'))) return true;
  if (method === 'POST' && path === '/api/attributions') return true;
  if (method === 'GET' && (path === '/dashboard' || path.startsWith('/dj/'))) return true;
  return false;
}

/**
 * Remove each marked Spotify or DJ block from a page. Templates mark a block
 * as `<!-- spotify-dj:start -->...<!-- spotify-dj:end -->` in markup, or
 * `/* spotify-dj:start *\/.../* spotify-dj:end *\/` in a script.
 */
const MARKED_BLOCK = /(?:<!-- spotify-dj:start -->[\s\S]*?<!-- spotify-dj:end -->|\/\* spotify-dj:start \*\/[\s\S]*?\/\* spotify-dj:end \*\/)/g;

export function stripSpotifyAndDj(html: string): string {
  return html.replace(MARKED_BLOCK, '');
}
