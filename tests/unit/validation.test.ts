/**
 * Unit tests — Zod schemas + validation middleware
 * WKRP-9 Reliability: structured 400 errors with field paths
 */
import { describe, it, expect } from 'vitest';
import {
  registerBodySchema,
  createPlaylistBodySchema,
  playlistTracksBodySchema,
  startSetBodySchema,
  addSetTrackBodySchema,
  createAttributionBodySchema,
  spotifyTrackUriSchema,
  spotifyTrackIdSchema,
  catalogQuerySchema,
  nameSchema,
  roleSchema,
  generationSchema,
} from '../../src/lib/schemas';

describe('Zod Schemas', () => {
  describe('nameSchema', () => {
    it('accepts valid names', () => {
      expect(nameSchema.parse('Matt')).toBe('Matt');
      expect(nameSchema.parse('  Matt  ')).toBe('Matt');
    });

    it('strips HTML tags', () => {
      expect(nameSchema.parse('<script>alert(1)</script>Matt')).toBe('alert(1)Matt');
    });

    it('rejects empty names', () => {
      expect(() => nameSchema.parse('')).toThrow();
    });

    it('rejects names over 100 chars', () => {
      expect(() => nameSchema.parse('A'.repeat(101))).toThrow();
    });
  });

  describe('roleSchema', () => {
    it('accepts valid roles', () => {
      expect(roleSchema.parse('dj')).toBe('dj');
      expect(roleSchema.parse('curator')).toBe('curator');
      expect(roleSchema.parse('contributor')).toBe('contributor');
      expect(roleSchema.parse('listener')).toBe('listener');
    });

    it('rejects invalid roles', () => {
      expect(() => roleSchema.parse('admin')).toThrow();
      expect(() => roleSchema.parse('')).toThrow();
    });
  });

  describe('generationSchema', () => {
    it('accepts valid generations', () => {
      expect(generationSchema.parse('founder')).toBe('founder');
      expect(generationSchema.parse('gen2')).toBe('gen2');
      expect(generationSchema.parse('gen3')).toBe('gen3');
    });

    it('rejects invalid generations', () => {
      expect(() => generationSchema.parse('gen4')).toThrow();
    });
  });

  describe('registerBodySchema', () => {
    it('accepts valid registration', () => {
      const result = registerBodySchema.parse({ name: 'Matt', role: 'dj', generation: 'founder' });
      expect(result.name).toBe('Matt');
      expect(result.role).toBe('dj');
      expect(result.generation).toBe('founder');
    });

    it('defaults role and generation so name alone is enough', () => {
      const result = registerBodySchema.parse({ name: 'Matt' });
      expect(result.name).toBe('Matt');
      expect(result.role).toBe('contributor');
      expect(result.generation).toBe('founder');
    });

    it('requires a name', () => {
      const result = registerBodySchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(i => i.path[0]);
        expect(paths).toContain('name');
      }
    });
  });

  describe('createPlaylistBodySchema', () => {
    it('accepts valid playlist', () => {
      const result = createPlaylistBodySchema.parse({ name: 'Summer Jams' });
      expect(result.name).toBe('Summer Jams');
      expect(result.description).toBeUndefined();
    });

    it('trims and validates name', () => {
      const result = createPlaylistBodySchema.parse({ name: '  My Mix  ', description: '  desc  ' });
      expect(result.name).toBe('My Mix');
      expect(result.description).toBe('desc');
    });

    it('rejects empty name', () => {
      expect(() => createPlaylistBodySchema.parse({ name: '' })).toThrow();
    });

    it('rejects name over 200 chars', () => {
      expect(() => createPlaylistBodySchema.parse({ name: 'A'.repeat(201) })).toThrow();
    });
  });

  describe('playlistTracksBodySchema', () => {
    it('accepts valid track_ids', () => {
      const result = playlistTracksBodySchema.parse({ track_ids: ['t1', 't2'] });
      expect(result.track_ids).toEqual(['t1', 't2']);
    });

    it('rejects empty array', () => {
      expect(() => playlistTracksBodySchema.parse({ track_ids: [] })).toThrow();
    });

    it('rejects more than 100 tracks', () => {
      const ids = Array.from({ length: 101 }, (_, i) => `t${i}`);
      expect(() => playlistTracksBodySchema.parse({ track_ids: ids })).toThrow();
    });

    it('rejects missing track_ids', () => {
      expect(() => playlistTracksBodySchema.parse({})).toThrow();
    });
  });

  describe('startSetBodySchema', () => {
    it('accepts empty body', () => {
      const result = startSetBodySchema.parse({});
      expect(result.venue_name).toBeUndefined();
    });

    it('accepts venue_name', () => {
      const result = startSetBodySchema.parse({ venue_name: 'RIPH' });
      expect(result.venue_name).toBe('RIPH');
    });
  });

  describe('addSetTrackBodySchema', () => {
    it('accepts valid track_id', () => {
      const result = addSetTrackBodySchema.parse({ track_id: 'abc-123' });
      expect(result.track_id).toBe('abc-123');
    });

    it('rejects empty track_id', () => {
      expect(() => addSetTrackBodySchema.parse({ track_id: '' })).toThrow();
    });

    it('rejects missing track_id', () => {
      expect(() => addSetTrackBodySchema.parse({})).toThrow();
    });
  });

  describe('createAttributionBodySchema', () => {
    it('accepts valid attribution', () => {
      const result = createAttributionBodySchema.parse({ dj_id: 'dj1', track_id: 't1' });
      expect(result.dj_id).toBe('dj1');
      expect(result.track_id).toBe('t1');
      expect(result.event_id).toBeUndefined();
    });

    it('accepts optional event_id', () => {
      const result = createAttributionBodySchema.parse({ dj_id: 'dj1', track_id: 't1', event_id: 'evt1' });
      expect(result.event_id).toBe('evt1');
    });

    it('rejects missing dj_id', () => {
      expect(() => createAttributionBodySchema.parse({ track_id: 't1' })).toThrow();
    });
  });

  describe('spotifyTrackUriSchema', () => {
    it('accepts valid Spotify URI', () => {
      expect(spotifyTrackUriSchema.parse('spotify:track:6rqhFgbbKwnb9MLmUQDhG6')).toBeTruthy();
    });

    it('rejects invalid URIs', () => {
      expect(() => spotifyTrackUriSchema.parse('spotify:album:abc')).toThrow();
      expect(() => spotifyTrackUriSchema.parse('not-a-uri')).toThrow();
      expect(() => spotifyTrackUriSchema.parse('')).toThrow();
    });
  });

  describe('spotifyTrackIdSchema', () => {
    it('accepts valid Spotify track ID', () => {
      expect(spotifyTrackIdSchema.parse('6rqhFgbbKwnb9MLmUQDhG6')).toBeTruthy();
    });

    it('rejects invalid IDs', () => {
      expect(() => spotifyTrackIdSchema.parse('short')).toThrow();
      expect(() => spotifyTrackIdSchema.parse('has spaces in it here!')).toThrow();
    });
  });

  describe('catalogQuerySchema', () => {
    it('accepts empty query', () => {
      const result = catalogQuerySchema.parse({});
      expect(result).toBeDefined();
    });

    it('coerces numeric strings', () => {
      const result = catalogQuerySchema.parse({ year_min: '2010', energy_min: '0.7' });
      expect(result.year_min).toBe(2010);
      expect(result.energy_min).toBe(0.7);
    });

    it('clamps energy to 0-1', () => {
      expect(() => catalogQuerySchema.parse({ energy_min: '2.0' })).toThrow();
      expect(() => catalogQuerySchema.parse({ energy_min: '-0.5' })).toThrow();
    });
  });
});
