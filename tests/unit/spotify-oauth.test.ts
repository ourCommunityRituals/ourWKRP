/**
 * Unit tests — Spotify OAuth PKCE flow
 */
import { describe, it, expect } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '../../src/auth/spotify-oauth';

describe('Spotify OAuth PKCE', () => {
  describe('generateCodeVerifier', () => {
    it('generates a string of default length 64', () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toHaveLength(64);
    });

    it('generates a string of custom length', () => {
      const verifier = generateCodeVerifier(43);
      expect(verifier).toHaveLength(43);
    });

    it('uses only valid PKCE characters', () => {
      const verifier = generateCodeVerifier(128);
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    });

    it('generates unique values', () => {
      const v1 = generateCodeVerifier();
      const v2 = generateCodeVerifier();
      expect(v1).not.toBe(v2);
    });
  });

  describe('generateCodeChallenge', () => {
    it('produces a base64url string without padding', async () => {
      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
      expect(challenge).not.toContain('=');
      expect(challenge).not.toContain('+');
      expect(challenge).not.toContain('/');
    });

    it('produces deterministic output for same input', async () => {
      const verifier = 'test-verifier-string-for-determinism';
      const c1 = await generateCodeChallenge(verifier);
      const c2 = await generateCodeChallenge(verifier);
      expect(c1).toBe(c2);
    });

    it('produces different output for different input', async () => {
      const c1 = await generateCodeChallenge('verifier-one');
      const c2 = await generateCodeChallenge('verifier-two');
      expect(c1).not.toBe(c2);
    });
  });

  describe('generateState', () => {
    it('generates a 64-character hex string', () => {
      const state = generateState();
      expect(state).toHaveLength(64);
      expect(state).toMatch(/^[0-9a-f]+$/);
    });

    it('generates unique values', () => {
      const s1 = generateState();
      const s2 = generateState();
      expect(s1).not.toBe(s2);
    });
  });
});
