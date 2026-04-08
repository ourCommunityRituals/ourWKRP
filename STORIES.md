# STORIES.md — ourWKRP Story Backlog

---

### WKRP-1: Project Scaffold + Worker Entry
**Status:** ✅ DONE
**Sprint:** 1

**PO Acceptance Criteria:**
- [x] Worker boots and responds to /health
- [x] TypeScript strict mode, ESLint, Vitest configured
- [x] Wrangler.toml with KV + D1 bindings (staging + prod)
- [x] D1 migration for contributors, playlists, tracks, playlist_tracks

---

### WKRP-2: Spotify OAuth + PKCE Auth Flow
**Status:** ✅ DONE
**Prerequisite:** WKRP-1
**Sprint:** 1

**PO Acceptance Criteria:**
- [x] GET /auth/start validates name + generation, generates PKCE, redirects to Spotify
- [x] GET /auth/callback exchanges code, stores tokens in KV, creates contributor in D1
- [x] GET /auth/session/:token returns contributor profile
- [x] Token refresh logic auto-refreshes before Spotify API calls
- [x] No tokens leak to frontend (security tests verify)

---

### WKRP-3: Spotify Sync Engine
**Status:** ✅ DONE
**Prerequisite:** WKRP-2
**Sprint:** 1

**PO Acceptance Criteria:**
- [x] POST /spotify/sync/:userId pulls playlists -> tracks -> audio features
- [x] Uses snapshot_id for change detection (skip unchanged playlists)
- [x] Batch audio features (100 per request)
- [x] Rate limit retry with Retry-After header
- [x] Sync completes 20 playlists x 50 tracks under 5 seconds

---

### WKRP-4: Mobile-First Frontend
**Status:** ✅ DONE
**Prerequisite:** WKRP-3
**Sprint:** 1

**PO Acceptance Criteria:**
- [x] connect.html: name + generation form, Spotify button, error handling
- [x] catalog.html: loading state, search, filter chips, range sliders, bottom nav
- [x] create.html: playlist name/desc, audio feature filters, public toggle
- [x] Mobile-first CSS (390px breakpoint), dark theme, 44px+ touch targets
- [x] test-id attributes on all interactive elements

---

### WKRP-5: Testing Pyramid
**Status:** ✅ DONE
**Prerequisite:** WKRP-4
**Sprint:** 1

**PO Acceptance Criteria:**
- [x] 65 tests across unit, integration, contract, security, performance
- [x] All pass in < 2 seconds
- [x] E2E tests for connect flow + catalog browse (Playwright, mobile viewport)
- [x] k6 load test scripts (health, session, sync scenarios)
- [x] GitHub Actions CI pipeline (lint, typecheck, test, security)

---

### WKRP-6: Catalog API Endpoints
**Status:** 🚧 IN PROGRESS
**Prerequisite:** WKRP-5
**Sprint:** 2
**CCR Review:** Rewritten April 2026 — original depended on dead Spotify audio features API

**PO Acceptance Criteria:**
- [ ] `GET /api/tracks?genre=hip-hop&artist=kendrick&contributor=matt&year_min=2010` — filtered track list from D1
- [ ] `GET /api/tracks?q=searchterm` — full-text search on track name + artist name (FTS5)
- [ ] `GET /api/tracks?energy_min=0.7&valence_min=0.5` — audio feature filters (progressive enhancement, hidden if no data)
- [ ] `GET /api/playlists/:contributorId` — contributor's imported playlists
- [ ] `GET /api/contributors` — all contributors with track counts
- [ ] `GET /api/stats` — catalog stats (total tracks, contributors, top genres, top decades)
- [ ] Cursor-based pagination on all list endpoints (`?cursor=xxx&limit=25`)
- [ ] Genre data enriched from CSV imports (Exportify includes artist genres)

---

### WKRP-7: Playlist Builder (D1 MVP + Apple Music Push)
**Status:** 📋 BACKLOG
**Prerequisite:** WKRP-6
**Sprint:** 2
**CCR Review:** Rewritten April 2026 — Spotify API removed, Apple Music is publishing target

