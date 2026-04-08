/**
 * POST /auth/register
 *
 * Simple registration — create a contributor and session WITHOUT Spotify.
 * This is the CSV-first path: name + role + generation → session cookie → ready to import.
 *
 * Body: { name: string, role: string, generation: string }
 *
 * No third-party auth required. The act of registering is the consent.
 */

import type { Env } from '../types';
import { storeSession } from '../lib/kv-storage';
import { buildSessionCookie } from '../lib/session-cookie';
import { extractBrandId } from '../lib/brand';
import { log } from '../lib/logger';

const VALID_ROLES = ['dj', 'curator', 'contributor', 'listener'];
const VALID_GENERATIONS = ['founder', 'gen2', 'gen3'];

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  let body: { name?: string; role?: string; generation?: string };
  try {
    body = await request.json() as { name?: string; role?: string; generation?: string };
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const name = body.name?.replace(/<[^>]*>/g, '').trim();
  const role = body.role?.trim().toLowerCase();
  const generation = body.generation?.trim().toLowerCase();

  if (!name || name.length < 1 || name.length > 100) {
    return Response.json({ ok: false, error: 'Name is required (1-100 characters)' }, { status: 400 });
  }
  if (!role || !VALID_ROLES.includes(role)) {
    return Response.json({ ok: false, error: `Role must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
  }
  if (!generation || !VALID_GENERATIONS.includes(generation)) {
    return Response.json({ ok: false, error: `Generation must be one of: ${VALID_GENERATIONS.join(', ')}` }, { status: 400 });
  }

  const brandId = extractBrandId(request);
  const contributorId = crypto.randomUUID();

  // Create contributor in D1
  await env.WKRP_DB.prepare(`
    INSERT INTO contributors (id, name, generation, brand_id, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
  `).bind(contributorId, name, generation, brandId, role).run();

  // Also add to contributor_roles table
  await env.WKRP_DB.prepare(`
    INSERT INTO contributor_roles (contributor_id, role, granted_at)
    VALUES (?, ?, datetime('now'))
  `).bind(contributorId, role).run();

  // Create session
  const sessionToken = crypto.randomUUID();
  await storeSession(env.WKRP_KV, sessionToken, {
    userId: contributorId,
    name,
    gen: generation,
    brand_id: brandId,
  });

  const isProduction = env.WORKER_ENV === 'production';

  log('REGISTER_SUCCESS', { id: contributorId, name, role, generation, brand_id: brandId });

  return new Response(JSON.stringify({
    ok: true,
    contributor: { id: contributorId, name, role, generation },
    redirect: role === 'dj' ? '/dashboard' : '/catalog',
  }), {
    status: 201,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildSessionCookie(sessionToken, isProduction),
    },
  });
}
