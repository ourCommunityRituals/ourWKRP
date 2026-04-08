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
**Status:** ✅ DONE
**Prerequisite:** WKRP-5
**Sprint:** 2
**CCR Review:** Rewritten April 2026 — original depended on dead Spotify audio features API

**PO Acceptance Criteria:**
- [x] `GET /api/tracks?genre=hip-hop&artist=kendrick&contributor=matt&year_min=2010` — filtered track list from D1
- [x] `GET /api/tracks?q=searchterm` — full-text search on track name + artist name (FTS5)
- [x] `GET /api/tracks?energy_min=0.7&valence_min=0.5` — audio feature filters (progressive enhancement, hidden if no data)
- [x] `GET /api/playlists/:contributorId` — contributor's imported playlists
- [x] `GET /api/contributors` — all contributors with track counts
- [x] `GET /api/stats` — catalog stats (total tracks, contributors, top genres, top decades), brand-scoped
- [x] Cursor-based pagination on all list endpoints (`?cursor=xxx&limit=25`)
- [x] Genre data enriched from CSV imports (Exportify includes artist genres)

---

### WKRP-7: Playlist Builder (D1 MVP + Apple Music Push)
**Status:** ✅ DONE (MVP) / 📋 BACKLOG (Apple Music Phase 2)
**Prerequisite:** WKRP-6
**Sprint:** 2
**CCR Review:** Rewritten April 2026 — Spotify API removed, Apple Music is publishing target

**PO Acceptance Criteria — MVP (D1-only):**
- [x] `POST /api/playlists` — create playlist (name, description, brand_id) in D1
- [x] `POST /api/playlists/:id/tracks` — add tracks to playlist by track IDs
- [x] `DELETE /api/playlists/:id/tracks` — remove tracks from playlist
- [x] `GET /api/playlists/:id` — playlist with full track list
- [x] `GET /api/playlists/:id/export` — export playlist as JSON (track names + ISRCs for manual Apple Music import)
- [x] Playlists attributed to creator (contributor_id) with role check (founder/curator can create)

**PO Acceptance Criteria — Apple Music Push (Phase 2, requires Apple Developer account):**
- [ ] `POST /api/playlists/:id/push/apple-music` — match tracks by ISRC, create in user's Apple Music library
- [ ] MusicKit JS on frontend for Apple Music auth (obtain MUT)
- [ ] Worker stores MUT in KV (`wkrp:apple_token:{userId}`)
- [ ] Returns Apple Music playlist URL + match report (X of Y tracks found)

---

### WKRP-8: Multi-Tenant Brand Support
**Status:** ✅ DONE
**Prerequisite:** WKRP-6
**Sprint:** 2
**CCR Review:** Rewritten April 2026 — confirmed CF Workers wildcard routes viable

**PO Acceptance Criteria:**
- [x] Wildcard route `*.ourwkrp.com/*` in wrangler.toml
- [x] `brand_id` extracted from subdomain (e.g. `bronzeville.ourwkrp.com` -> brand_id = 'bronzeville')
- [x] All catalog API queries scoped by brand_id
- [x] Default brand_id = 'wkrp' when accessed via `ourwkrp.com` (no subdomain)
- [x] `GET /api/brands` — list all brands with contributor/track counts
- [x] CSS custom properties per brand (loaded from D1 `brands` table)
- [x] New D1 migration: `brands` table (id, name, subdomain, primary_color, accent_color, logo_url, created_at)
- [x] Cross-brand contributor discovery: `GET /api/contributors/:id/brands`

---

### WKRP-9: Infrastructure Deployment
**Status:** 🚧 IN PROGRESS — automation + playbook complete, manual steps remain
**Prerequisite:** WKRP-5
**Sprint:** 2
**CCR Review:** Rewritten April 2026 — Spotify redirect URIs removed, Apple Developer enrollment added
**Playbook:** See [PLAYBOOK.md](PLAYBOOK.md) for complete step-by-step guide

