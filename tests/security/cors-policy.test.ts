/**
 * Security tests — CORS policy
 *
 * Verifies CORS is restricted to known origins. Wildcard (*) is never used.
 * Tests that cross-origin requests from unknown origins are rejected.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { corsHeaders } from '../../src/lib/cors';
import type { Env } from '../../src/types';

function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    WKRP_KV: {} as KVNamespace,
    WKRP_DB: {} as D1Database,
    WORKER_ENV: 'staging',
    WORKER_VERSION: '0.1.0',
    SPOTIFY_CLIENT_ID: 'test',
    SPOTIFY_REDIRECT_URI: 'http://localhost:8787/auth/callback',
    APP_URL: 'http://localhost:8787',
    ...overrides,
  };
}

describe('CORS Policy', () => {
  describe('Source code audit', () => {
    const corsSource = fs.readFileSync(
      path.join(__dirname, '../../src/lib/cors.ts'),
      'utf-8',
    );

    it('does NOT use wildcard * for Access-Control-Allow-Origin', () => {
      // Wildcard CORS is dangerous for OAuth apps
      expect(corsSource).not.toContain("'*'");
      expect(corsSource).not.toContain('"*"');
    });

    it('validates origin against an allowlist', () => {
      expect(corsSource).toContain('getAllowedOrigin');
    });

    it('does not expose Authorization header in CORS', () => {
      // We don't need Authorization from cross-origin — sessions use URL params
      expect(corsSource).not.toContain('Authorization');
    });

    it('sets Vary: Origin header', () => {
      expect(corsSource).toContain('Vary');
    });
  });

  describe('Origin allowlist behavior', () => {
    const env = mockEnv();

    it('allows localhost:8787 in dev', () => {
      const headers = corsHeaders('http://localhost:8787', env);
      expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:8787');
    });

    it('allows 127.0.0.1:8787 in dev', () => {
      const headers = corsHeaders('http://127.0.0.1:8787', env);
      expect(headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:8787');
    });

    it('rejects unknown origins', () => {
      const headers = corsHeaders('https://evil.com', env);
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });

    it('rejects null origin', () => {
      const headers = corsHeaders(null, env);
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });

    it('rejects origin with extra path', () => {
      const headers = corsHeaders('http://localhost:8787/evil', env);
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });

    it('allows APP_URL origin in production', () => {
      const prodEnv = mockEnv({
        APP_URL: 'https://ourwkrp.com',
        WORKER_ENV: 'production',
      });
      const headers = corsHeaders('https://ourwkrp.com', prodEnv);
      expect(headers['Access-Control-Allow-Origin']).toBe('https://ourwkrp.com');
    });

    it('rejects http for production domain', () => {
      const prodEnv = mockEnv({
        APP_URL: 'https://ourwkrp.com',
        WORKER_ENV: 'production',
      });
      // http://ourwkrp.com is not in the allowlist — only https
      const headers = corsHeaders('http://ourwkrp.com', prodEnv);
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });
  });
});
