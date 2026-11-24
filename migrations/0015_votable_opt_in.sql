-- "People may vote for me" (profiles-and-voting launch, story 3).
--
-- A profile can be put on an event's vote set only when its owner has opted
-- in. votable_since is when they did: NULL means not opted in, which is every
-- existing profile and the default for a new one. Withdrawing sets it back to
-- NULL; opting in again records the new date. Erasure clears it.
ALTER TABLE contributors ADD COLUMN votable_since TEXT;