**PO Acceptance Criteria — Cloudflare (automated via `scripts/setup-infra.sh`):**
- [x] Provision D1 database (staging + prod) via `wrangler d1 create` — scripted
- [x] Run all D1 migrations on staging + prod — scripted
- [x] Provision KV namespace (staging + prod) via `wrangler kv:namespace create` — scripted
- [x] Update wrangler.toml with real database/namespace IDs — scripted
- [ ] Configure `ourwkrp.com` DNS in Cloudflare (A/CNAME records) — manual, documented in PLAYBOOK.md
- [x] Configure `*.ourwkrp.com` wildcard route for multi-tenant — in wrangler.toml
- [ ] Deploy Worker to staging via `doppler run -c stg -- wrangler deploy` — manual, one command
- [ ] Smoke test: CSV import flow on staging — manual
- [ ] Smoke test: Catalog browse on staging (search, filter, pagination) — manual

**PO Acceptance Criteria — Apple Developer (parallel workstream, documented in PLAYBOOK.md):**
- [ ] Enroll in Apple Developer Program as Organization ($99/yr)
- [ ] Obtain D-U-N-S number for ourCommunityRituals (1-2 weeks)
- [ ] Create MusicKit key in Apple Developer portal
- [ ] Store MusicKit private key in Doppler (all envs)
- [ ] Add `APPLE_TEAM_ID`, `APPLE_KEY_ID` to Doppler config

---

### WKRP-10: Genre Discovery Links
**Status:** ✅ DONE
**Prerequisite:** WKRP-6
**Sprint:** 2

**PO Acceptance Criteria:**
- [x] Genre chips/tags in catalog UI link out to three external discovery sites
- [x] Link order (top to bottom): Discogs → Last.fm → Every Noise
- [x] Discogs: `https://www.discogs.com/search/?genre_exact={genre}` — physical catalog, labels, pressings
- [x] Last.fm: `https://www.last.fm/tag/{genre}` — community tags, related artists/tracks
- [x] Every Noise: `https://everynoise.com/engenremap-{genre}.html` — visual genre map (archival, frozen ~2023)
- [x] Links open in new tab, no API keys required
- [x] Genre tag tap shows contextual menu: "Filter catalog" + 3 external links
- [x] Mobile-friendly: touch targets meet 48px minimum

---

### WKRP-12: Last.fm Scrobble Sync + Genre Enrichment
**Status:** ✅ DONE
**Prerequisite:** WKRP-6
**Sprint:** 3

**PO Acceptance Criteria:**
- [x] `POST /lastfm/sync/:userId` pulls scrobble history and enriches tracks with Last.fm tags
- [x] Last.fm tags mapped to genre field on tracks (top tag = primary genre)
- [x] Scrobble play counts stored in contributions table (`play_count`, `first_listened_at`)
- [x] Artist tag lookup via Last.fm `artist.getTopTags` for genre enrichment
- [x] Track tag lookup via Last.fm `track.getTopTags` as fallback
- [x] Deduplication: match existing tracks by ISRC or canonical title+artist before creating new ones
- [x] Rate limiting: respect Last.fm API rate limits (5 req/sec)
- [x] Tests: unit tests for client, sync engine, tag-to-genre mapping

---

### WKRP-14: CSV Bulk Import UI
**Status:** ✅ DONE
**Prerequisite:** WKRP-6
**Sprint:** 3

**PO Acceptance Criteria:**
- [x] New HTML template: `import.html` — mobile-first CSV upload page
- [x] File picker accepts `.csv` files only
- [x] Preview: show first 5 rows before confirming import
- [x] Progress indicator during upload
- [x] Success summary: "X tracks imported, Y duplicates skipped, Z errors"
- [x] Error display: show failed rows with reason
- [x] Route: `GET /import` serves the page
- [x] Session required: must be authenticated (founder/curator role)
- [x] Mobile-friendly: drag-and-drop on desktop, file picker on mobile

---

