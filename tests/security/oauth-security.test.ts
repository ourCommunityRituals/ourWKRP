/**
 * Security tests — OAuth flow hardening
 *
 * Verifies PKCE implementation, state parameter anti-CSRF,
 * token handling, and session management security.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '../../src/auth/spotify-oauth';

const SRC = (f: string) => path.join(__dirname, '../../src', f);

describe('PKCE Security', () => {
  it('code_verifier is cryptographically random (64 chars)', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).toHaveLength(64);
    expect(v2).toHaveLength(64);
    expect(v1).not.toBe(v2); // Non-deterministic
  });

  it('code_verifier uses only RFC 7636 unreserved characters', () => {
    const verifier = generateCodeVerifier();
    // PKCE spec allows: [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('code_challenge is different from code_verifier (hashed)', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).not.toBe(verifier);
    expect(challenge.length).toBeGreaterThan(0);
  });

  it('same verifier produces same challenge (deterministic hash)', async () => {
    const verifier = generateCodeVerifier();
    const c1 = await generateCodeChallenge(verifier);
    const c2 = await generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });

  it('state token is cryptographically random (64 chars)', () => {
    const s1 = generateState();
    const s2 = generateState();
    expect(s1).toHaveLength(64);
    expect(s2).toHaveLength(64);
    expect(s1).not.toBe(s2);
  });
});

describe('State Parameter Anti-CSRF', () => {
  const callbackSource = fs.readFileSync(SRC('handlers/auth-callback.ts'), 'utf-8');
  const kvSource = fs.readFileSync(SRC('lib/kv-storage.ts'), 'utf-8');

  it('callback rejects missing state parameter', () => {
    expect(callbackSource).toContain('!state');
  });

  it('callback looks up state in KV before proceeding', () => {
    expect(callbackSource).toContain('getAuthState(env.WKRP_KV, state)');
  });

  it('callback deletes state after use (single-use)', () => {
    expect(callbackSource).toContain('deleteAuthState');
  });

  it('auth state has TTL (expires)', () => {
    // KV storage should set expirationTtl on auth state
    expect(kvSource).toContain('expirationTtl');
  });
});

describe('Token Storage Security', () => {
  const kvSource = fs.readFileSync(SRC('lib/kv-storage.ts'), 'utf-8');

  it('tokens are stored server-side in KV, not returned to frontend', () => {
    const sessionSource = fs.readFileSync(SRC('handlers/auth-session.ts'), 'utf-8');
    expect(sessionSource).not.toContain('access_token');
    expect(sessionSource).not.toContain('refresh_token');
  });

  it('session tokens use crypto.randomUUID', () => {
    const callbackSource = fs.readFileSync(SRC('handlers/auth-callback.ts'), 'utf-8');
    expect(callbackSource).toContain('crypto.randomUUID()');
  });

  it('session data has TTL', () => {
    // Sessions should expire
    expect(kvSource).toContain('expirationTtl');
  });
});

describe('Spotify Token Exchange Security', () => {
  const oauthSource = fs.readFileSync(SRC('auth/spotify-oauth.ts'), 'utf-8');

  it('uses PKCE (code_verifier) not client_secret in token request body', () => {
    expect(oauthSource).toContain('code_verifier');
    // The file may mention client_secret in comments explaining it's NOT used,
    // but the URLSearchParams body must not include it
    const bodySection = oauthSource.slice(oauthSource.indexOf('new URLSearchParams'));
    expect(bodySection).not.toMatch(/client_secret.*[:=]/);
  });

  it('sends token request as POST with form body (not GET)', () => {
    expect(oauthSource).toContain("method: 'POST'");
    expect(oauthSource).toContain('application/x-www-form-urlencoded');
  });

  it('uses S256 challenge method (not plain)', () => {
    expect(oauthSource).toContain('S256');
  });
});
