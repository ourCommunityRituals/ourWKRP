/**
 * Right-to-erasure (OW-83).
 *
 * Honors the identity-choice model: a contributor can sever their durable
 * identity while the catalog's aggregate provenance stays intact. We do NOT
 * delete the contributor row or their contributions — doing so would corrupt
 * the WKRP→OSE provenance chain and every track's "who brought this" lineage.
 * Instead we *tombstone*: null out the PII columns, rename to a non-identifying
 * marker, mark the row departed, and purge the KV identity material (tokens,
 * Last.fm session, sync marker). The opaque contributor UUID survives so
 * contributions still resolve, but it no longer links to a real person.
 *
 * The vanity slug (OW-122) is one of those PII columns: it is user-chosen and
 * usually a person's actual name, and it is the public /c/:slug URL. Clearing
 * it retires that URL and releases the name for reuse — leaving it set would
 * keep a named, shareable link pointing at a tombstoned profile.
 *
 * Session caveat: sessions are KV entries keyed by an unguessable token and are
 * not indexed by contributor, so we cannot enumerate-and-delete them here. They
 * lapse on their own via the absolute/idle TTL (OW-81). Tokens — the sensitive
 * material — are purged immediately.
 */

import type { Env } from '../types';
import { deleteTokens, deleteLastfmSession, deleteLastSync } from './kv-storage';
import { recordAudit } from './audit';

export interface ErasureResult {
  erased: boolean; // false when no contributor row matched the id
}

export async function eraseContributor(
  env: Env,
  request: Request,
  contributorId: string,
): Promise<ErasureResult> {
  // Sever identity in D1 while preserving the row (and thus all FK-linked
  // contributions / provenance). NOT NULL columns get a non-identifying value.
  const res = await env.WKRP_DB.prepare(
    `UPDATE contributors
        SET name = '[erased]',
            spotify_user_id = NULL,
            spotify_display_name = NULL,
            apple_music_id = NULL,
            lastfm_username = NULL,
            slug = NULL,
            status = 'departed'
      WHERE id = ?`,
  )
    .bind(contributorId)
    .run();

  const erased = (res?.meta?.changes ?? 0) > 0;

  if (!erased) {
    await recordAudit(env, request, {
      action: 'privacy.erasure',
      resourceType: 'contributor',
      resourceId: contributorId,
      outcome: 'failure',
      actorId: contributorId,
      meta: { reason: 'no_such_contributor' },
    });
    return { erased: false };
  }

  // Purge KV identity material. Best-effort per key; a missing key is a no-op.
  await deleteTokens(env.WKRP_KV, contributorId);
  await deleteLastfmSession(env.WKRP_KV, contributorId);
  await deleteLastSync(env.WKRP_KV, contributorId);

  await recordAudit(env, request, {
    action: 'privacy.erasure',
    resourceType: 'contributor',
    resourceId: contributorId,
    outcome: 'success',
    actorId: contributorId,
  });

  return { erased: true };
}
