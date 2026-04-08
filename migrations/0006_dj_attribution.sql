-- Migration 0006: DJ Attribution — influence tracking via QR scan
-- Layer 2 of ourWKRP: the DJ who introduced you to something gets credit permanently

-- =============================================================
-- 1. Attributions — who discovered what through which DJ, at which event
-- =============================================================
CREATE TABLE attributions (
  id TEXT PRIMARY KEY,
  dj_id TEXT NOT NULL,
  listener_id TEXT,
  track_id TEXT NOT NULL,
  event_id TEXT,
  attributed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (dj_id) REFERENCES contributors(id),
  FOREIGN KEY (listener_id) REFERENCES contributors(id),
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

-- =============================================================
-- 2. DJ sets — a DJ's active set at an event (for live attribution)
-- =============================================================
CREATE TABLE dj_sets (
  id TEXT PRIMARY KEY,
  dj_id TEXT NOT NULL,
  event_id TEXT,
  venue_name TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  is_live INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (dj_id) REFERENCES contributors(id)
);

-- =============================================================
-- 3. Set tracks — what the DJ played during a set
-- =============================================================
CREATE TABLE set_tracks (
  set_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  position INTEGER,
  played_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (set_id, track_id),
  FOREIGN KEY (set_id) REFERENCES dj_sets(id),
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

-- =============================================================
-- 4. Indexes
-- =============================================================

-- Attribution lookups
CREATE INDEX idx_attributions_dj ON attributions(dj_id);
CREATE INDEX idx_attributions_listener ON attributions(listener_id);
CREATE INDEX idx_attributions_track ON attributions(track_id);
CREATE INDEX idx_attributions_event ON attributions(event_id);

-- DJ set lookups
CREATE INDEX idx_dj_sets_dj ON dj_sets(dj_id);
CREATE INDEX idx_dj_sets_live ON dj_sets(is_live) WHERE is_live = 1;

-- Set track lookups
CREATE INDEX idx_set_tracks_track ON set_tracks(track_id);
