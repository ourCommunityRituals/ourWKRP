# CLAUDE.md — Persistent Brain for ourWKRP

> **Session protocol**: Read this file -> Understand the architecture -> Continue development on `claude/spotify-auth-mobile-q8O6D` branch.

---

## 1. What is ourWKRP?

Mobile-first Spotify music catalog platform. Contributors authenticate once via Spotify, their library syncs progressively (playlists -> tracks -> audio features), and they can browse, filter, and create playlists from analyzed data.

Designed to scale from a local community (50-100 people) to white-labeled instances per neighborhood/venue:
- **Bronzeville's ourWKRP**
- **Reckless Records' ourWKRP**
- Each dovetails with **OurRecordStories**

### User Flow (3 Screens)
1. **Screen 1 — Add Contributor**: Name + generation (founder/gen2/gen3) + "Connect with Spotify"
2. **Screen 2 — Spotify Login**: Browser opens Spotify OAuth, user approves, Worker handles callback
3. **Screen 3 — Loading -> Catalog**: "Matt connected — syncing library..." -> catalog with filters

After Screen 2, **all Spotify work is backend**. User never sees tokens or URLs.

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
├── router.ts                # Route dispatcher (10 routes)
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
└── templates/
    ├── connect.html          # Screen 1+2 (mobile-first form)
    ├── catalog.html          # Screen 3 (loading -> browse/filter)
    └── create.html           # Playlist builder
```

### Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | /health | Health check |
| GET | / | Connect page (or catalog if session) |
| GET | /catalog | Catalog page |
| GET | /create | Playlist creation page |
| GET | /auth/start | PKCE -> KV -> redirect to Spotify |
| GET | /auth/callback | Exchange code -> store tokens -> redirect |
| GET | /auth/session/:token | Contributor profile JSON |
| POST | /spotify/sync/:userId | Sync playlists/tracks/audio-features -> D1 |

### Data Model
**D1**: contributors, playlists, tracks, playlist_tracks (with audio feature indexes)
**KV**: auth state (10min TTL), sessions (30-day TTL), tokens, last_sync

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

**65 tests total, all passing.**

Run: `npm test` (unit + integration + contract + security + performance)
Run: `npm run test:e2e` (Playwright, requires wrangler dev)

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
Configs: `dev`, `stg`, `prd`

| Secret | Doppler Config | Purpose |
|--------|---------------|---------|
| SPOTIFY_CLIENT_ID | all | Spotify app ID (`b0af039c67b14c2fbeb1f5ab0b5ff662`) |
| SPOTIFY_REDIRECT_URI | per-env | OAuth callback URL |
| APP_URL | per-env | Frontend base URL |
| KV namespace ID | wrangler.toml | Auth/session state (CF infra, not a secret) |
| D1 database ID | wrangler.toml | Catalog data (CF infra, not a secret) |

No client_secret needed — PKCE flow.

---

## 7. Linear Integration

**Team**: ourWKRP (`WKRP2`)
**Board**: https://linear.app/oursharedevents/team/WKRP2
**CCR Document**: https://linear.app/oursharedevents/document/ourwkrp-ccr-assessment-product-vision-1ab0b3ea0a41

Stories use dual IDs: `WKRP-N` (story ID in STORIES.md) and `WKRP2-N` (Linear issue ID).
See STORIES.md for the full mapping table.

### Current Sprint (Sprint 2)
- **WKRP-6** (WKRP2-6) Mobile Auth — Deep Link + Universal Links — **URGENT, In Progress**
- WKRP-7 (WKRP2-7) Session Management — Secure HttpOnly Cookies
- WKRP-8 (WKRP2-8) Rate Limiting + Abuse Prevention
- WKRP-9 (WKRP2-9) Input Validation — Zod Schemas
- WKRP-10 (WKRP2-10) Spotify Search API
- WKRP-11 (WKRP2-15) Track Discovery + Search UI

---

## 8. Story Lifecycle

1. Pick next unstarted story from STORIES.md (or Linear board)
2. Move to **In Progress** in Linear
3. Implement: routes, handlers, tests, migrations
4. All tests pass (`npm test` + `npm run test:e2e`)
5. Commit with `WKRP-N:` prefix in message
6. Push to feature branch, create PR
7. Move to **Done** in Linear after merge
8. Update STORIES.md status

---

## 9. CCR Assessment Summary

**Compliance**: Mobile auth broken (WKRP-6), no CSRF (WKRP-7), ad-hoc validation (WKRP-9)
**Catalog**: Manual URI paste only, no search UI (WKRP-10/11)
**Reliability**: No rate limiting (WKRP-8), no backups (WKRP-24), no load tests (WKRP-27)

Full assessment in the Linear CCR document linked above.

---

## 10. Dependencies + Blockers

| Story | Blocked By | Reason |
|-------|-----------|--------|
| WKRP-11 | WKRP-10 | Search UI needs Search API endpoint |
| WKRP-12 | WKRP-3 | WebSocket collab needs playlist CRUD |
| WKRP-30 | WKRP-3, WKRP-5 | Bridge needs playlist + export |

---

## 11. Bridge — ourSharedEvents

WKRP-30 links ourWKRP playlists to ourSharedEvents events via `event_playlists` junction table.
- API: `POST /events/:id/playlists`, `GET /events/:id/playlists`
- ourSharedEvents embeds playlist widget
- Export includes event metadata in Spotify playlist description

---

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
