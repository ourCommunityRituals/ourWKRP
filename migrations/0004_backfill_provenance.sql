-- Migration 0004: Backfill provenance from existing Spotify data
-- Populates track_identifiers, contributions, and canonical fields
-- from data already in tracks and playlist_tracks tables

-- =============================================================
-- 1. Backfill track_identifiers from existing tracks (all have Spotify IDs)
-- =============================================================
INSERT INTO track_identifiers (track_id, platform, platform_id, platform_uri, created_at)
SELECT
  id,
  'spotify',
  id,
  'spotify:track:' || id,
  COALESCE(created_at, datetime('now'))
FROM tracks
WHERE id NOT IN (SELECT platform_id FROM track_identifiers WHERE platform = 'spotify');

-- =============================================================
-- 2. Backfill canonical fields for dedup matching
-- =============================================================
UPDATE tracks
SET
  canonical_title = LOWER(TRIM(name)),
  canonical_artist = LOWER(TRIM(artist))
WHERE canonical_title IS NULL;

-- =============================================================
-- 3. Backfill contributions from playlist_tracks
--    Each playlist_track becomes a contribution with source_type = 'created_playlist'
-- =============================================================
INSERT OR IGNORE INTO contributions (
  id, track_id, contributor_id, source_type, source_name,
  source_platform, added_at, created_at
)
SELECT
  lower(hex(randomblob(16))),
  pt.track_id,
  p.contributor_id,
  'created_playlist',
  p.name,
  'spotify',
  pt.added_at,
  COALESCE(pt.added_at, datetime('now'))
FROM playlist_tracks pt
JOIN playlists p ON pt.playlist_id = p.id;

-- =============================================================
-- 4. Set generation-based roles for existing contributors
-- =============================================================
UPDATE contributors SET role = 'founder' WHERE generation = 'founder';

-- =============================================================
-- 5. Backfill contributor_roles from existing contributors
-- =============================================================
INSERT OR IGNORE INTO contributor_roles (contributor_id, role, granted_at)
SELECT id, role, datetime('now')
FROM contributors;
