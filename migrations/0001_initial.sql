-- ourWKRP D1 Schema — Initial migration
-- Contributors, playlists, tracks, and their relationships

CREATE TABLE contributors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  generation TEXT NOT NULL CHECK (generation IN ('founder', 'gen2', 'gen3')),
  brand_id TEXT NOT NULL DEFAULT 'wkrp',
  spotify_user_id TEXT,
  spotify_display_name TEXT,
  created_at TEXT NOT NULL,
  last_sync_at TEXT
);

CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  track_count INTEGER DEFAULT 0,
  snapshot_id TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (contributor_id) REFERENCES contributors(id)
);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL,
  duration_ms INTEGER,
  preview_url TEXT,
  image_url TEXT,
  energy REAL,
  danceability REAL,
  valence REAL,
  tempo REAL,
  acousticness REAL,
  instrumentalness REAL,
  genre TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE playlist_tracks (
  playlist_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  position INTEGER,
  added_at TEXT,
  added_by TEXT,
  PRIMARY KEY (playlist_id, track_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id),
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

CREATE INDEX idx_contributors_brand ON contributors(brand_id);
CREATE INDEX idx_tracks_energy ON tracks(energy);
CREATE INDEX idx_tracks_valence ON tracks(valence);
CREATE INDEX idx_tracks_genre ON tracks(genre);
CREATE INDEX idx_playlists_contributor ON playlists(contributor_id);
CREATE INDEX idx_playlist_tracks_track ON playlist_tracks(track_id);
