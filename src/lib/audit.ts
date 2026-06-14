/**
 * Security audit trail (OW-83).
 *
 * Append-only, structured record of security-relevant events: auth, imports,
 * playlist/set mutations, attribution, erasure. Two sinks: the durable
 * `audit_events` D1 table (for investigation + retention) and the structured
 * log pipeline (for live observability).
 *
 * Identity-choice alignment:
 *  - `actorId` is an opaque contributor UUID, or null for the anonymous /
 *    untracked rungs — never a name, email, or display name.
 *  - `meta` is passed through the logger's redactor before persistence, so the
 *    same PII/secret hygiene that protects logs protects the durable trail.
 *
 * Robustness: recordAudit never throws into the request path — an audit write
 * failure is logged but must not break the user-facing operation.
 */

import type { Env } from '../types';
import { log, logError, redact } from './logger';

export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditEvent {
  action: string;            // dotted verb, e.g. 'auth.callback', 'playlist.create'
  resourceType: string;      // 'session' | 'contributor' | 'playlist' | 'set' | ...
  resourceId?: string | null;
  outcome: AuditOutcome;
  actorId?: string | null;   // contributor UUID, or null for anonymous/untracked
  brandId?: string;
  meta?: Record<string, unknown>; // redacted before persistence; never raw PII
}

/** Security audit rows are retained for one year, then swept by purgeExpiredAudit. */
export const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Stable per-request id. Prefers Cloudflare's cf-ray (correlates with edge
 * logs); falls back to a random UUID for local dev / non-CF callers.
 */
export function requestId(request: Request): string {
  return request.headers.get('cf-ray') ?? crypto.randomUUID();
}

/**
 * Append one audit event. Best-effort: a DB failure is logged and swallowed so
 * the caller's primary operation still completes.
 */
export async function recordAudit(env: Env, request: Request, event: AuditEvent): Promise<void> {
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  const reqId = requestId(request);
  const actorId = event.actorId ?? null;
  const resourceId = event.resourceId ?? null;
  const brandId = event.brandId ?? 'wkrp';
  const meta = event.meta ? JSON.stringify(redact(event.meta)) : null;

  try {
    await env.WKRP_DB.prepare(
      `INSERT INTO audit_events
         (id, ts, request_id, actor_id, action, resource_type, resource_id, outcome, brand_id, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, ts, reqId, actorId, event.action, event.resourceType, resourceId, event.outcome, brandId, meta)
      .run();
  } catch (err) {
    logError('AUDIT_WRITE_FAILED', err, { action: event.action, outcome: event.outcome });
  }

  // Mirror to the log pipeline. actor_id/resource_id are opaque ids, not PII.
  log('AUDIT', {
    action: event.action,
    resource_type: event.resourceType,
    resource_id: resourceId,
    outcome: event.outcome,
    actor_id: actorId,
    request_id: reqId,
    brand_id: brandId,
  });
}

/**
 * Delete audit rows older than AUDIT_RETENTION_MS. This is the one permitted
 * deletion against the append-only table — it removes whole aged rows and never
 * edits event content. Returns the number of rows purged.
 *
 * Intended to run from a scheduled() cron trigger; until that binding exists it
 * can be invoked opportunistically. Idempotent and safe to call concurrently.
 */
export async function purgeExpiredAudit(env: Env, now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - AUDIT_RETENTION_MS).toISOString();
  const res = await env.WKRP_DB.prepare(`DELETE FROM audit_events WHERE ts < ?`).bind(cutoff).run();
  const purged = res?.meta?.changes ?? 0;
  log('AUDIT_RETENTION_PURGE', { cutoff, purged });
  return purged;
}
