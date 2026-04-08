/**
 * Unit tests — Router
 * Verifies correct handler dispatch for all routes
 */
import { describe, it, expect, vi } from 'vitest';

// Mock all handlers before importing router
vi.mock('../../src/handlers/health', () => ({
  handleHealth: vi.fn(() => Response.json({ ok: true, service: 'health' })),
}));
vi.mock('../../src/handlers/auth-start', () => ({
  handleAuthStart: vi.fn(() => Response.json({ ok: true, service: 'auth-start' })),
}));
vi.mock('../../src/handlers/auth-callback', () => ({
  handleAuthCallback: vi.fn(() => Response.json({ ok: true, service: 'auth-callback' })),
}));
vi.mock('../../src/handlers/auth-session', () => ({
  handleAuthSession: vi.fn(() => Response.json({ ok: true, service: 'auth-session' })),
}));
vi.mock('../../src/handlers/sync', () => ({
  handleSync: vi.fn(() => Response.json({ ok: true, service: 'sync' })),
}));
vi.mock('../../src/handlers/pages', () => ({
  handlePages: vi.fn(() => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })),
}));
vi.mock('../../src/handlers/catalog', () => ({
  handleGetTracks: vi.fn(() => Response.json({ ok: true, service: 'catalog-tracks' })),
  handleGetContributors: vi.fn(() => Response.json({ ok: true, service: 'catalog-contributors' })),
  handleGetContributorPlaylists: vi.fn(() => Response.json({ ok: true, service: 'catalog-playlists' })),
  handleGetStats: vi.fn(() => Response.json({ ok: true, service: 'catalog-stats' })),
  handleGetBrands: vi.fn(() => Response.json({ ok: true, service: 'catalog-brands' })),
  handleGetContributorBrands: vi.fn(() => Response.json({ ok: true, service: 'catalog-contributor-brands' })),
}));
vi.mock('../../src/handlers/playlist', () => ({
  handleCreatePlaylist: vi.fn(() => Response.json({ ok: true, service: 'playlist-create' })),
  handleGetPlaylist: vi.fn(() => Response.json({ ok: true, service: 'playlist-get' })),
  handleAddPlaylistTracks: vi.fn(() => Response.json({ ok: true, service: 'playlist-add-tracks' })),
  handleRemovePlaylistTracks: vi.fn(() => Response.json({ ok: true, service: 'playlist-remove-tracks' })),
  handleExportPlaylist: vi.fn(() => Response.json({ ok: true, service: 'playlist-export' })),
}));
vi.mock('../../src/handlers/lastfm', () => ({
  handleLastfmAuthStart: vi.fn(() => Response.json({ ok: true, service: 'lastfm-auth-start' })),
  handleLastfmAuthCallback: vi.fn(() => Response.json({ ok: true, service: 'lastfm-auth-callback' })),
  handleLastfmSync: vi.fn(() => Response.json({ ok: true, service: 'lastfm-sync' })),
  handleLastfmStatus: vi.fn(() => Response.json({ ok: true, service: 'lastfm-status' })),
}));

import { route } from '../../src/router';
import type { Env } from '../../src/types';

const mockEnv: Env = {
  WKRP_KV: {} as KVNamespace,
  WKRP_DB: {} as D1Database,
  WORKER_ENV: 'staging',
  WORKER_VERSION: '0.1.0',
  SPOTIFY_CLIENT_ID: 'test-client-id',
  SPOTIFY_REDIRECT_URI: 'http://localhost:8787/auth/callback',
  APP_URL: 'http://localhost:8787',
  LASTFM_API_KEY: 'test-lastfm-key',
  LASTFM_SHARED_SECRET: 'test-lastfm-secret',
};

function makeRequest(path: string, method = 'GET', origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin) headers['Origin'] = origin;
  return new Request(`http://localhost:8787${path}`, { method, headers });
}

