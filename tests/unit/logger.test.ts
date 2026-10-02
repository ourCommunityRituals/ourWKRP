import { describe, it, expect, vi, afterEach } from 'vitest';
import { log, logError } from '../../src/lib/logger';

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
