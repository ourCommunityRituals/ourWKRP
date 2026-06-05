/**
 * Unit tests — security audit trail (OW-83).
 *
 * Covers the durable-sink contract: structured insert shape, PII redaction of
 * meta before persistence, retention purge boundary, and the best-effort
 * guarantee that a DB failure never propagates into the request path.
 */
import { describe, it, expect, vi } from 'vitest';
import { recordAudit, purgeExpiredAudit, requestId, AUDIT_RETENTION_MS } from '../../src/lib/audit';
import type { Env } from '../../src/types';

interface AuditRow {
  id: string; ts: string; request_id: string | null; actor_id: string | null;
  action: string; resource_type: string; resource_id: string | null;
  outcome: string; brand_id: string; meta: string | null;
}

function makeDb(rows: AuditRow[], opts: { failInsert?: boolean } = {}) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (/INSERT INTO audit_events/.test(sql)) {
                if (opts.failInsert) throw new Error('d1 down');
                const [id, ts, request_id, actor_id, action, resource_type, resource_id, outcome, brand_id, meta] = args;
                rows.push({ id, ts, request_id, actor_id, action, resource_type, resource_id, outcome, brand_id, meta } as AuditRow);
                return { meta: { changes: 1 } };
              }
              if (/DELETE FROM audit_events WHERE ts < \?/.test(sql)) {
                const cutoff = args[0] as string;
                const before = rows.length;
                for (let i = rows.length - 1; i >= 0; i--) {
                  if (rows[i].ts < cutoff) rows.splice(i, 1);
                }
                return { meta: { changes: before - rows.length } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };
}

function envWith(db: unknown): Env {
  return { WKRP_DB: db } as unknown as Env;
}

const req = (headers: Record<string, string> = {}) => new Request('https://ourwkrp.com/x', { headers });

describe('audit trail', () => {
  it('inserts a structured row with opaque actor id and defaults', async () => {
    const rows: AuditRow[] = [];
    await recordAudit(envWith(makeDb(rows)), req({ 'cf-ray': 'ray-123' }), {
      action: 'playlist.create', resourceType: 'playlist', resourceId: 'p1',
      outcome: 'success', actorId: 'c1',
    });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.action).toBe('playlist.create');
    expect(r.resource_type).toBe('playlist');
    expect(r.resource_id).toBe('p1');
    expect(r.outcome).toBe('success');
    expect(r.actor_id).toBe('c1');
    expect(r.request_id).toBe('ray-123');
    expect(r.brand_id).toBe('wkrp'); // default
    expect(r.meta).toBeNull();
    expect(typeof r.id).toBe('string');
    expect(r.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults actor_id and resource_id to null (anonymous rung)', async () => {
    const rows: AuditRow[] = [];
    await recordAudit(envWith(makeDb(rows)), req(), {
      action: 'auth.callback', resourceType: 'session', outcome: 'failure',
    });
    expect(rows[0].actor_id).toBeNull();
    expect(rows[0].resource_id).toBeNull();
  });

  it('redacts PII keys in meta before persisting', async () => {
    const rows: AuditRow[] = [];
    await recordAudit(envWith(makeDb(rows)), req(), {
      action: 'import.csv', resourceType: 'import', outcome: 'success', actorId: 'c1',
      meta: { display_name: 'Matt Z', email: 'matt@example.com', count: 7 },
    });
    const meta = rows[0].meta as string;
    expect(meta).not.toContain('Matt Z');
    expect(meta).not.toContain('matt@example.com');
    expect(meta).toContain('[redacted]');
    expect(JSON.parse(meta).count).toBe(7);
  });

  it('never throws when the audit insert fails', async () => {
    const rows: AuditRow[] = [];
    await expect(
      recordAudit(envWith(makeDb(rows, { failInsert: true })), req(), {
        action: 'auth.logout', resourceType: 'session', outcome: 'success',
      }),
    ).resolves.toBeUndefined();
    expect(rows).toHaveLength(0);
  });

  it('purges only rows older than the retention cutoff', async () => {
    const now = Date.UTC(2026, 5, 5);
    const old = new Date(now - AUDIT_RETENTION_MS - 1000).toISOString();
    const fresh = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const rows: AuditRow[] = [
      { id: 'a', ts: old, request_id: null, actor_id: null, action: 'x', resource_type: 'y', resource_id: null, outcome: 'success', brand_id: 'wkrp', meta: null },
      { id: 'b', ts: fresh, request_id: null, actor_id: null, action: 'x', resource_type: 'y', resource_id: null, outcome: 'success', brand_id: 'wkrp', meta: null },
    ];
    const purged = await purgeExpiredAudit(envWith(makeDb(rows)), now);
    expect(purged).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['b']);
  });

  it('requestId falls back to a generated id without cf-ray', () => {
    expect(requestId(req({ 'cf-ray': 'ray-9' }))).toBe('ray-9');
    const generated = requestId(req());
    expect(typeof generated).toBe('string');
    expect(generated.length).toBeGreaterThan(0);
  });
});
