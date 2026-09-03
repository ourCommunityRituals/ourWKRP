-- Migration 0010: Contributor vanity slugs (OW-122, HL-P3.3)
-- Additive only — no DROP TABLE, no DROP COLUMN, no data rewrite.
--
-- WHAT THIS ENABLES
-- A contributor may claim one human-readable slug so their public profile is
-- reachable at /c/:slug in addition to the canonical /contributor/:uuid URL.
-- The UUID route is unchanged and remains the permanent identifier; the slug is
-- presentation polish on the public surface only.
--
-- NUMBERING NOTE: 0009 is claimed by the unmerged OW-121 branch
-- (0009_flag_facets.sql). This story takes 0010 so the two can merge in either
-- order without a filename collision.
--
-- NULL-DISTINCT UNIQUENESS
-- Uniqueness is scoped per brand: (brand_id, slug). SQLite treats NULLs as
-- distinct in a UNIQUE index, so every contributor who has not claimed a slug
-- keeps slug NULL and they coexist without collision. This is the same
-- assumption migration 0002 already relies on for
-- idx_contributors_spotify_user, where spotify_user_id is NULL for every
-- contributor who registered without connecting Spotify.
--
-- SLUG_LOCKED SEMANTICS (mirrors OurSharedEvents)
-- OSE's events table declares `slug_locked INTEGER NOT NULL DEFAULT 0` with the
-- comment "slug_locked prevents marketing URL changes after first scan" — the
-- lock is an externally-triggered lifecycle flag, NOT something set on first
-- claim. OW mirrors that meaning: the column defaults to 0 (slug remains
-- changeable by its owner), and the application enforces the lock when it is
-- set. Nothing in this story sets it to 1.

ALTER TABLE contributors ADD COLUMN slug TEXT;
ALTER TABLE contributors ADD COLUMN slug_locked INTEGER NOT NULL DEFAULT 0;

-- Enforces one slug per brand and backs the /c/:slug lookup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contributors_brand_slug
  ON contributors(brand_id, slug);
