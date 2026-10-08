import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { log, logError, REDACT_KEYS } from '../../src/lib/logger';

function captureLog(fn: () => void): Record<string, unknown> {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  fn();
  const payload = JSON.parse(spy.mock.calls[0][0] as string);
  spy.mockRestore();
  return payload;
}

function captureError(fn: () => void): Record<string, unknown> {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  fn();
  const payload = JSON.parse(spy.mock.calls[0][0] as string);
  spy.mockRestore();
  return payload;
}

afterEach(() => vi.restoreAllMocks());

describe('logger redaction', () => {
  it('redacts credentials and PII keys', () => {
    const out = captureLog(() => log('TEST', {
      access_token: 'secret-abc',
      refresh_token: 'refresh-xyz',
      display_name: 'Sample Person',
      email: 'person@example.com',
      brand_id: 'wkrp',
    }));
    expect(out.access_token).toBe('[redacted]');
    expect(out.refresh_token).toBe('[redacted]');
    expect(out.display_name).toBe('[redacted]');
    expect(out.email).toBe('[redacted]');
    expect(out.brand_id).toBe('wkrp'); // non-sensitive passes through
  });

  it('redacts raw SQL diagnostics and user search terms', () => {
    const out = captureLog(() => log('CATALOG', {
      sql: 'SELECT * FROM tracks WHERE artist = ?',
      binds: ['Radiohead'],
      q: 'sensitive search',
      conditions: 3,
    }));
    expect(out.sql).toBe('[redacted]');
    expect(out.binds).toBe('[redacted]');
    expect(out.q).toBe('[redacted]');
    expect(out.conditions).toBe(3);
  });

  it('redacts nested sensitive values', () => {
    const out = captureLog(() => log('NESTED', {
      profile: { display_name: 'Matt', id: 'abc123' },
    }));
    expect((out.profile as Record<string, unknown>).display_name).toBe('[redacted]');
    expect((out.profile as Record<string, unknown>).id).toBe('abc123');
  });

  it('redacts context passed to logError', () => {
    const out = captureError(() => logError('ERR', new Error('boom'), { email: 'x@y.com', code: 500 }));
    expect(out.email).toBe('[redacted]');
    expect(out.code).toBe(500);
    expect(out.error).toBe('boom');
  });
});

describe('logger redaction: names and usernames', () => {
  it('redacts a contributor name, a username and a Last.fm username', () => {
    const out = captureLog(() => log('REGISTER_SUCCESS', {
      id: 'c-1', name: 'Sample Person', username: 'sample', lastfm_username: 'sample-fm', role: 'contributor',
    }));
    expect(out.name).toBe('[redacted]');
    expect(out.username).toBe('[redacted]');
    expect(out.lastfm_username).toBe('[redacted]');
    expect(out.id).toBe('c-1'); // opaque ids pass through
    expect(out.role).toBe('contributor');
  });

  // Derived: every key any log() call in src/ passes that names a person must
  // be on the redaction list, so a new log line cannot carry one unnoticed.
  it('every person-naming key used in a src/ log() call is redacted', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '../../src'));
    const keys = new Set<string>();
    const call = /\blog(?:Error)?\(\s*'[A-Z_]+'\s*,[^{]*\{([^}]*)\}/g;
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(call)) {
        for (const k of m[1].matchAll(/(?:^|[,{\s])(\w+)\s*(?=[:,]|$)/g)) keys.add(k[1]);
      }
    }
    expect(keys.size, 'the scan found no log payload keys').toBeGreaterThan(10);
    const personal = [...keys].filter(
      (k) => /(^|_)(name|username|email)$/i.test(k) && !/^(playlist|venue|event|track|artist)_?name$/i.test(k)
    );
    expect(personal.length, 'no person-naming key was found: the scan is blind').toBeGreaterThan(0);
    expect(personal.filter((k) => !REDACT_KEYS.has(k.toLowerCase()))).toEqual([]);
  });
});
