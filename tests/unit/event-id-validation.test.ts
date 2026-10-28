/**
 * Unit tests: an event id OW stores must have OSE's event id shape.
 *
 * attributions.event_id and dj_sets.event_id sit next to named listener and DJ
 * ids and are later shown in per-event aggregates and the exported music seam.
 * They used to be taken from the request body with only a length limit (or
 * none), so a forged value with markup, quotes, slashes or 10 KB of text was
 * stored as-is. Every write path now holds the value to SAFE_ID_RE
 * (lib/ids.ts), the same rule the DJ poster applies to the id it puts in its QR.
 *
 * Born red on main at eb22bc2: the schemas accepted every hostile value below,
 * the attribution handler wrote it with an INSERT, the start-set handler bound
 * it into dj_sets, and live.html sent ?event= unchecked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SAFE_ID_RE } from '../../src/lib/ids';
import { createAttributionBodySchema, startSetBodySchema } from '../../src/lib/schemas';
import type { Env } from '../../src/types';

vi.mock('../../src/lib/require-session', () => ({
  requireSession: vi.fn(async () => ({ userId: 'dj-user-1' })),
}));

// Imported after the mock so handleStartSet sees the stubbed session.
const { handleCreateAttribution, handleStartSet } = await import('../../src/handlers/dj');

const HOSTILE: Array<[string, string]> = [
  ['a space', 'evt 123'],
  ['angle brackets', '<script>alert(1)</script>'],
  ['a double quote', 'evt"123'],
  ['a single quote', "evt'123"],
  ['a slash', 'evt/123'],
  ['a percent', 'evt%20123'],
  ['non-ASCII', 'evt-café'],
  ['the empty string', ''],
  ['129 characters', 'a'.repeat(129)],
  ['a very long value', 'x'.repeat(10_000)],
];

const VALID = ['evt-123', 'OSE_Event-9', 'a'.repeat(128)];

describe('SAFE_ID_RE is the poster rule', () => {
  it('is letters, digits, underscore and hyphen, 1 to 128', () => {
    expect(SAFE_ID_RE.source).toBe('^[A-Za-z0-9_-]{1,128}$');
    expect(SAFE_ID_RE.flags).toBe('');
  });
});

describe.each([
  ['attribution body', createAttributionBodySchema, { dj_id: 'dj-1', track_id: 'trk-1' }],
  ['DJ set body', startSetBodySchema, { venue_name: 'The Hall' }],
] as const)('%s: event_id', (_name, schema, base) => {
  for (const [what, value] of HOSTILE) {
    it(`rejects an event id with ${what}`, () => {
      const result = schema.safeParse({ ...base, event_id: value });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.join('.') === 'event_id');
        expect(issue?.message).toBe('Invalid event id');
      }
    });
  }

  for (const value of VALID) {
    it(`accepts ${value.length > 20 ? `a ${value.length}-character id` : value}`, () => {
      const result = schema.safeParse({ ...base, event_id: value });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.event_id).toBe(value);
    });
  }

  it('accepts null', () => {
    const result = schema.safeParse({ ...base, event_id: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.event_id).toBeNull();
  });

  it('accepts the field omitted', () => {
    const result = schema.safeParse({ ...base });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.event_id).toBeUndefined();
  });
});

// --- Handlers, against a D1 stub that records every statement ---

interface Call { sql: string; args: unknown[] }

function recordingEnv(): { env: Env; calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const call = { sql, args };
          return {
            run: async () => { calls.push(call); return { success: true }; },
            first: async () => { calls.push(call); return sql.includes('FROM contributors') ? { id: 'dj-user-1', role: 'dj' } : null; },
            all: async () => { calls.push(call); return { results: [] }; },
          };
        },
      };
    },
  };
  return { env: { WKRP_DB: db } as unknown as Env, calls };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://ourwkrp.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const insertsInto = (calls: Call[], table: string): Call[] =>
  calls.filter((c) => new RegExp(`INSERT\\s+INTO\\s+${table}\\b`).test(c.sql));

describe('POST /api/attributions with an event id', () => {
  for (const [what, value] of HOSTILE) {
    it(`returns 400 and writes nothing for an event id with ${what}`, async () => {
      const { env, calls } = recordingEnv();
      const res = await handleCreateAttribution(post('/api/attributions', { dj_id: 'dj-1', track_id: 'trk-1', event_id: value }), env);
      expect(res.status).toBe(400);
      const body = await res.json() as { ok: boolean; error: string; field_errors: Record<string, string[]> };
      expect(body.ok).toBe(false);
      expect(body.field_errors.event_id).toEqual(['Invalid event id']);
      expect(calls.filter((c) => /\bINSERT\b/i.test(c.sql))).toEqual([]);
    });
  }

  it('a valid event id still records the attribution with it (201)', async () => {
    const { env, calls } = recordingEnv();
    const res = await handleCreateAttribution(post('/api/attributions', { dj_id: 'dj-1', track_id: 'trk-1', event_id: 'OSE_Event-9' }), env);
    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; attribution: { id: string }; push: unknown; discovery_playlist_id: unknown };
    expect(body.ok).toBe(true);
    expect(typeof body.attribution.id).toBe('string');
    expect(body.push).toBeNull();
    expect(body.discovery_playlist_id).toBeNull();
    const inserts = insertsInto(calls, 'attributions');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args.slice(1)).toEqual(['dj-1', null, 'trk-1', 'OSE_Event-9']);
  });

  it('no event id still records the attribution with null (201)', async () => {
    const { env, calls } = recordingEnv();
    const res = await handleCreateAttribution(post('/api/attributions', { dj_id: 'dj-1', track_id: 'trk-1' }), env);
    expect(res.status).toBe(201);
    expect(insertsInto(calls, 'attributions')[0].args[4]).toBeNull();
  });
});

describe('POST /api/sets with an event id', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // handleStartSet has always started the set when its body fails validation
  // (the body is optional), falling back to no venue and no event. That
  // fallback is unchanged; what matters is that a hostile id never reaches D1.
  for (const [what, value] of HOSTILE) {
    it(`never stores an event id with ${what}`, async () => {
      const { env, calls } = recordingEnv();
      await handleStartSet(post('/api/sets', { venue_name: 'The Hall', event_id: value }), env);
      const inserts = insertsInto(calls, 'dj_sets');
      for (const c of inserts) expect(c.args[2]).toBeNull();
      expect(calls.flatMap((c) => c.args)).not.toContain(value);
    });
  }

  it('a valid event id is stored as given', async () => {
    const { env, calls } = recordingEnv();
    const res = await handleStartSet(post('/api/sets', { venue_name: 'The Hall', event_id: 'evt-123' }), env);
    expect(res.status).toBe(201);
    const inserts = insertsInto(calls, 'dj_sets');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args.slice(1)).toEqual(['dj-user-1', 'evt-123', 'The Hall']);
  });
});

// --- The listener page sends event_id only when it has the right shape ---

describe('live.html: ?event= is sent only when it matches the rule', () => {
  const html = readFileSync(resolve(__dirname, '../../src/templates/live.html'), 'utf8');

  // The two declarations that turn ?event= into eventId, taken verbatim from
  // the template and run here, so the test exercises the page's own code.
  const reDecl = html.match(/var EVENT_ID_RE = (\/.+\/);/);
  const idDecl = html.match(/var eventId = ([^\n]+);/);

  it('declares the same literal as SAFE_ID_RE', () => {
    expect(reDecl).not.toBeNull();
    const re = new Function(`return ${reDecl![1]};`)() as RegExp;
    expect(re.source).toBe(SAFE_ID_RE.source);
    expect(re.flags).toBe(SAFE_ID_RE.flags);
  });

  function eventIdFor(search: string): unknown {
    expect(reDecl).not.toBeNull();
    expect(idDecl).not.toBeNull();
    const rawDecl = html.match(/var rawEventId = ([^\n]+);/);
    const src = [
      `var EVENT_ID_RE = ${reDecl![1]};`,
      rawDecl ? `var rawEventId = ${rawDecl[1]};` : '',
      `var eventId = ${idDecl![1]};`,
      'return eventId;',
    ].join('\n');
    return new Function('window', 'URLSearchParams', src)({ location: { search } }, URLSearchParams);
  }

  it('keeps a valid id', () => {
    expect(eventIdFor('?event=OSE_Event-9')).toBe('OSE_Event-9');
    expect(eventIdFor(`?event=${'a'.repeat(128)}`)).toBe('a'.repeat(128));
  });

  for (const [what, value] of HOSTILE) {
    it(`drops an id with ${what}`, () => {
      expect(eventIdFor(`?event=${encodeURIComponent(value)}`)).toBeNull();
    });
  }

  it('is null with no ?event=', () => {
    expect(eventIdFor('')).toBeNull();
  });

  it('the POST body carries event_id only when there is one', () => {
    const fetchCall = html.match(/fetch\('\/api\/attributions'[\s\S]*?\}\);/);
    expect(fetchCall).not.toBeNull();
    // event_id is never written into the body unconditionally ...
    expect(fetchCall![0]).not.toMatch(/event_id\s*:/);
    // ... it is added only behind a check on eventId, and that body is what is sent.
    expect(html).toMatch(/if \(eventId\) payload\.event_id = eventId;/);
    expect(fetchCall![0]).toMatch(/body: JSON\.stringify\(payload\)/);
  });
});
