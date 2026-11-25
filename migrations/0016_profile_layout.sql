-- Profile layout skin (self-serve skin editor at /look).
--
-- The arrangement the owner chose for their public profile, as JSON
-- {surface, skin, columns, order, wide}, the same shape ourSharedEvents keeps
-- in settings.layouts.<surface>. NULL means the standard skin, which is every
-- existing profile and the default for a new one. The free notes of a skin
-- file are never stored. Erasure clears it.
ALTER TABLE contributors ADD COLUMN profile_layout TEXT;
