-- Migration 0007: Preferred playlists — a contributor's portfolio of pointed playlist URLs
--
-- Layer 1 of the playlist-portfolio flow: a contributor "points" at external
-- playlist URLs (Spotify) to build a portfolio of preferred playlists shown on
-- their profile. Track-level ingestion into the shared catalog is a separate,
-- later concern (it needs Spotify Web API access) and is not modeled here.

CREATE TABLE preferred_playlists (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL,
  platform TEXT NOT NULL,        -- spotify (apple_music reserved for later)
  external_id TEXT NOT NULL,     -- playlist id parsed from the URL
  url TEXT NOT NULL,             -- normalized canonical playlist URL
  title TEXT,                    -- optional contributor-supplied label
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contributor_id) REFERENCES contributors(id)
);

-- A contributor's portfolio
CREATE INDEX idx_preferred_playlists_contributor ON preferred_playlists(contributor_id);

-- The same playlist cannot be added to one contributor's portfolio twice
CREATE UNIQUE INDEX idx_preferred_playlists_unique
  ON preferred_playlists(contributor_id, platform, external_id);
