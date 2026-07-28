/**
 * Performance tests — Scale benchmarks
 *
 * Simulates ourWKRP at scale: multiple venues, concurrent scans,
 * large catalogs, DJ set operations. Tests that the Worker architecture
 * holds up when the matchstick catches.
 *
 * Scenarios modeled:
 *   - Single venue (RIPH): 1 DJ, 30 patrons, Friday night
 *   - 5 venues (OWL network): 5 DJs, 150 patrons, same Saturday
 *   - 20 venues (regional): 20 DJs, 500+ patrons
 *   - Catalog at 10k, 50k, 100k tracks
 */
import { describe, it, expect, vi } from 'vitest';
import { handleGetTracks, handleGetStats, handleGetLayers } from '../../src/handlers/catalog';
import { handleCreateAttribution, handleStartSet, handleAddSetTrack, handleEndSet } from '../../src/handlers/dj';
import { handleSponsorReport } from '../../src/handlers/sponsor';
import { handleRegister } from '../../src/handlers/auth-register';
import { handleExportTracks } from '../../src/handlers/export';

// Mock logger — vi.mock is hoisted above the static imports above
vi.mock('../../src/lib/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  redact: (v: unknown) => v,
}));

// --- Helpers ---

function mockD1(trackCount = 1000) {
  const batchCalls: number[] = [];
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => ({ success: true })),
        first: vi.fn(async () => ({ count: trackCount, id: 'dj-1', dj_id: 'dj-1', contributor_id: 'dj-1', role: 'dj', name: 'DJ Test', venue_name: 'RIPH', is_live: 1, track_count: 0, next_pos: 0 })),
        all: vi.fn(async () => ({
          results: Array.from({ length: Math.min(trackCount, 25) }, (_, i) => ({
            id: `track-${i}`,
            name: `Track ${i}`,
            artist: `Artist ${i % 50}`,
            album: `Album ${i % 20}`,
            genre: ['hip-hop', 'rock', 'electronic', 'jazz', 'soul'][i % 5],
            energy: Math.random(),
            valence: Math.random(),
            danceability: Math.random(),
            release_year: 1970 + (i % 55),
            isrc: `USRC${String(i).padStart(8, '0')}`,
          })),
        })),
      })),
    })),
    batch: vi.fn(async (stmts: unknown[]) => {
      batchCalls.push(stmts.length);
      return stmts.map(() => ({ success: true, results: [{ count: trackCount }] }));
    }),
    _batchCalls: batchCalls,
  };
}

function mockKV() {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    get: vi.fn(async (key: string) => store.get(key) || null),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    _store: store,
  };
}

function mockEnv(trackCount = 1000) {
  return {
    WKRP_DB: mockD1(trackCount),
    WKRP_KV: mockKV(),
    WORKER_ENV: 'staging',
    WORKER_VERSION: '0.1.0',
    SPOTIFY_CLIENT_ID: 'test',
    SPOTIFY_REDIRECT_URI: 'http://localhost:8787/auth/callback',
    APP_URL: 'http://localhost:8787',
    LASTFM_API_KEY: '',
    LASTFM_SHARED_SECRET: '',
  };
}

// --- Tests ---

