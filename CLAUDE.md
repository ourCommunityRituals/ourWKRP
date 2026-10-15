# CLAUDE.md — Persistent Brain for ourWKRP

> **Session protocol**: Read this file -> Understand the architecture -> Branch from `main` per Linear story (the old `claude/spotify-auth-mobile-q8O6D` branch is gone). The canonical route table is the header comment in `src/router.ts`; the canonical schema is `migrations/`.

---

## 1. What is ourWKRP?

Mobile-first community music catalog platform. Contributors register with just a name (`POST /auth/register` — no third-party account required; "the act of registering is the consent") and may optionally link Spotify (OAuth PKCE), Last.fm, or CSV-import their library. Linked libraries sync progressively (playlists -> tracks -> audio features where available), and anyone can browse, filter, and create playlists from analyzed data. Public surfaces need no session at all: the catalog, contributor profiles (`/contributor/:id`), portfolios, and DJ live/poster pages are open.

Designed to scale from a local community (50-100 people) to white-labeled instances per neighborhood/venue:
- **Bronzeville's ourWKRP**
- **Reckless Records' ourWKRP**
- Each dovetails with **OurRecordStories**

### User Flow (3 Screens)
1. **Screen 1 — Add Contributor**: Name entry with three CTAs — "Bring Your Music" / "Browse the Catalog" (both hit `POST /auth/register`, no Spotify) and a smaller "Or connect with Spotify" link
2. **Screen 2 — Spotify Login (optional)**: Browser opens Spotify OAuth, user approves, Worker handles callback
3. **Screen 3 — Loading -> Catalog**: "Matt connected — syncing library..." -> catalog with filters

After Screen 2, **all Spotify work is backend**. User never sees tokens or URLs. Spotify is a *linked account*, not an identity prerequisite. Known issue (OW-120): a 403 from the deprecated `/audio-features` endpoint currently fails silently — sync reports success with zero features written.

---

## 2. Architecture

One self-contained Cloudflare Worker serves frontend HTML + Spotify backend API.

**Spotify Client ID**: `b0af039c67b14c2fbeb1f5ab0b5ff662`
**Auth**: Authorization Code Flow + PKCE (no client_secret needed)
**Storage**: D1 (relational catalog) + KV (auth/session state)
**Domain**: `ourwkrp.com` (stg + prod in Cloudflare)

### Worker Structure
```
src/
├── index.ts                 # Worker entry point
├── router.ts                # Route dispatcher (~54 branches — its header comment is the canonical route table)
├── types.ts                 # Env, Contributor, Track, Playlist types
├── html.d.ts                # TypeScript HTML import declarations
├── auth/
│   ├── spotify-oauth.ts     # PKCE generation, token exchange
│   └── token-refresh.ts     # Auto-refresh before API calls
├── handlers/
│   ├── health.ts            # GET /health
│   ├── auth-start.ts        # GET /auth/start
│   ├── auth-callback.ts     # GET /auth/callback
│   ├── auth-session.ts      # GET /auth/session/:token
│   ├── sync.ts              # POST /spotify/sync/:userId
│   └── pages.ts             # HTML page serving
├── spotify/
│   ├── client.ts            # Spotify API wrapper (native fetch, rate limit retry)
│   └── sync-engine.ts       # playlists -> tracks -> audio features
├── lib/
│   ├── kv-storage.ts        # KV helpers (wkrp:* keys)
│   ├── cors.ts              # CORS headers
│   └── logger.ts            # Verbose structured logging
└── templates/               # 9 templates, all mobile-first, per-request CSP nonces
    ├── connect.html          # Screen 1+2 (name entry + optional Spotify)
    ├── catalog.html          # Screen 3 (loading -> browse/filter)
    ├── create.html           # Playlist builder
    ├── profile.html          # Public contributor profile
    ├── import.html           # CSV (Exportify) import
    ├── live.html             # Public DJ live set (/dj/:id)
    ├── qr-poster.html        # Printable QR poster (/dj/:id/poster)
    ├── dashboard.html        # DJ dashboard
    └── stats.html            # Catalog stats
```

