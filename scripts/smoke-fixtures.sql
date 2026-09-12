-- Deterministic smoke fixtures (Tier-1 parameterized smoke).
--
-- tests/e2e/smoke/tier1.spec.ts skips the /dj/:id, /dj/:id/poster and
-- /contributor/:id surfaces unless SMOKE_DJ_ID / SMOKE_CONTRIBUTOR_ID resolve to
-- real rows. These two contributors give those surfaces something to render so
-- the routes run instead of skipping. INSERT OR IGNORE keeps re-seeding a no-op.
--
-- Keep the IDs in sync with the SMOKE_DJ_ID / SMOKE_CONTRIBUTOR_ID values wired
-- in .github/workflows/ci.yml (e2e-tests job).
INSERT OR IGNORE INTO contributors (id, name, generation, brand_id, role, status, created_at)
VALUES
  ('00000000-0000-4000-8000-0000000000d1', 'Smoke DJ',          'founder', 'wkrp', 'dj',          'active', datetime('now')),
  ('00000000-0000-4000-8000-0000000000c0', 'Smoke Contributor', 'gen2',    'wkrp', 'contributor', 'active', datetime('now'));
