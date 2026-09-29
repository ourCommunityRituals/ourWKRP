import type { AppManifest } from './types';

/**
 * WKRP page surfaces — paths verified against src/handlers/pages.ts dispatch:
 *   /            → connect (redirects to /catalog when session cookie present)
 *   /catalog /create /dashboard /stats /import
 *   /dj/{id}/poster → qr-poster,  /dj/{id}(…) → live,  /contributor/{id} → profile
 *
 * dashboard/create are role-gated client-side: they render a loading view then
 * either the app or an access-denied view. The gate flag asserts the denied
 * path is humane (empty-state with an on-ramp once @ocr/ui partials land).
 *
 * sharedSheet: every page links /ui.css with <= 400 chars of inline CSS (the
 * pages moved onto @ocr/ui with the "ow" brand). It stays off for the two gate
 * routes only because it also switches on the "gate is an .empty-state with a
 * next step" assertion, and their gates are not the emptyState partial yet.
 */
export const wkrpManifest: AppManifest = {
  app: 'wkrp',
  minTap: 48,
  routes: [
    { path: '/', name: 'connect', anchor: 'body', sharedSheet: true },
    { path: '/catalog', name: 'catalog', anchor: 'body', sharedSheet: true },
    { path: '/create', name: 'create playlist', anchor: 'body', gate: true },
    { path: '/dashboard', name: 'dj dashboard', anchor: 'body', gate: true },
    { path: '/stats', name: 'stats', anchor: 'body', sharedSheet: true },
    { path: '/import', name: 'import', anchor: 'body', sharedSheet: true },
    { path: '/dj/{id}', name: 'live set (public attribution)', anchor: 'body',
      fixtureEnv: 'SMOKE_DJ_ID', sharedSheet: true },
    { path: '/dj/{id}/poster', name: 'qr poster', anchor: 'body',
      fixtureEnv: 'SMOKE_DJ_ID', allowHScroll: true, sharedSheet: true },
    { path: '/contributor/{id}', name: 'contributor profile', anchor: 'body',
      fixtureEnv: 'SMOKE_CONTRIBUTOR_ID', sharedSheet: true },
  ],
};
