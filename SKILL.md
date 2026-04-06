# SKILL.md — OurWKRP (OW)

Skills for working in the OurWKRP repo.

---

## Product identity

| Field | Value |
|-------|-------|
| Code | OW |
| Full name | OurWKRP |
| Type | Community music curation platform |
| Stack | TypeScript, Cloudflare Workers, Wrangler, D1, KV |
| Streaming | AppleMusicKit (unlimited user target) |
| Auth | Spotify OAuth (Authorization Code Flow + PKCE) |
| Secrets | Doppler (dev, stg, prd configs) |
| Domain | ourwkrp.com |
| Data model | **Named identity — not tied to anonymous ID** |
| Privacy | **Architecturally separated from OSE** — different database, different identity model |

---

## Privacy boundary

OurWKRP uses named identity. Contributors authenticate with real names and Spotify accounts. This is by design and is the opposite of OSE's anonymous ID architecture.

**The separation is architectural and permanent:**
- OW has its own D1 database, its own KV namespace, its own Worker
- OW contributor data is never mixed with OSE anonymous data
- When OW and OSE converge under OCR, the identity boundary remains
- BigQuery warehouse maintains separate schemas for OW (named) and OSE (anonymous)

---

## Skill: Contributor Sync

### When to Use
User says: "sync", "spotify sync", "contributor", "library sync"

### Steps
1. Read `CLAUDE.md` for architecture and Spotify flow
2. Sync follows: playlists → tracks → audio features
3. Progressive sync — partial results are usable immediately
4. Check `src/spotify/sync-engine.ts` for current implementation
5. Verify D1 writes and KV session state

---

## Skill: Catalog Development

### When to Use
User says: "catalog", "browse", "filter", "search"

### Steps
1. Read `CLAUDE.md` for data model (D1: contributors, playlists, tracks, playlist_tracks)
2. Read `src/handlers/catalog.ts` for current catalog handler
3. Read `src/templates/catalog.html` for frontend
4. Audio feature indexes enable filtering by tempo, energy, danceability, etc.
5. Brand scoping via `brand_id` column — default 'wkrp', future: per-venue brands

---

## Skill: White Label Configuration

### When to Use
User says: "white label", "brand", "venue", "reckless", "smart bar"

### Steps
1. Read OCR-docs `docs/VISION.md` for white label tier definitions
2. Read `src/lib/brand.ts` for brand configuration
3. White label tiers: community, DJ/artist, venue
4. Target venues: Reckless Records, Smart Bar, Hyde Park Records
5. `brand_id` scopes all data per tenant
6. Coordinate with OWL for deployment of branded instances

---

## Skill: AppleMusicKit Integration

### When to Use
User says: "apple music", "apple", "musickit", "streaming"

### Steps
1. Read OCR-docs `docs/VISION.md` for AppleMusicKit reference
2. AppleMusicKit unlimited user is the streaming target
3. Define integration points: catalog enrichment, playback, playlist export
4. Maintain separation from Spotify auth — AppleMusic is additive, not replacement
5. Document in `docs/apple-music/`

---

## Skill: Playlist Builder

### When to Use
User says: "playlist", "create playlist", "builder"

### Steps
1. Read `src/handlers/playlist.ts` for playlist creation handler
2. Read `src/templates/create.html` for frontend
3. Playlists are collaborative — multiple contributors, one collective voice
4. DJ promotion, attribution, and sponsorship hooks apply at playlist level
5. Verified artist layer for preferred playlists

---

## Skill: Import Pipeline

### When to Use
User says: "import", "csv", "lastfm", "multi-source"

### Steps
1. Read `src/handlers/import.ts` and `src/import/` for current pipeline
2. Read `migrations/0003_multi_source_provenance.sql` for provenance schema
3. Multi-source: Spotify (primary), Last.fm, CSV import
4. Provenance tracking — every track knows its source
5. Catalog API with brand and FTS support (`migrations/0005`)

---

## Cross-product references

| Product | Integration point |
|---------|------------------|
| OSE (OurSharedEvents) | **Privacy boundary** — separate databases, separate identity models. Never mixed. |
| OSG (OurSharedGames) | Game nights have playlists. OW curates, OSG consumes. |
| OSR (OurSharedRecords) | Music context and playlist references for archive records. |
| OSP (OurSharedPulse) | Community playlist creation via OSP engagement. |
| OSM (OurSharedMagnets) | White label API documentation and Postman collections. |
| OWL (OurWhiteList) | Branded OW instances deployed per venue/community. |
| OER (OurEventRings) | Music engagement data feeds BigQuery → RAG analytics. |

Vision lives in OCR-docs `docs/VISION.md` only.

---

*Derived from OCR-docs/docs/VISION.md*
*Last updated: April 5 2026*
*Owner: Matt*
*Status: ACTIVE*
