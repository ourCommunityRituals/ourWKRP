-- Migration 0013: linked music accounts (two-account playlist sync, story 1)
--
-- A contributor can link more than one music account. Each linked account has
-- a role: `source` is the account the contributor edits in (ourWKRP pulls from
-- it), `mirror` is an account ourWKRP writes copies to (the company Spotify).
-- Design: "ourWKRP as master copy: two-account Spotify sync" (2026-11-23).
--
-- Rules the schema holds (tests/integration/linked-accounts.test.ts):
--   * one music account belongs to one contributor (platform + platform id unique)
--   * a contributor has at most one source account
--   * every existing Spotify link becomes that contributor's source account
--
-- Tokens are not stored here. A source account's tokens stay at
-- wkrp:tokens:<contributor id>, where they are today; a mirror's live at
-- wkrp:tokens:la:<linked account id> (src/lib/linked-accounts.ts). Both are
-- encrypted the same way.
--
-- Rollback: nothing else reads this table yet.
--   DROP TABLE linked_accounts;

CREATE TABLE linked_accounts (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL REFERENCES contributors(id),
  platform TEXT NOT NULL CHECK (platform IN ('spotify', 'apple_music')),
  platform_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('source', 'mirror')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reconnect')),
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One music account belongs to one contributor.
CREATE UNIQUE INDEX idx_linked_accounts_platform_user
  ON linked_accounts(platform, platform_user_id);

-- At most one source account per contributor.
CREATE UNIQUE INDEX idx_linked_accounts_one_source
  ON linked_accounts(contributor_id) WHERE role = 'source';

CREATE INDEX idx_linked_accounts_contributor ON linked_accounts(contributor_id);

-- Every existing Spotify link becomes the contributor's source account.
INSERT INTO linked_accounts (id, contributor_id, platform, platform_user_id, role, display_name)
SELECT lower(hex(randomblob(16))), id, 'spotify', spotify_user_id, 'source', spotify_display_name
  FROM contributors
 WHERE spotify_user_id IS NOT NULL;
