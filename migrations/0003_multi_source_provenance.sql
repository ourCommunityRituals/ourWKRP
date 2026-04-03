-- Migration 0003: Multi-source ingestion with provenance tracking
-- Additive only — no DROP TABLE, no DROP COLUMN
-- Supports: Spotify CSV, Last.fm, Apple Music, manual entry
-- ISRC-based cross-platform track matching

-- =============================================================
-- 1. Extend tracks table with cross-platform identity fields
-- =============================================================
ALTER TABLE tracks ADD COLUMN isrc TEXT;
ALTER TABLE tracks ADD COLUMN release_year INTEGER;
ALTER TABLE tracks ADD COLUMN canonical_title TEXT;
ALTER TABLE tracks ADD COLUMN canonical_artist TEXT;
ALTER TABLE tracks ADD COLUMN merged_into_id TEXT REFERENCES tracks(id);

-- =============================================================
-- 2. Extend contributors table with roles and multi-platform IDs
-- =============================================================
ALTER TABLE contributors ADD COLUMN role TEXT NOT NULL DEFAULT 'contributor';
ALTER TABLE contributors ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE contributors ADD COLUMN apple_music_id TEXT;
ALTER TABLE contributors ADD COLUMN lastfm_username TEXT;

-- =============================================================
-- 3. Track identifiers — platform-specific IDs for a canonical track
-- =============================================================
CREATE TABLE track_identifiers (
  track_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_id TEXT NOT NULL,
  platform_uri TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (platform, platform_id),
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

-- =============================================================
-- 4. Contributions — WHO brought WHAT, HOW, and from WHERE
-- =============================================================
CREATE TABLE contributions (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL,
  contributor_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT,
  source_platform TEXT NOT NULL,
  original_submitter_id TEXT,
  play_count INTEGER,
  first_listened_at TEXT,
  added_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (track_id) REFERENCES tracks(id),
  FOREIGN KEY (contributor_id) REFERENCES contributors(id),
  FOREIGN KEY (original_submitter_id) REFERENCES contributors(id)
);

-- =============================================================
-- 5. Contributor roles — multi-role support (founder AND dj)
-- =============================================================
CREATE TABLE contributor_roles (
  contributor_id TEXT NOT NULL,
  role TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (contributor_id, role),
  FOREIGN KEY (contributor_id) REFERENCES contributors(id)
);

-- =============================================================
-- 6. Indexes
-- =============================================================

-- Track deduplication: find by ISRC
CREATE INDEX idx_tracks_isrc ON tracks(isrc);

-- Track deduplication fallback: normalized title+artist
CREATE INDEX idx_tracks_canonical ON tracks(canonical_title, canonical_artist);

-- Merged track resolution
CREATE INDEX idx_tracks_merged_into ON tracks(merged_into_id);

-- Decade browsing
CREATE INDEX idx_tracks_release_year ON tracks(release_year);

-- Contributions: all tracks by a contributor
CREATE INDEX idx_contributions_contributor ON contributions(contributor_id);

-- Contributions: all contributors who brought a track
CREATE INDEX idx_contributions_track ON contributions(track_id);

-- Contributions: filter by source type
CREATE INDEX idx_contributions_source_type ON contributions(source_type);

-- Contributions: filter by source name
CREATE INDEX idx_contributions_source_name ON contributions(source_name);

-- Contributions: contributor + source combo
CREATE INDEX idx_contributions_contributor_source ON contributions(contributor_id, source_type);

-- Contributions: uniqueness (same contributor, same track, same source path = one record)
CREATE UNIQUE INDEX idx_contributions_unique ON contributions(track_id, contributor_id, source_type, source_name);

-- Platform lookups: find track by platform ID
CREATE INDEX idx_track_identifiers_track ON track_identifiers(track_id);

-- Contributor status filtering
CREATE INDEX idx_contributors_status ON contributors(status);