### WKRP-15: Contributor Profiles
**Status:** ✅ DONE
**Prerequisite:** WKRP-6
**Sprint:** 3

**PO Acceptance Criteria:**
- [x] `GET /contributor/:id` — public profile page (HTML)
- [x] Shows: name, generation, all roles (multi-role from contributor_roles), brands, join date
- [x] Shows: track count, playlist count, top genres (from their contributions)
- [x] Shows: their playlists with track counts
- [x] Shows: their contribution sources (Spotify, Last.fm, CSV, etc.)
- [x] Genre discovery links on profile genre tags (reuse WKRP-10 popup)
- [x] `GET /api/contributors/:id` — JSON endpoint with full profile data + roles array
- [x] Mobile-first layout, 48px touch targets
- [x] Shareable URL: `yourdomain.com/contributor/:id`

---

### WKRP-16: Apple Music as Contribution Source
**Status:** 📋 BACKLOG
**Prerequisite:** WKRP-9 (Apple Developer enrollment)
**Sprint:** 3

**PO Acceptance Criteria:**
- [ ] `GET /auth/apple/start` — redirect to Apple Music auth via MusicKit JS
- [ ] `GET /auth/apple/callback` — exchange MUT (Music User Token) and store in KV
- [ ] `POST /apple/sync/:userId` — sync Apple Music library into D1
- [ ] Apple Music library tracks matched by ISRC to existing catalog tracks
- [ ] New tracks created with `source_platform = 'apple_music'` in contributions
- [ ] Contributors table `apple_music_id` populated on auth
- [ ] Apple Music appears in contributor profile sources
- [ ] MusicKit JS on frontend for user authorization (catalog.html or dedicated page)
- [ ] MUT stored in KV (`wkrp:apple_token:{userId}`) with refresh logic
- [ ] Tests: auth flow, sync, ISRC matching, profile source display

---

### WKRP-17: Wire Catalog UI to Track API
**Status:** ✅ DONE
**Prerequisite:** WKRP-6
**Sprint:** 3

**PO Acceptance Criteria:**
- [x] catalog.html fetches tracks from `GET /api/tracks` on load
- [x] Search input calls API with `?q=` param (debounced 300ms)
- [x] Filter chips map to API params (energy_min, valence_min, danceability_min)
- [x] Range sliders send exact values to API
- [x] Tracks rendered from API response with album art, genre tags, energy badges
- [x] Cursor pagination: "Load More" button when `has_more` is true
- [x] Empty state when no tracks match
- [x] Stats bar from `GET /api/stats` (total tracks, contributors)
- [x] No Spotify sync call on page load (removed)

---

### WKRP-18: Wire Playlist Builder UI
**Status:** ✅ DONE
**Prerequisite:** WKRP-7, WKRP-17
**Sprint:** 3

**PO Acceptance Criteria:**
- [x] Auth via cookie (remove localStorage check)
- [x] Create playlist via `POST /api/playlists`
- [x] Track search in create flow via `GET /api/tracks?q=`
- [x] Add/remove tracks from playlist via API
- [x] Show playlist track list after creation
- [x] Export button calls `GET /api/playlists/:id/export`
- [x] Button text: "Create Playlist" (not "Create on Spotify")

---

### WKRP-19: Connect Flow — CSV-First Model
**Status:** ✅ DONE
**Prerequisite:** WKRP-14
**Sprint:** 3

**PO Acceptance Criteria:**
- [x] Keep Spotify OAuth option (for first 5 contributors)
- [x] Add "Or import your library via CSV" link to `/import`
- [x] Add note: "Spotify limited to 5 users in dev mode"
- [x] "Browse the catalog" link for anonymous browsing
- [x] Update tagline to reflect community-first model

---

### WKRP-20: Frontend Identity Overhaul — 5-Layer Brand Alignment
**Status:** ✅ DONE
**Prerequisite:** WKRP-17, WKRP-18, WKRP-19
**Sprint:** 3