describe('Router', () => {
  it('routes GET /health to health handler', async () => {
    const res = await route(makeRequest('/health'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('health');
  });

  it('routes GET /auth/start to auth-start handler', async () => {
    const res = await route(makeRequest('/auth/start?name=Matt&gen=founder'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('auth-start');
  });

  it('routes GET /auth/callback to auth-callback handler', async () => {
    const res = await route(makeRequest('/auth/callback?code=abc&state=xyz'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('auth-callback');
  });

  it('routes GET /auth/session/:token to auth-session handler', async () => {
    const res = await route(makeRequest('/auth/session/abc123'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('auth-session');
  });

  it('routes POST /spotify/sync/:userId to sync handler', async () => {
    const res = await route(makeRequest('/spotify/sync/user123', 'POST'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('sync');
  });

  it('routes GET / to pages handler', async () => {
    const res = await route(makeRequest('/'), mockEnv);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('routes GET /catalog to pages handler', async () => {
    const res = await route(makeRequest('/catalog'), mockEnv);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('routes GET /create to pages handler', async () => {
    const res = await route(makeRequest('/create'), mockEnv);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await route(makeRequest('/unknown'), mockEnv);
    expect(res.status).toBe(404);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('handles OPTIONS (CORS preflight) with 204', async () => {
    const res = await route(makeRequest('/health', 'OPTIONS', 'http://localhost:8787'), mockEnv);
    expect(res.status).toBe(204);
  });

  it('adds CORS headers for allowed origins', async () => {
    const res = await route(makeRequest('/health', 'GET', 'http://localhost:8787'), mockEnv);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8787');
  });

  it('does NOT add CORS headers for unknown origins', async () => {
    const res = await route(makeRequest('/health', 'GET', 'https://evil.com'), mockEnv);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds security headers to all responses', async () => {
    const res = await route(makeRequest('/health'), mockEnv);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  // --- Catalog API routes ---
  it('routes GET /api/tracks to catalog handler', async () => {
    const res = await route(makeRequest('/api/tracks'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('catalog-tracks');
  });

  it('routes GET /api/contributors to catalog handler', async () => {
    const res = await route(makeRequest('/api/contributors'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('catalog-contributors');
  });

  it('routes GET /api/contributors/:id/brands to contributor brands handler', async () => {
    const res = await route(makeRequest('/api/contributors/12345678-1234-1234-1234-123456789012/brands'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('catalog-contributor-brands');
  });

  it('rejects GET /api/contributors/:id/brands with invalid UUID', async () => {
    const res = await route(makeRequest('/api/contributors/not-a-uuid/brands'), mockEnv);
    expect(res.status).toBe(400);
  });

  it('routes GET /api/stats to catalog handler', async () => {
    const res = await route(makeRequest('/api/stats'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('catalog-stats');
  });

  it('routes GET /api/brands to catalog handler', async () => {
    const res = await route(makeRequest('/api/brands'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('catalog-brands');
  });

  // --- Playlist routes ---
  it('routes POST /api/playlists to playlist create handler', async () => {
    const res = await route(makeRequest('/api/playlists', 'POST'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('playlist-create');
  });

  it('routes GET /api/playlists/:id to playlist get handler', async () => {
    const res = await route(makeRequest('/api/playlists/12345678-1234-1234-1234-123456789012'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('playlist-get');
  });

  it('routes POST /api/playlists/:id/tracks to add tracks handler', async () => {
    const res = await route(makeRequest('/api/playlists/12345678-1234-1234-1234-123456789012/tracks', 'POST'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('playlist-add-tracks');
  });

  it('routes DELETE /api/playlists/:id/tracks to remove tracks handler', async () => {
    const res = await route(makeRequest('/api/playlists/12345678-1234-1234-1234-123456789012/tracks', 'DELETE'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('playlist-remove-tracks');
  });

  it('routes GET /api/playlists/:id/export to export handler', async () => {
    const res = await route(makeRequest('/api/playlists/12345678-1234-1234-1234-123456789012/export'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('playlist-export');
  });

  // --- Last.fm routes ---
  it('routes GET /auth/lastfm/start to lastfm auth handler', async () => {
    const res = await route(makeRequest('/auth/lastfm/start'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('lastfm-auth-start');
  });

  it('routes GET /auth/lastfm/callback to lastfm callback handler', async () => {
    const res = await route(makeRequest('/auth/lastfm/callback?token=abc'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('lastfm-auth-callback');
  });

  it('routes POST /lastfm/sync/:userId to lastfm sync handler', async () => {
    const res = await route(makeRequest('/lastfm/sync/user123', 'POST'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('lastfm-sync');
  });

  it('routes GET /lastfm/status/:userId to lastfm status handler', async () => {
    const res = await route(makeRequest('/lastfm/status/user123'), mockEnv);
    const body = await res.json() as { service: string };
    expect(body.service).toBe('lastfm-status');
  });
});
