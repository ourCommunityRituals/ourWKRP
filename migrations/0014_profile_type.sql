-- Migration 0014: profile type (profiles-and-voting launch, story 2)
--
-- ourWKRP launches as public profiles and events that private people vote on
-- (owner decision, 2026-11-23). Each profile has a type. Launch types are
-- artist and sports, each with a real first person who agreed; more types
-- follow as people sign up ("fewer types, not emptier ones", OW-131).
--
-- NULL means "no type chosen": every existing contributor, and anyone who
-- signs up without picking one. The type is chosen at sign-up and can be
-- changed later (POST /api/profile/type).
--
-- Rule the schema holds (tests/integration/profile-type.test.ts): a type is
-- NULL or one of the launch types; anything else is refused.
--
-- Rollback: nothing depends on the column yet.
--   ALTER TABLE contributors DROP COLUMN profile_type;

ALTER TABLE contributors ADD COLUMN profile_type TEXT
  CHECK (profile_type IS NULL OR profile_type IN ('artist', 'sports'));