**PO Acceptance Criteria:**
- [ ] New accent color — not Spotify green. Warm amber/gold (vinyl, warmth, culture)
- [ ] Role model: DJ / Curator / Contributor / Consumer (not Founder/Gen2/Gen3)
- [ ] Generation preserved as lineage (founder/gen2/gen3) separate from role
- [ ] Connect flow: community-first, CSV/Last.fm lead, Spotify demoted
- [ ] Copy reflects mission: human curation vs AI slop, real crew, real taste
- [ ] Navigation: Catalog, DJs, Create, Import (role-gated)
- [ ] DJ profile shows attribution stats placeholder
- [ ] OurRecordStories link/placeholder in profile and nav
- [ ] Every screen optimized for who's looking at it (role-aware)
- [ ] Smooth flow: connect → catalog → create → share feels effortless
- [x] All templates updated: connect, catalog, create, import, profile

---

### WKRP-21: OurRecordStories Integration
**Status:** 📋 BACKLOG
**Prerequisite:** WKRP-15
**Sprint:** 4

**Context:**
OurRecordStories is the oral history engine. Five minutes, one side of a record, why does it matter to you. Curators and contributors tell the stories. The crew — Matt, P, G, JS, M, the kids, the partners — are the founding curatorial voice with zero genre blind spots. Stories are linked to tracks and attributed to the person who told them.

**PO Acceptance Criteria:**
- [ ] Contributor profile shows "Stories" section with linked record stories
- [ ] `GET /api/contributors/:id/stories` — returns stories by this contributor
- [ ] Story card: album art, track name, contributor name, duration, play button
- [ ] Stories linked to tracks in D1 via `stories` table (track_id, contributor_id, audio_url, duration_s, recorded_at)
- [ ] D1 migration: `stories` table
- [ ] `POST /api/stories` — upload a story (audio file + track_id, founder/curator only)
- [ ] Story playback: inline audio player on profile page (HTML5 audio)
- [ ] Stories appear on track cards in catalog: "1 story" badge, tap to listen
- [ ] OurRecordStories branding: "Tell your record story" CTA on profile
- [ ] Navigation: "Stories" link in bottom nav when stories exist for the catalog
- [ ] Cross-product link: when OurRecordStories has its own app, deep link to it

---

### WKRP-22: DJ Attribution + QR Scan
**Status:** 📋 BACKLOG
**Prerequisite:** WKRP-15
**Sprint:** 4

**Context:**
QR codes displayed at the set. When you hear a song that hits, you scan and attribute it. That attribution gets tracked. Over time those stats become the DJ's undeniable influence record — a portfolio of human taste that no algorithm can manufacture or claim. The DJ who introduced you to something gets credit for it permanently.

**PO Acceptance Criteria:**
- [ ] `GET /dj/:id/qr` — generates a QR code linking to the DJ's live set page
- [ ] `GET /dj/:id/live` — mobile page: "What's playing?" → tap to attribute
- [ ] D1 migration: `attributions` table (dj_id, listener_id, track_id, event_id, attributed_at)
- [ ] `POST /api/attributions` — record that a listener discovered a track via this DJ
- [ ] DJ profile "Influence" section: total attributions, unique listeners, top discovered tracks
- [ ] Attribution stats: "X people discovered Y tracks through this DJ"
- [ ] Integration with OurSharedEvents: `event_id` links attribution to specific set/venue
- [ ] QR code includes event context when scanned at an OSE event
- [x] Sponsor data layer: attribution counts as verified engagement for sponsor reporting
- [ ] "This hit" pushes track to listener's connected music service (Spotify or Apple Music)
- [ ] Detect listener's connected platform from KV (Spotify tokens, Apple MUT, or none)
- [ ] Spotify: add track to user's Saved Tracks via Spotify API
- [ ] Apple Music: add track to user's library via MusicKit
- [ ] No platform connected: prompt to connect, attribution still recorded
- [ ] Auto-create "Discovered at [venue]" playlist if event context present
