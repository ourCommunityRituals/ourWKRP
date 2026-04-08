/**
 * Unit tests — Cursor-based pagination
 */
import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, parsePaginationParams } from '../../src/lib/cursor';

describe('Cursor pagination', () => {
  describe('encodeCursor / decodeCursor', () => {
    it('round-trips an id-only cursor', () => {
      const encoded = encodeCursor('abc-123');
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual({ id: 'abc-123' });
    });

    it('round-trips a cursor with sort value', () => {
      const encoded = encodeCursor('abc-123', 2020);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual({ id: 'abc-123', v: 2020 });
    });

    it('round-trips a cursor with string sort value', () => {
      const encoded = encodeCursor('abc-123', 'rock');
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual({ id: 'abc-123', v: 'rock' });
    });

    it('returns null for invalid base64', () => {
      expect(decodeCursor('not-valid-base64!!!')).toBeNull();
    });

    it('returns null for valid base64 but invalid JSON', () => {
      expect(decodeCursor(btoa('not json'))).toBeNull();
    });

    it('returns null for JSON missing id field', () => {
      expect(decodeCursor(btoa('{"v":123}'))).toBeNull();
    });
  });

  describe('parsePaginationParams', () => {
    it('returns defaults when no params', () => {
      const url = new URL('http://localhost/api/tracks');
      expect(parsePaginationParams(url)).toEqual({ cursor: null, limit: 25 });
    });

    it('parses cursor param', () => {
      const url = new URL('http://localhost/api/tracks?cursor=abc123');
      expect(parsePaginationParams(url).cursor).toBe('abc123');
    });

    it('parses valid limit', () => {
      const url = new URL('http://localhost/api/tracks?limit=50');
      expect(parsePaginationParams(url).limit).toBe(50);
    });

    it('clamps limit to max 100', () => {
      const url = new URL('http://localhost/api/tracks?limit=500');
      expect(parsePaginationParams(url).limit).toBe(25); // falls through to default
    });

    it('clamps limit to min 1', () => {
      const url = new URL('http://localhost/api/tracks?limit=0');
      expect(parsePaginationParams(url).limit).toBe(25); // falls through to default
    });

    it('ignores non-numeric limit', () => {
      const url = new URL('http://localhost/api/tracks?limit=abc');
      expect(parsePaginationParams(url).limit).toBe(25);
    });
  });
});
