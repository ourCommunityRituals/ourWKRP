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

import { route } from '../../src/router';
import type { Env } from '../../src/types';

const mockEnv = {} as Env;

function makeRequest(path: string, method = 'GET'): Request {
  return new Request(`http://localhost${path}`, { method });
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
    const res = await route(makeRequest('/health', 'OPTIONS'), mockEnv);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('adds CORS headers to all responses', async () => {
    const res = await route(makeRequest('/health'), mockEnv);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});
