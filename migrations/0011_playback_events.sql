-- Migration 0011: Playback events — one row per play of a song in a live set (OW-219)
--
-- set_tracks (migration 0006) has PRIMARY KEY (set_id, track_id), so a replay
-- of the same song in the same set cannot be stored, and nothing names "the
-- song playing now" by an id. A scan or vote must resolve by a unit id carried
-- in the code, never by intersecting a timestamp with a play log
-- (docs/features/artist-attribution-five-surfaces.md, "Scan-resolution law").
-- This table gives every play its own id.
--
-- Rules the handlers keep (src/handlers/dj.ts):
--   - Only the DJ who owns the live set starts a play (POST /api/sets/:id/tracks).
--   - started_at / ended_at are server time (datetime('now')); no client clock.
--   - Starting a play closes the set's open play in the same D1 batch; ending
--     the set (or starting a new one) closes it too.
--   - brand_id is the owning DJ's contributors.brand_id at the time of the play.
--
-- No backfill: set_tracks keeps a song once per set with no replay history,
-- so it cannot be turned into true play events, and no reader needs old rows
-- here. The open play of a set live at deploy time starts with its next song.

CREATE TABLE playback_events (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  FOREIGN KEY (set_id) REFERENCES dj_sets(id),
  FOREIGN KEY (track_id) REFERENCES tracks(id)
);

-- A set's plays, in order.
CREATE INDEX idx_playback_events_set ON playback_events(set_id, started_at);

-- At most one open play per set: "now playing" is never ambiguous.
CREATE UNIQUE INDEX idx_playback_events_one_open
  ON playback_events(set_id) WHERE ended_at IS NULL;