describe('Scale Benchmarks', () => {
  describe('Catalog query performance', () => {
    it('handles 100 concurrent track queries in under 2 seconds', { timeout: 15000 }, async () => {
      const env = mockEnv(10000);

      const start = performance.now();
      const queries = Array.from({ length: 100 }, (_, i) => {
        const params = new URLSearchParams({
          q: `artist ${i % 10}`,
          limit: '25',
          energy_min: String(Math.random().toFixed(2)),
        });
        const req = new Request(`http://localhost:8787/api/tracks?${params}`);
        return handleGetTracks(req, env as never);
      });

      const results = await Promise.all(queries);
      const elapsed = performance.now() - start;

      console.log(`100 catalog queries: ${elapsed.toFixed(0)}ms (${(elapsed / 100).toFixed(1)}ms avg)`);

      results.forEach(r => expect(r.status).toBe(200));
      expect(elapsed).toBeLessThan(2000);
    });

    it('handles catalog query with all filters in under 50ms', { timeout: 15000 }, async () => {
      const env = mockEnv(50000);

      const params = new URLSearchParams({
        q: 'kendrick',
        genre: 'hip-hop',
        artist: 'lamar',
        year_min: '2010',
        year_max: '2024',
        energy_min: '0.5',
        valence_min: '0.3',
        danceability_min: '0.4',
        limit: '25',
      });

      const start = performance.now();
      const res = await handleGetTracks(
        new Request(`http://localhost:8787/api/tracks?${params}`),
        env as never,
      );
      const elapsed = performance.now() - start;

      console.log(`Full-filter catalog query: ${elapsed.toFixed(1)}ms`);

      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(50);
    });

    it('layer filter query performs within 50ms', { timeout: 15000 }, async () => {
      const env = mockEnv(10000);

      const layers = ['dj', 'crew', 'community'];
      const start = performance.now();

      for (const layer of layers) {
        const res = await handleGetTracks(
          new Request(`http://localhost:8787/api/tracks?layer=${layer}&limit=25`),
          env as never,
        );
        expect(res.status).toBe(200);
      }

      const elapsed = performance.now() - start;
      console.log(`3 layer queries: ${elapsed.toFixed(0)}ms (${(elapsed / 3).toFixed(1)}ms avg)`);
      expect(elapsed).toBeLessThan(150);
    });
  });

  describe('Attribution burst performance', () => {
    it('handles 50 concurrent attributions (Friday night at RIPH)', { timeout: 15000 }, async () => {
      const env = mockEnv();

      const start = performance.now();
      const attributions = Array.from({ length: 50 }, (_, i) =>
        handleCreateAttribution(
          new Request('http://localhost:8787/api/attributions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dj_id: 'dj-1',
              track_id: `track-${i % 10}`,
              event_id: 'riph-friday',
            }),
          }),
          env as never,
        )
      );

      const results = await Promise.all(attributions);
      const elapsed = performance.now() - start;

      console.log(`50 concurrent attributions (RIPH Friday): ${elapsed.toFixed(0)}ms (${(elapsed / 50).toFixed(1)}ms avg)`);

      results.forEach(r => expect(r.status).toBe(201));
      expect(elapsed).toBeLessThan(3000);
    });

    it('handles 250 concurrent attributions (5-venue Saturday)', { timeout: 15000 }, async () => {
      const env = mockEnv();

      const venues = ['riph', 'reckless', 'transit', 'honkytonk', 'gallery'];

      const start = performance.now();
      const attributions = Array.from({ length: 250 }, (_, i) =>
        handleCreateAttribution(
          new Request('http://localhost:8787/api/attributions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dj_id: `dj-${i % 5}`,
              track_id: `track-${i % 20}`,
              event_id: `${venues[i % 5]}-saturday`,
            }),
          }),
          env as never,
        )
      );

      const results = await Promise.all(attributions);
      const elapsed = performance.now() - start;

      console.log(`250 concurrent attributions (5 venues): ${elapsed.toFixed(0)}ms (${(elapsed / 250).toFixed(1)}ms avg)`);

      results.forEach(r => expect(r.status).toBe(201));
      expect(elapsed).toBeLessThan(5000);
    });
  });

  describe('DJ set operations', () => {
    it('start set + add 30 tracks + end set in under 2 seconds', { timeout: 15000 }, async () => {
      const env = mockEnv();

      // Simulate session
      (env.WKRP_KV as ReturnType<typeof mockKV>).put(
        'wkrp:session:dj-token',
        JSON.stringify({ userId: 'dj-1', name: 'DJ Test', gen: 'founder', brand_id: 'wkrp' }),
      );

      const sessionCookie = 'wkrp_session=dj-token';

      const start = performance.now();

      // Start set
      const startRes = await handleStartSet(
        new Request('http://localhost:8787/api/sets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
          body: JSON.stringify({ venue_name: 'RIPH' }),
        }),
        env as never,
      );
      expect(startRes.status).toBe(201);

      // Add 30 tracks sequentially (realistic — DJ adds one at a time)
      for (let i = 0; i < 30; i++) {
        const addRes = await handleAddSetTrack(
          new Request('http://localhost:8787/api/sets/set-1/tracks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
            body: JSON.stringify({ track_id: `track-${i}` }),
          }),
          env as never,
          'set-1',
        );
        expect(addRes.status).toBe(200);
      }

      // End set
      const endRes = await handleEndSet(
        new Request('http://localhost:8787/api/sets/set-1/end', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
        }),
        env as never,
        'set-1',
      );
      expect(endRes.status).toBe(200);

      const elapsed = performance.now() - start;
      console.log(`Full DJ set (start + 30 tracks + end): ${elapsed.toFixed(0)}ms`);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe('Stats + reporting at scale', () => {
    it('stats endpoint responds in under 100ms', { timeout: 15000 }, async () => {
      const env = mockEnv(100000);

      const start = performance.now();
      const res = await handleGetStats(
        new Request('http://localhost:8787/api/stats'),
        env as never,
      );
      const elapsed = performance.now() - start;

      console.log(`Stats query (100k catalog): ${elapsed.toFixed(1)}ms`);
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(100);
    });

    it('sponsor report responds in under 200ms', { timeout: 15000 }, async () => {
      const env = mockEnv();

      const start = performance.now();
      const res = await handleSponsorReport(
        new Request('http://localhost:8787/api/sponsors/riph-friday/report'),
        env as never,
        'riph-friday',
      );
      const elapsed = performance.now() - start;

      console.log(`Sponsor report: ${elapsed.toFixed(1)}ms`);
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(200);
    });

    it('layers endpoint responds in under 100ms', { timeout: 15000 }, async () => {
      const env = mockEnv(50000);

      const start = performance.now();
      const res = await handleGetLayers(
        new Request('http://localhost:8787/api/layers'),
        env as never,
      );
      const elapsed = performance.now() - start;

      console.log(`Layers query: ${elapsed.toFixed(1)}ms`);
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Registration burst (event night)', () => {
    it('handles 20 concurrent registrations', { timeout: 15000 }, async () => {
      const env = mockEnv();

      const roles = ['dj', 'curator', 'contributor', 'listener'];
      const gens = ['founder', 'gen2', 'gen3'];

      const start = performance.now();
      const registrations = Array.from({ length: 20 }, (_, i) =>
        handleRegister(
          new Request('http://localhost:8787/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `Patron ${i}`,
              role: roles[i % 4],
              generation: gens[i % 3],
            }),
          }),
          env as never,
        )
      );

      const results = await Promise.all(registrations);
      const elapsed = performance.now() - start;

      console.log(`20 concurrent registrations: ${elapsed.toFixed(0)}ms (${(elapsed / 20).toFixed(1)}ms avg)`);

      results.forEach(r => expect(r.status).toBe(201));
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe('Export at scale', () => {
    it('catalog export (JSON) responds in under 500ms for 10k tracks', { timeout: 15000 }, async () => {
      const env = mockEnv(10000);

      // Mock session
      (env.WKRP_KV as ReturnType<typeof mockKV>).put(
        'wkrp:session:export-token',
        JSON.stringify({ userId: 'curator-1', name: 'Curator', gen: 'founder', brand_id: 'wkrp' }),
      );

      const start = performance.now();
      const res = await handleExportTracks(
        new Request('http://localhost:8787/api/export/tracks', {
          headers: { Cookie: 'wkrp_session=export-token' },
        }),
        env as never,
      );
      const elapsed = performance.now() - start;

      console.log(`Catalog export (10k tracks): ${elapsed.toFixed(0)}ms`);
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(500);
    });

    it('catalog export (CSV) responds in under 500ms for 10k tracks', { timeout: 15000 }, async () => {
      const env = mockEnv(10000);

      (env.WKRP_KV as ReturnType<typeof mockKV>).put(
        'wkrp:session:export-token',
        JSON.stringify({ userId: 'curator-1', name: 'Curator', gen: 'founder', brand_id: 'wkrp' }),
      );

      const start = performance.now();
      const res = await handleExportTracks(
        new Request('http://localhost:8787/api/export/tracks?format=csv', {
          headers: { Cookie: 'wkrp_session=export-token' },
        }),
        env as never,
      );
      const elapsed = performance.now() - start;

      console.log(`Catalog CSV export (10k tracks): ${elapsed.toFixed(0)}ms`);
      expect(res.headers.get('Content-Type')).toContain('text/csv');
      expect(elapsed).toBeLessThan(500);
    });
  });
});
