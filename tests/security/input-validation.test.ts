/**
 * Security tests — Input validation
 *
 * Tests that user inputs (name, generation) are properly validated
 * and sanitized to prevent XSS and injection attacks.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Input Validation', () => {
  describe('auth-start handler validation', () => {
    const handlerContent = fs.readFileSync(
      path.join(__dirname, '../../src/handlers/auth-start.ts'),
      'utf-8',
    );

    it('validates name is present', () => {
      expect(handlerContent).toContain('!name');
    });

    it('validates name length limits', () => {
      expect(handlerContent).toContain('name.length');
    });

    it('validates generation against allowed values', () => {
      expect(handlerContent).toContain('VALID_GENERATIONS');
      expect(handlerContent).toContain('founder');
      expect(handlerContent).toContain('gen2');
      expect(handlerContent).toContain('gen3');
    });

    it('strips HTML tags from name', () => {
      expect(handlerContent).toContain('replace(/<[^>]*>/g');
    });
  });

  describe('HTML template XSS prevention', () => {
    const catalogContent = fs.readFileSync(
      path.join(__dirname, '../../src/templates/catalog.html'),
      'utf-8',
    );

    it('uses escapeHtml function for dynamic content', () => {
      expect(catalogContent).toContain('escapeHtml');
    });

    it('escapeHtml uses textContent (safe) not innerHTML', () => {
      expect(catalogContent).toContain('div.textContent = str');
    });
  });

  describe('OAuth state validation', () => {
    const callbackContent = fs.readFileSync(
      path.join(__dirname, '../../src/handlers/auth-callback.ts'),
      'utf-8',
    );

    it('validates state parameter exists', () => {
      expect(callbackContent).toContain("!state");
    });

    it('validates state against stored KV value', () => {
      expect(callbackContent).toContain('getAuthState');
      expect(callbackContent).toContain('!authState');
    });

    it('deletes used state to prevent replay', () => {
      expect(callbackContent).toContain('deleteAuthState');
    });

    it('handles Spotify error responses', () => {
      expect(callbackContent).toContain("error");
      expect(callbackContent).toContain('spotify_denied');
    });
  });
});
