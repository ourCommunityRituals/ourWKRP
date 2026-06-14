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
import { newSessionData } from '../lib/session';
import { buildSessionCookie } from '../lib/session-cookie';
import { extractBrandId } from '../lib/brand';
import { registerBodySchema } from '../lib/schemas';
import { validateBody } from '../lib/validate';
import { log } from '../lib/logger';

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const parsed = await validateBody(request, registerBodySchema);
  if (parsed instanceof Response) return parsed;

  const { name, role, generation } = parsed;

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
  await storeSession(env.WKRP_KV, sessionToken, newSessionData({
    userId: contributorId,
    name,
    gen: generation,
    brand_id: brandId,
  }));

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
