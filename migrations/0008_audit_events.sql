-- Migration 0007: Security audit trail (OW-83)
-- Additive only — no DROP TABLE, no DROP COLUMN.
--
-- Append-only by contract: the application only ever INSERTs audit events and
-- never UPDATEs them. The single permitted deletion is the retention purge
-- (purgeExpiredAudit), which removes whole aged rows — it never edits event
-- content. We deliberately do NOT install an UPDATE/DELETE-blocking trigger,
-- because that would also block the retention sweep the identity-choice model
-- requires.
--
-- PII contract: actor_id is an opaque contributor UUID (or NULL for the
-- anonymous/untracked identity rungs) — never a name, email, or display name.
-- `meta` is JSON that has already been passed through the logger's redactor,
-- so credentials, personal identifiers, and raw user-typed query text never
-- land here. The audit row is therefore safe to retain for the full window.

CREATE TABLE audit_events (
  id            TEXT PRIMARY KEY,
  ts            TEXT NOT NULL,                     -- ISO-8601, used for retention cutoff
  request_id    TEXT,                              -- cf-ray or generated per-request id
  actor_id      TEXT,                              -- contributor UUID, or NULL (anonymous/untracked)
  action        TEXT NOT NULL,                     -- e.g. 'auth.callback', 'playlist.create'
  resource_type TEXT NOT NULL,                     -- 'session' | 'contributor' | 'playlist' | ...
  resource_id   TEXT,
  outcome       TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  brand_id      TEXT NOT NULL DEFAULT 'wkrp',
  meta          TEXT                               -- redacted JSON, nullable
);

-- Retention sweep scans by timestamp.
CREATE INDEX idx_audit_events_ts ON audit_events(ts);

-- Investigations: "everything actor X did" and "everything that touched resource Y".
CREATE INDEX idx_audit_events_actor ON audit_events(actor_id);
CREATE INDEX idx_audit_events_resource ON audit_events(resource_type, resource_id);
