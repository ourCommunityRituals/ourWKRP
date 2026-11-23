-- Migration 0012: each play's vote on OurSharedEvents (OW-219, OSE ADR-040)
--
-- Votes live on OurSharedEvents, never here. Each play of a song is one
-- votable object there; ourWKRP keeps only the link from its playback event to
-- that object's id (`vobj_` and 32 hex). OurSharedEvents stores no ourWKRP id and
-- no name. No vote, voter or tally is stored here.
--
-- Written by src/lib/ose-vote-link.ts when a DJ logs a song in a set that
-- names an OurSharedEvents event and the link is switched on
-- (OSE_VOTE_LINK = "on"). NULL when the link is off, the set names no event,
-- or OurSharedEvents did not answer.
--
-- Rollback: the column is only read by the link itself.
--   ALTER TABLE playback_events DROP COLUMN vote_object_id;

ALTER TABLE playback_events ADD COLUMN vote_object_id TEXT
  CHECK (vote_object_id IS NULL OR (vote_object_id GLOB 'vobj_*' AND length(vote_object_id) = 37));
