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
**Status:** 📋 BACKLOG
**Prerequisite:** WKRP-5

**PO Acceptance Criteria:**
- [ ] GET /api/tracks?energy_min=0.7&valence_min=0.5 — filtered track list from D1
- [ ] GET /api/playlists/:contributorId — contributor's playlists
- [ ] GET /api/stats — catalog stats (total tracks, contributors, top genres)
- [ ] Pagination support (offset + limit)

---

### WKRP-7: Create Playlist Flow
**Status:** 📋 BACKLOG
**Prerequisite:** WKRP-6

**PO Acceptance Criteria:**
- [ ] POST /spotify/create-playlist/:userId with filter params
- [ ] Query D1 for matching tracks based on audio feature filters
- [ ] Create playlist on Spotify via API
- [ ] Add matching tracks to new playlist
- [ ] Return playlist URL to frontend

---

### WKRP-8: Multi-Tenant Brand Support
**Status:** 📋 BACKLOG
**Prerequisite:** WKRP-7

**PO Acceptance Criteria:**
- [ ] brand_id routing (e.g. bronzeville.ourwkrp.com, reckless.ourwkrp.com)
- [ ] Per-brand catalog isolation
- [ ] Cross-brand contributor discovery for OurRecordStories join
- [ ] Brand-specific theming (CSS custom properties)

---

### WKRP-9: Infrastructure Deployment
**Status:** 📋 BACKLOG
**Prerequisite:** WKRP-5

**PO Acceptance Criteria:**
- [ ] Provision D1 database (staging + prod)
- [ ] Provision KV namespace (staging + prod)
- [ ] Configure ourwkrp.com DNS in Cloudflare
- [ ] Add redirect URIs in Spotify Developer Dashboard
- [ ] Deploy Worker to staging
- [ ] Smoke test full auth flow on staging
