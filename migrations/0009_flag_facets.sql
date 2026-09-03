-- Migration 0009: Flag facets — a contributor's self-declared (domain, depth) pairs
--
-- HL-P3.2 (OW-121). The first phase-3 story, and deliberately ADR-independent:
-- a facet is purely additive contributor self-description — a person declaring
-- "I have this relationship to this domain" (e.g. bocce / lifelong). It is NOT a
-- container, an owner_ref, a visibility scope, or a cross-product seam; those are
-- gated on an un-ratified ADR and are not touched here.
--
-- One depth per domain per person: a person has a single relationship to bocce,
-- not three. That invariant is enforced by the UNIQUE index on
-- (contributor_id, domain) below, so changing the depth is an upsert, never a
-- second row.

CREATE TABLE flag_facets (
  id TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL,
  domain TEXT NOT NULL,           -- short self-declared label, e.g. "bocce"
  depth TEXT NOT NULL CHECK (depth IN ('lifelong','hobbyist','dabbler','newcomer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (contributor_id) REFERENCES contributors(id)
);

-- A contributor's declared facets.
CREATE INDEX idx_flag_facets_contributor ON flag_facets(contributor_id);

-- One depth per domain per person — the same domain cannot be declared twice.
CREATE UNIQUE INDEX idx_flag_facets_unique
  ON flag_facets(contributor_id, domain);
