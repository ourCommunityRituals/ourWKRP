# The music switch (`MUSIC_ENABLED`)

**Story:** OW-224, step 7 of epic OSE-2222 (scan to vote at events and markets).
**Decision:** owner, 2026-11-24, recorded in ourSharedEvents ADR-040 decision 12
(PR #1543). The plan chose "Option A": one setting, no repo split, no file or
table removed.
**Code:** `src/lib/music-switch.ts`.

## Why

ourWKRP launches as the named, plant-your-flag side of the OSE and ourWKRP
hybrid: people sign up by name, keep a profile, and declare what they do. The
DJ and music slice (about 60% of the code) is not needed for that launch, so
it is switched off rather than split out. Turning it back on is a one-line
config change with no rebuild.

It replaces the 2026-11-23 `SPOTIFY_AND_DJ` switch. That one closed only
Spotify and DJ. Music is the larger set, so one setting now closes all of it.

## The setting

`MUSIC_ENABLED` is a `[vars]` value.

| Value | Effect |
| --- | --- |
| `"off"` | Every music route answers the router's own 404 (`{ ok: false, status: 404, error: "Not found" }`), the same answer as a route that does not exist. Pages drop their music blocks and show their music-off blocks. |
| anything else, or unset | Music is on. Nothing changes. |

| Environment | Where | Value |
| --- | --- | --- |
| staging | `wrangler.toml` `[vars]` | `"off"` |
| production | `wrangler.toml` `[env.production.vars]` | `"off"` |
| local dev and e2e | `wrangler.e2e.toml` `[vars]`; add `MUSIC_ENABLED=on` to `.dev.vars` when running against `wrangler.toml` | `"on"` |
| CI music-off smoke | `wrangler dev --var MUSIC_ENABLED:off` (`playwright.config.ts`, when `MUSIC_ENABLED=off` is in the environment) | `"off"` |

To bring music back on staging or production, change that environment's value
to `"on"` and update `tests/security/music-switch.invariant.spec.ts` in the
same pull request. That spec fails while a deployed environment does not say
`"off"`, so the switch cannot open by accident.

## What closes and what stays

Closed with music off (any method on the path):

- Spotify sign-in and sync: `/auth/start`, `/auth/callback`, `/spotify/*`
- Last.fm sign-in and sync: `/auth/lastfm/*`, `/lastfm/*`
- CSV import: `/import/:id`
- Catalog and stats APIs: `/api/tracks`, `/api/stats`, `/api/layers`, `/api/export/*`
- Playlists and the portfolio: `/api/playlists*`, `/api/portfolio*`, `/api/contributors/:id/portfolio`
- DJ sets and attributions: `/api/sets*`, `/api/attributions`, `/dj/*`
- The OurSharedEvents music and sponsor seams: `/api/events/*`, `/api/sponsors/*`
- The music pages: `/catalog`, `/create`, `/import`, `/dashboard`, `/stats`

Kept on:

- `/health`, `/ui.css`, `/` (the connect page)
- Sign-up by name (`POST /auth/register`), `/auth/session/me`, `/auth/logout`
- The admin role grant (`POST /admin/roles/grant`)
- Profiles: `/contributor/:id`, `/c/:slug`, `/api/contributors`,
  `/api/contributors/:id`, `/api/contributors/:id/brands`,
  `POST /api/profile/slug`, `POST /api/profile/type`
- `/api/brands`
- Facets: `POST /api/facets`, `DELETE /api/facets/:id`
- Erasure: `DELETE /api/contributors/:id/identity`

Nothing is deleted. Every music file, test and table stays, so the mutation
floors (`mutation-floors.json`, a ratchet) and the brain's `identity_contract`
are unchanged.

## Pages

Templates mark what depends on the switch:

- `<!-- music:start -->` ... `<!-- music:end -->` in markup, or
  `/* music:start */` ... `/* music:end */` in a script: shown only with music on.
- `<!-- music-off:start -->` ... `<!-- music-off:end -->`, or the script form:
  shown only with music off.

`handlePages` always resolves both kinds through `applyMusicSwitch`, so no
marker reaches a browser. Markers do not nest.

With music off:

- **Connect page (`/`).** "Bring Your Music", "Browse the Catalog" and "Or
  connect with Spotify" give way to one "Make Your Profile" button. It signs
  the person up by name and opens their new profile. A signed-in visitor goes
  to their own profile instead of the catalog.
- **Profile page.** The track and playlist counts, genres, playlists,
  portfolio, DJ influence, sources, the bottom navigation to music pages and
  the genre pop-up are left out, with the scripts that drive them. The header,
  facets and communities stay.

The words on the front door are the next story's (OW-225).

## Tests

| Test | What it proves |
| --- | --- |
| `tests/unit/music-switch.test.ts` | Reads the route table in the header comment of `src/router.ts`. With music off, every route not named as kept answers the 404, so a music route left out of the switch fails here. With music on or unset, none of them is closed. Pages swap their blocks, and no template leaves a marker behind. |
| `tests/integration/music-off.test.ts` | With music off, on real D1 and KV (Miniflare): sign-up, session, profile, slug, profile type, facets and erasure work, and music routes on the same rig answer 404. |
| `tests/security/music-switch.invariant.spec.ts` | Staging and production say `"off"`, the e2e config says `"on"`, `SPOTIFY_AND_DJ` is gone, the router and the page handler consult the switch, and CI runs the page smoke both ways. |
| CI, E2E job | The Tier-1 page smoke runs twice: music on (all nine pages) and music off (the kept pages get every check; each music page must answer 404). The e2e journeys run with music on. |

A new route added to the router's header comment is closed by the switch
unless `tests/unit/music-switch.test.ts` names it as kept, and the switch
itself must then close it (`isMusicPath`) or the test fails.
