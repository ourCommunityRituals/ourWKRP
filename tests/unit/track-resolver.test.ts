import { describe, it, expect, vi } from 'vitest';
import { resolveOrCreateTrack } from '../../src/lib/track-resolver';
import type { NormalizedTrackData } from '../../src/types';

// Suppress logger output in tests
vi.mock('../../src/lib/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
}));

/**
 * Create a mock D1Database that tracks SQL queries and returns
 * configured results based on query content.
 */
function createMockDb(options: {
  isrcMatch?: { id: string } | null;
  platformMatch?: { track_id: string } | null;
  canonicalMatch?: { id: string } | null;
} = {}) {
  const { isrcMatch = null, platformMatch = null, canonicalMatch = null } = options;

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes('isrc =') && !sql.includes('isrc IS NULL')) return isrcMatch;
          if (sql.includes('track_identifiers')) return platformMatch;
          if (sql.includes('canonical_title')) return canonicalMatch;
          return null;
        }),
        run: vi.fn(async () => ({ success: true })),
      })),
    })),
    batch: vi.fn(async (stmts: unknown[]) => stmts.map(() => ({ success: true }))),
  } as unknown as D1Database;
}

const baseTrack: NormalizedTrackData = {
  name: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  platform: 'spotify',
  source_type: 'liked',
};

describe('Track Resolver', () => {
  it('resolves by ISRC match', async () => {
    const db = createMockDb({ isrcMatch: { id: 'existing-track-1' } });
    const result = await resolveOrCreateTrack(db, { ...baseTrack, isrc: 'GBAYE0601498' });

    expect(result.trackId).toBe('existing-track-1');
    expect(result.isNew).toBe(false);
  });

  it('resolves by platform ID when no ISRC match', async () => {
    const db = createMockDb({ platformMatch: { track_id: 'existing-track-2' } });
    const result = await resolveOrCreateTrack(db, { ...baseTrack, isrc: 'NO_MATCH', platform_id: 'spotify-abc' });

    expect(result.trackId).toBe('existing-track-2');
    expect(result.isNew).toBe(false);
  });

  it('resolves by canonical title+artist as fallback', async () => {
    const db = createMockDb({ canonicalMatch: { id: 'existing-track-3' } });
    const result = await resolveOrCreateTrack(db, baseTrack);

    expect(result.trackId).toBe('existing-track-3');
    expect(result.isNew).toBe(false);
  });

  it('creates new track when no matches found', async () => {
    const db = createMockDb();
    const result = await resolveOrCreateTrack(db, baseTrack);

    expect(result.isNew).toBe(true);
    expect(result.trackId).toBeTruthy();
    expect(result.trackId.length).toBeGreaterThan(0);
  });

  it('returns a UUID for new tracks', async () => {
    const db = createMockDb();
    const result = await resolveOrCreateTrack(db, baseTrack);

    expect(result.trackId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('creates new track with audio features when available', async () => {
    const db = createMockDb();
    const result = await resolveOrCreateTrack(db, {
      ...baseTrack,
      energy: 0.8,
      danceability: 0.7,
      isrc: 'GBAYE0601498',
    });

    expect(result.isNew).toBe(true);
    // Verify INSERT was called with the track data
    expect(db.prepare).toHaveBeenCalled();
  });

  it('registers platform identifier for new tracks', async () => {
    const db = createMockDb();
    await resolveOrCreateTrack(db, {
      ...baseTrack,
      platform_id: 'spotify-xyz',
      platform_uri: 'spotify:track:xyz',
    });

    // Should have called prepare for track_identifiers INSERT
    const calls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const hasIdentifierInsert = calls.some((c: string[]) =>
      c[0]?.includes('track_identifiers')
    );
    expect(hasIdentifierInsert).toBe(true);
  });

  it('backfills ISRC on canonical match when track lacks one', async () => {
    const db = createMockDb({ canonicalMatch: { id: 'existing-no-isrc' } });
    await resolveOrCreateTrack(db, { ...baseTrack, isrc: 'NEW_ISRC_123' });

    // Should have called UPDATE to backfill ISRC
    const calls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
    const hasIsrcUpdate = calls.some((c: string[]) =>
      c[0]?.includes('isrc IS NULL')
    );
    expect(hasIsrcUpdate).toBe(true);
  });
});
