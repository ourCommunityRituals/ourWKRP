-- Custom looks are a paid add-on (owner, 2026-11-25): the standard skin is
-- free for everyone; any other skin needs the add-on. No billing yet, only a
-- flag, on when either the brand has it (a venue or community instance) or an
-- admin granted it to the person (POST /admin/skins/grant). Off by default.
ALTER TABLE brands ADD COLUMN custom_skins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contributors ADD COLUMN custom_skins_since TEXT;
-- Erasure clears the per-person grant.
