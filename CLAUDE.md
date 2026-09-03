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

| Layer | Tool | Count |
|-------|------|-------|
| Unit | Vitest | 35+ tests |
| Integration | Vitest | 3+ tests |
| Contract | Vitest (Pact-style) | 10+ tests |
| Security | Vitest | 21+ tests |
| E2E | Playwright | 12+ tests |
| Performance | Vitest + k6 | 1+ bench + 3 scenarios |

**~605 test cases across ~60 files** (unit, integration, contract, security, e2e, fuzz, performance — plus k6 load scripts, Postman/Newman collections, and Python `level0_security.py` gates). The table above understates current counts; run the suites for ground truth.

Run: `npm test` (unit + integration + contract + security + performance)
Run: `npm run test:e2e` (Playwright, requires wrangler dev)

---

## 4. ourCommunityRituals Ecosystem

> Registry of record: `OCR-docs/ocr-docs-brain/product-registry.yaml` (mirrored in `OCR-docs/docs/OCR_VISION.md` §7; vendored copy `.ocr-standards/docs/OCR_VISION.md`). OW's product-vision pointer is `docs/OCR_VISION.md`.
>
> **identity_mode: named** — OW is the named layer (voluntary attribution); OSE is the anonymous base. Separate databases, never joined (brain #22 cross-repo import isolation).

| Code | Product | Repo | Purpose |
|---|---|---|---|
| OCR | OurCommunityRituals LLC | `ourCommunityRituals/OCR-docs` | Org brain · governance |
| OSE | ourSharedEvents | `ourCommunityRituals/ourSharedEvents` | The platform — anonymous ID, sponsor model (OW consumes its SharedReport API, ADR-011) |
| **OW** | **ourWKRP** _(this repo)_ | `ourCommunityRituals/ourWKRP` | Community music curation — named identity, free |
| OSR | OurSharedRecords | `ourCommunityRituals/ourSharedRecords` | Music, story, archive — oral history ("OurRecordStories" in older notes; joins via `wkrp:contributors`) |
| OSG | OurSharedGames | `ourCommunityRituals/ourSharedGames` | Founding activation format — anchor game nights (leagues formerly sketched as "ourRecNights") |
| OA | OurAirwaves | `ourCommunityRituals/ourAirwaves` | Deployment + white label — every DJ profile is a single-person OA deployment |

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
Configs: `dev`, `stg`, `prd`

| Secret | Doppler Config | Purpose |
|--------|---------------|---------|
| SPOTIFY_CLIENT_ID | all | Spotify app ID (`b0af039c67b14c2fbeb1f5ab0b5ff662`) |
| SPOTIFY_REDIRECT_URI | per-env | OAuth callback URL |
| APP_URL | per-env | Frontend base URL |
| KV namespace ID | wrangler.toml | Auth/session state (CF infra, not a secret) |
| D1 database ID | wrangler.toml | Catalog data (CF infra, not a secret) |

No client_secret needed — PKCE flow.

### Doppler Setup
```bash
# First time
doppler login
doppler setup            # select ourwkrp project + dev config

# Local dev
doppler run -- wrangler dev

# Deploy staging
doppler run -c stg -- wrangler deploy

# Deploy production
doppler run -c prd -- wrangler deploy --env production
```

### Doppler Config Values

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

*Doc status: corrected for drift 2026-08-28 (OCR-111 — register-first auth, route/template/test counts, session semantics, dead branch removed). Source of truth remains the code: `src/router.ts` header for routes, `migrations/` for schema.*