### Styling — the shared @ocr/ui design system (ADR-008)
Every template links `/ui.css` (served by `router.ts` via `serveCss` from `@ocr/ui`) and sets `<html data-brand="ow">` — amber on black in dark, burnt amber on warm paper in light, registered as `brandThemes.ow` in the hub. Templates keep only a tiny page `<style>` (≤400 chars, no tokens, no hex); anything bigger belongs in the hub's `styles.ts` "named surfaces (ourWKRP)" section. `--live` is the fleet teal and destructive actions use `.btn-danger` — both locked, the brand cannot recolour them. The hub commit is pinned in `.ocr-hub-ref` (CI stages exactly that SHA), and the blocking **Design check** step runs the hub's `check-spoke-styles.mjs` against `.ocr-design-check.json` — its baseline may only shrink.

**Pin and token hygiene (CCR OSE-1393, 2026-09-29).** Pinned at hub `b96b2c8`. `scripts/ci-stage-ocr-workspace.sh` refuses a pin that is not on hub `main` and prints `::error::` on failure. `OCR_HUB_READ` is a read-only token (Contents: read on the hub and OCR-docs; it replaced the all-repository write token, OSE-1695), and it still lives only as step-scoped `env:` on the staging steps, passed as a transient `http.extraheader` — never workflow-level, never in a clone URL. On PRs the design check runs with `--base-config` (main's `.ocr-design-check.json`), so a PR cannot raise its own baseline. `mobile-workability.yml` stages the pin before `npm ci`. `tests/security/adr008-wiring.invariant.spec.ts` locks all of this. `/ui.css` revalidates by ETag (`tests/unit/ui-css-cache.test.ts`), so a pin bump reaches browsers immediately.

### Endpoints (core subset — see `src/router.ts` header for the full ~54-route table)
| Method | Path | Purpose |
|--------|------|---------|
| GET | /health | Health check |
| GET | / | Connect page (client-side redirect to catalog if session) |
| GET | /catalog, /create, /import, /dashboard, /stats | App pages |
| GET | /contributor/:id | Public profile page |
| GET | /dj/:id, /dj/:id/poster | Public live-set page + printable QR poster |
| POST | /auth/register | **Spotify-free signup** (name only) -> contributor + session |
| GET | /auth/start | PKCE -> KV -> redirect to Spotify (optional link) |
| GET | /auth/callback | Exchange code -> store tokens -> redirect |
| GET | /auth/session/me | Session JSON (cookie-based; no token in URL) |
| POST | /auth/logout | Clear session |
| POST | /spotify/sync/:userId | Sync playlists/tracks/audio-features -> D1 (session + ownership + cooldown) |
| GET | /api/tracks, /api/contributors, /api/stats, /api/playlists/:id, … | Public catalog API |
| POST | /api/playlists, /api/portfolio, /api/sets, … | Session-gated mutations |
| GET/POST | /auth/lastfm/*, /lastfm/sync/:userId | Last.fm link + sync |
| GET | /api/events/:eventId/music | Cross-product seam for OSE (aggregate-only) |
| DELETE | /api/contributors/:id/identity | Right to erasure |

### Data Model
**D1**: contributors, playlists, tracks, playlist_tracks (with audio feature indexes)
**KV**: auth state (10min TTL), sessions (30-day **absolute** + 7-day **idle** timeout, hourly-throttled touch — `lib/session.ts`), tokens, lastfm session, last_sync

### Multi-tenant
`brand_id` column on contributors. Default: 'wkrp'. Future: 'bronzeville', 'reckless', etc.

---

## 3. Testing

Counts below are a static count of `it()`/`test()` blocks (incl. `.each`/`.skip`/`.only`) per `tests/<layer>/`, measured 2026-09-10 (OSE-1292 / F14). Run the suites for the authoritative collected count; these are the order-of-magnitude ground truth, not a hand-maintained guess.

| Layer | Tool | Count (blocks / files) |
|-------|------|-------|
| Unit | Vitest | ~435 / 36 |
| Security | Vitest | ~262 / 20 |
| Integration | Vitest | ~67 / 6 |
| E2E | Playwright | ~50 / 13 |
| Contract | Vitest (Pact-style) | ~28 / 3 |
| Fuzz / Property | Vitest (fast-check) | ~18 / 4 |
| Performance | Vitest + k6 | ~13 / 2 (+ k6 scenarios) |

**≈873 `it`/`test` blocks across ~84 files** — plus k6 load scripts, Bruno API contract collections (`bruno/wkrp-api`, ex-Newman), and the Python `level0_security.py` gate. (The pre-2026-09 doc said "65 tests" / "~605"; both were stale by roughly an order of magnitude — hence this measured refresh.)

### Invariant enforcement (how the shared constitution binds WKRP)

WKRP enforces the OCR governance brain (`OCR-docs/ocr-docs-brain`) through two mechanisms, both blocking on PR:

1. **Security-tier invariant specs** — `tests/security/*.invariant.spec.ts` (e.g. `deprecation-lock`, `explicit-identity`, `no-biometrics`, and `cross-repo-import-isolation`) run in the **Security Tests** job (`npm run test:security`). `vitest.config.ts` includes `**/*.invariant.spec.ts`. Each is a structural tripwire plus an anti-theater lock that its own CI wiring cannot silently vanish.
2. **Brain conformance gate** — `.github/workflows/brain-contract-check.yml` checks out the brain (live from OCR-docs `main`) and runs `check_brain_contract.py --repo wkrp --product-id wkrp` (blocking), so WKRP code cannot drift from what the brain declares.

**Invariant #22 (Cross-Repo Import Isolation) is now enforced on the WKRP side** (F13 / OSE-1288, ourWKRP#59, 2026-09-10): `brain-contract-check.yml` runs the canonical live-read brain guard `check_cross_repo_imports.py --product-id wkrp`, and `tests/security/cross-repo-import-isolation.invariant.spec.ts` locks the wiring. #22 declares `enforcement_kind: brain_script`; WKRP is `block` in the brain's `enforcement_mode` plane.

**No `0-architecture` tier.** Unlike OSE (which has `tests/e2e/0-architecture/` invariant gates), WKRP carries its architectural invariants inside the **security tier** (`tests/security/*.invariant.spec.ts`), not a dedicated `0-architecture` directory.

Run: `npm test` (unit + integration + contract + security + performance)
Run: `npm run test:e2e` (Playwright, requires wrangler dev)
Run: `npm run test:security` (security tier — includes the invariant specs)

---

## 4. ourCommunityRituals Ecosystem

| Product | Repo | Purpose |
|---|---|---|
| **ourSharedEvents** | `ourCommunityRituals/ourSharedEvents` | Core platform — event infrastructure |
| **ourWKRP** | `ourCommunityRituals/ourWKRP` | Music catalog — Spotify integration |
| **ourRecNights** | `ourCommunityRituals/ourRecNights` | Recreational night leagues |
| **OurRecordStories** | — | Record stories (joins via wkrp:contributors) |

---

## 5. Spotify Redirect URIs

Registered at developer.spotify.com for app `b0af039c67b14c2fbeb1f5ab0b5ff662`:
- `http://localhost:8787/auth/callback` (local dev)
- `https://stg.ourwkrp.com/auth/callback` (staging)
- `https://ourwkrp.com/auth/callback` (production)

---

## 6. Secrets / Config — Doppler

**Secrets manager: [Doppler](https://doppler.com)**

Doppler project: `ourwkrp`
Runtime configs: `dev`, `stg`, `prd`. Deploy keys live in a separate Doppler project, `ourwkrp-deploy` (configs `stg`, `prd`; ADR-012 §3). A separate project, not more environments here, because Doppler's free plan allows 4 environments per project.

| Value | Where it lives | Purpose |
|--------|---------------|---------|
| SPOTIFY_CLIENT_ID | `wrangler.toml` `[vars]` (public) | Spotify app ID (`b0af039c67b14c2fbeb1f5ab0b5ff662`) |
| SPOTIFY_REDIRECT_URI | `wrangler.toml` `[vars]`, per env (public) | OAuth callback URL |
| APP_URL | `wrangler.toml` `[vars]`, per env (public) | Frontend base URL; must pass that env's redirect allowlist |
| CLOUDFLARE_API_TOKEN_OW | Doppler `ourwkrp-deploy/stg` + `ourwkrp-deploy/prd` only (secret) | Deploys and migrates. The Cloudflare token is named `ourwkrp-ci-deploy` and rotated every 90 days with `npm run deploy-keys` (PLAYBOOK 4.5). `scripts/ci/wrangler-ci.sh` checks the config and hands it to wrangler as `CLOUDFLARE_API_TOKEN`. GitHub holds only the read-only service tokens `DOPPLER_TOKEN_STG` / `DOPPLER_TOKEN_PRD`, as environment secrets, one per deploy config |
| KV namespace ID | wrangler.toml | Auth/session state (CF infra, not a secret) |
| D1 database ID | wrangler.toml | Catalog data (CF infra, not a secret) |

**Public config is not in Doppler** (OW-153). `wrangler deploy` uploads the `[vars]` tables as-is; the process environment that `doppler run` sets does not change them. So `APP_URL` / `SPOTIFY_REDIRECT_URI` / `SPOTIFY_CLIENT_ID` are set in `wrangler.toml` (top-level `[vars]` = staging, `[env.production.vars]` = production), and `tests/security/redirect-allowlist-env.test.ts` checks each against its environment's redirect allowlist. For local `wrangler dev`, put the localhost values in `.dev.vars` (gitignored). Doppler holds secrets only.

No client_secret needed — PKCE flow.

### Doppler Setup
```bash
# First time
doppler login
doppler setup            # select ourwkrp project + dev config

# Local dev
doppler run -- wrangler dev

# Deploy staging (Doppler ourwkrp-deploy/stg)
npm run deploy:staging

# Deploy production (Doppler ourwkrp-deploy/prd)
npm run deploy:prod
```

### Public config values per environment

`dev` → `.dev.vars`; `stg` → top-level `[vars]`; `prd` → `[env.production.vars]`.

**dev:**
```
SPOTIFY_CLIENT_ID=b0af039c67b14c2fbeb1f5ab0b5ff662
SPOTIFY_REDIRECT_URI=http://localhost:8787/auth/callback
APP_URL=http://localhost:8787
```

**stg:**
```
SPOTIFY_CLIENT_ID=b0af039c67b14c2fbeb1f5ab0b5ff662
SPOTIFY_REDIRECT_URI=https://stg.ourwkrp.com/auth/callback
APP_URL=https://stg.ourwkrp.com
```

**prd:**
```
SPOTIFY_CLIENT_ID=b0af039c67b14c2fbeb1f5ab0b5ff662
SPOTIFY_REDIRECT_URI=https://ourwkrp.com/auth/callback
APP_URL=https://ourwkrp.com
```

---

*Doc status: corrected for drift 2026-08-28 (OCR-111 — register-first auth, route/template/test counts, session semantics, dead branch removed); test counts re-measured + invariant-enforcement / brain-conformance / #22-gate mechanisms documented 2026-09-10 (OSE-1292 / F14). Source of truth remains the code: `src/router.ts` header for routes, `migrations/` for schema, and the suites themselves for the authoritative test count.*