**PO Acceptance Criteria — MVP (D1-only):**
- [ ] `POST /api/playlists` — create playlist (name, description, brand_id) in D1
- [ ] `POST /api/playlists/:id/tracks` — add tracks to playlist by track IDs
- [ ] `DELETE /api/playlists/:id/tracks` — remove tracks from playlist
- [ ] `GET /api/playlists/:id` — playlist with full track list
- [ ] `GET /api/playlists/:id/export` — export playlist as JSON (track names + ISRCs for manual Apple Music import)
- [ ] Playlists attributed to creator (contributor_id) with role check (founder/curator can create)

**PO Acceptance Criteria — Apple Music Push (Phase 2, requires Apple Developer account):**
- [ ] `POST /api/playlists/:id/push/apple-music` — match tracks by ISRC, create in user's Apple Music library
- [ ] MusicKit JS on frontend for Apple Music auth (obtain MUT)
- [ ] Worker stores MUT in KV (`wkrp:apple_token:{userId}`)
- [ ] Returns Apple Music playlist URL + match report (X of Y tracks found)

---

### WKRP-8: Multi-Tenant Brand Support
**Status:** 📋 BACKLOG
**Prerequisite:** WKRP-6
**Sprint:** 2
**CCR Review:** Rewritten April 2026 — confirmed CF Workers wildcard routes viable

**PO Acceptance Criteria:**
- [ ] Wildcard route `*.ourwkrp.com/*` in wrangler.toml
- [ ] `brand_id` extracted from subdomain (e.g. `bronzeville.ourwkrp.com` -> brand_id = 'bronzeville')
- [ ] All catalog API queries scoped by brand_id
- [ ] Default brand_id = 'wkrp' when accessed via `ourwkrp.com` (no subdomain)
- [ ] `GET /api/brands` — list all brands with contributor/track counts
- [ ] CSS custom properties per brand (loaded from D1 `brands` table)
- [ ] New D1 migration: `brands` table (id, name, subdomain, primary_color, accent_color, logo_url, created_at)
- [ ] Cross-brand contributor discovery: `GET /api/contributors/:id/brands`

---

### WKRP-9: Infrastructure Deployment
**Status:** 🚧 IN PROGRESS
**Prerequisite:** WKRP-5
**Sprint:** 2
**CCR Review:** Rewritten April 2026 — Spotify redirect URIs removed, Apple Developer enrollment added

**PO Acceptance Criteria — Cloudflare:**
- [ ] Provision D1 database (staging + prod) via `wrangler d1 create`
- [ ] Run all D1 migrations on staging + prod
- [ ] Provision KV namespace (staging + prod) via `wrangler kv:namespace create`
- [ ] Update wrangler.toml with real database/namespace IDs
- [ ] Configure `ourwkrp.com` DNS in Cloudflare (A/CNAME records)
- [ ] Configure `*.ourwkrp.com` wildcard route for multi-tenant
- [ ] Deploy Worker to staging via `doppler run -c stg -- wrangler deploy`
- [ ] Smoke test: CSV import flow on staging
- [ ] Smoke test: Catalog browse on staging (search, filter, pagination)

**PO Acceptance Criteria — Apple Developer (parallel workstream):**
- [ ] Enroll in Apple Developer Program as Organization ($99/yr)
- [ ] Obtain D-U-N-S number for ourCommunityRituals (1-2 weeks)
- [ ] Create MusicKit key in Apple Developer portal
- [ ] Store MusicKit private key in Doppler (all envs)
- [ ] Add `APPLE_TEAM_ID`, `APPLE_KEY_ID` to Doppler config

---

### WKRP-10: Genre Discovery Links
**Status:** 📋 BACKLOG
**Prerequisite:** WKRP-6
**Sprint:** 2

**PO Acceptance Criteria:**
- [ ] Genre chips/tags in catalog UI link out to three external discovery sites
- [ ] Link order (top to bottom): Discogs → Last.fm → Every Noise
- [ ] Discogs: `https://www.discogs.com/search/?genre_exact={genre}` — physical catalog, labels, pressings
- [ ] Last.fm: `https://www.last.fm/tag/{genre}` — community tags, related artists/tracks
- [ ] Every Noise: `https://everynoise.com/engenremap-{genre}.html` — visual genre map (archival, frozen ~2023)
- [ ] Links open in new tab, no API keys required
- [ ] Genre tag tap shows contextual menu: "Filter catalog" + 3 external links
- [ ] Mobile-friendly: touch targets meet 44px minimum
