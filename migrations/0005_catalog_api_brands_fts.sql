-- Migration 0005: Catalog API support — brands table, FTS5 search, composite indexes
-- Supports: WKRP-6 (Catalog API), WKRP-7 (Playlist Builder), WKRP-8 (Multi-Tenant)

-- =============================================================
-- 1. Brands table for multi-tenant support
-- =============================================================
CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subdomain TEXT NOT NULL UNIQUE,
  primary_color TEXT NOT NULL DEFAULT '#1DB954',
  accent_color TEXT NOT NULL DEFAULT '#191414',
  logo_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the default brand
INSERT INTO brands (id, name, subdomain) VALUES ('wkrp', 'WKRP', 'wkrp');

-- =============================================================
-- 2. Extend playlists for user-created playlists (not just synced)
-- =============================================================
ALTER TABLE playlists ADD COLUMN is_curated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playlists ADD COLUMN brand_id TEXT NOT NULL DEFAULT 'wkrp';

-- =============================================================
-- 3. FTS5 virtual table for full-text search on tracks
-- =============================================================
CREATE VIRTUAL TABLE tracks_fts USING fts5(
  name,
  artist,
  album,
  genre,
  content='tracks',
  content_rowid='rowid'
);

-- Populate FTS from existing tracks
INSERT INTO tracks_fts(rowid, name, artist, album, genre)
  SELECT rowid, name, artist, album, genre FROM tracks;

-- Triggers to keep FTS in sync with tracks table
CREATE TRIGGER tracks_fts_insert AFTER INSERT ON tracks BEGIN
  INSERT INTO tracks_fts(rowid, name, artist, album, genre)
    VALUES (new.rowid, new.name, new.artist, new.album, new.genre);
END;

CREATE TRIGGER tracks_fts_delete AFTER DELETE ON tracks BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, name, artist, album, genre)
    VALUES ('delete', old.rowid, old.name, old.artist, old.album, old.genre);
END;

CREATE TRIGGER tracks_fts_update AFTER UPDATE ON tracks BEGIN
  INSERT INTO tracks_fts(tracks_fts, rowid, name, artist, album, genre)
    VALUES ('delete', old.rowid, old.name, old.artist, old.album, old.genre);
  INSERT INTO tracks_fts(rowid, name, artist, album, genre)
    VALUES (new.rowid, new.name, new.artist, new.album, new.genre);
END;

-- =============================================================
-- 4. Composite indexes for catalog API filter queries
-- =============================================================

-- Genre + year combo (most common filter pattern)
CREATE INDEX idx_tracks_genre_year ON tracks(genre, release_year);

-- Audio feature filtering (progressive enhancement)
-- 0001 created non-partial energy/valence indexes; drop them first so the
-- partial versions below replace them (CREATE INDEX errors on a name clash).
DROP INDEX IF EXISTS idx_tracks_energy;
DROP INDEX IF EXISTS idx_tracks_valence;
CREATE INDEX idx_tracks_energy ON tracks(energy) WHERE energy IS NOT NULL;
CREATE INDEX idx_tracks_valence ON tracks(valence) WHERE valence IS NOT NULL;
CREATE INDEX idx_tracks_danceability ON tracks(danceability) WHERE danceability IS NOT NULL;

-- Playlist brand scoping
CREATE INDEX idx_playlists_brand ON playlists(brand_id);

-- Curated playlists lookup
CREATE INDEX idx_playlists_curated ON playlists(is_curated) WHERE is_curated = 1;
