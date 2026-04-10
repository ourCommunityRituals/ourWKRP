import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.join(__dirname, '../../src');

describe('Session Security Invariants', () => {
  describe('session-cookie.ts — cookie flags', () => {
    const source = fs.readFileSync(path.join(SRC_DIR, 'lib/session-cookie.ts'), 'utf-8');

    it('sets HttpOnly flag on session cookie', () => {
      expect(source).toContain('HttpOnly');
    });

    it('sets SameSite flag on session cookie', () => {
      expect(source).toContain('SameSite=Lax');
    });

    it('sets Secure flag conditionally for production', () => {
      expect(source).toContain('Secure');
      expect(source).toContain('isProduction');
    });

    it('sets Max-Age for expiry', () => {
      expect(source).toContain('Max-Age=');
    });

    it('clear cookie sets Max-Age=0', () => {
      expect(source).toContain('Max-Age=0');
    });
  });

  describe('auth-session.ts — cookie-only session retrieval', () => {
    const source = fs.readFileSync(path.join(SRC_DIR, 'handlers/auth-session.ts'), 'utf-8');

    it('does NOT accept path tokens from URL', () => {
      // Should not split on /auth/session/ to extract arbitrary tokens
      expect(source).not.toContain("split('/auth/session/')");
    });

    it('does NOT use pathToken variable', () => {
      expect(source).not.toContain('pathToken');
    });

    it('uses getSessionToken to read from cookie', () => {
      expect(source).toContain('getSessionToken(request)');
    });
  });

  describe('auth-logout.ts — session cleanup', () => {
    const source = fs.readFileSync(path.join(SRC_DIR, 'handlers/auth-logout.ts'), 'utf-8');

    it('deletes session from KV', () => {
      expect(source).toContain('deleteSession');
    });

    it('clears the session cookie', () => {
      expect(source).toContain('buildClearSessionCookie');
    });
  });

  describe('require-session.ts — shared auth helper', () => {
    const source = fs.readFileSync(path.join(SRC_DIR, 'lib/require-session.ts'), 'utf-8');

    it('reads session from cookie only', () => {
      expect(source).toContain('getSessionToken(request)');
    });

    it('validates session against KV', () => {
      expect(source).toContain('getSession(');
    });

    it('returns 401 for missing session', () => {
      expect(source).toContain('401');
    });

    it('does not expose session token in JSON response body', () => {
      // Ensure session tokens are never included in Response.json() payloads
      expect(source).not.toMatch(/Response\.json\([^)]*token/);
    });
  });

  describe('no handler exposes session token in response body', () => {
    const handlers = [
      'handlers/auth-session.ts',
      'handlers/auth-logout.ts',
      'handlers/auth-callback.ts',
    ];

    for (const handler of handlers) {
      const source = fs.readFileSync(path.join(SRC_DIR, handler), 'utf-8');

      it(`${handler}: does not include session token in JSON response`, () => {
        // Session tokens should never appear in response JSON
        // Look for patterns like: { token: sessionToken } or { session_token: ... }
        expect(source).not.toMatch(/Response\.json\([^)]*session.?[Tt]oken/);
      });
    }
  });

  describe('handlers use shared requireSession instead of inline auth', () => {
    const playlistSource = fs.readFileSync(path.join(SRC_DIR, 'handlers/playlist.ts'), 'utf-8');
    const djSource = fs.readFileSync(path.join(SRC_DIR, 'handlers/dj.ts'), 'utf-8');

    it('playlist.ts uses requireSession', () => {
      expect(playlistSource).toContain('requireSession');
    });

    it('playlist.ts does not define its own authenticate function', () => {
      expect(playlistSource).not.toMatch(/async function authenticate/);
    });

    it('dj.ts uses requireSession for protected endpoints', () => {
      expect(djSource).toContain('requireSession');
    });

    it('dj.ts does not define its own authenticate function', () => {
      expect(djSource).not.toMatch(/async function authenticate/);
    });
  });
});
