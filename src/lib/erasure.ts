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
 * Sessions are revoked immediately: they are keyed by an unguessable token, but
 * a per-contributor session index (F3 auth hardening 2026-09-12) lets us
 * enumerate and delete every live session here rather than waiting out the
 * absolute/idle TTL (OW-81). Tokens — the sensitive material — are purged too.
 *
 * A live DJ set ends with the erasure (OW-219). Once the sessions are revoked
 * nobody can end the set, so it would otherwise stay live on /dj/:id/live under
 * the tombstoned name for good. Erasure ends every live set of the erased
 * person and closes each one's open playback event, in one D1 batch with the
 * playback close first (the same two statements POST /api/sets uses to end a
 * DJ's previous live set). Rows are kept, as with every other contribution:
 * nothing is deleted from dj_sets, set_tracks or playback_events; only a live
 * set's is_live / ended_at and its open event's ended_at change. Sets already
 * ended, and every other DJ's sets, are left as they were.
 */

import type { Env } from '../types';
import { deleteTokens, deleteLastfmSession, deleteLastSync, deleteAllSessions } from './kv-storage';
import { recordAudit } from './audit';
import { eraseLinkedAccounts } from './linked-accounts';

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

  // End the erased person's live sets (header comment). Playback first, while
  // the set still reads as live; both in one batch so neither lands alone.
  const [, setsEnded] = await env.WKRP_DB.batch([
    env.WKRP_DB.prepare(
      `UPDATE playback_events SET ended_at = datetime('now')
        WHERE ended_at IS NULL
          AND set_id IN (SELECT id FROM dj_sets WHERE dj_id = ? AND is_live = 1)`,
    ).bind(contributorId),
    env.WKRP_DB.prepare(
      "UPDATE dj_sets SET is_live = 0, ended_at = datetime('now') WHERE dj_id = ? AND is_live = 1",
    ).bind(contributorId),
  ]);
  const liveSetsEnded = setsEnded.meta.changes;

  // Self-declared facets are personal descriptors, not shared provenance — a
  // person's declared "(domain, depth)" pairs are theirs alone and carry no
  // catalog lineage, so they are hard-deleted on erasure (unlike contributions,
  // which are tombstoned to preserve every track's "who brought this" chain).
  await env.WKRP_DB.prepare('DELETE FROM flag_facets WHERE contributor_id = ?')
    .bind(contributorId)
    .run();

  // Purge KV identity material. Best-effort per key; a missing key is a no-op.
  await deleteTokens(env.WKRP_KV, contributorId);
  await eraseLinkedAccounts(env, contributorId);
  await deleteLastfmSession(env.WKRP_KV, contributorId);
  await deleteLastSync(env.WKRP_KV, contributorId);

  // Revoke all live sessions so an erased contributor cannot stay logged in.
  const sessionsRevoked = await deleteAllSessions(env.WKRP_KV, contributorId);

  await recordAudit(env, request, {
    action: 'privacy.erasure',
    resourceType: 'contributor',
    resourceId: contributorId,
    outcome: 'success',
    actorId: contributorId,
    meta: { sessions_revoked: sessionsRevoked, live_sets_ended: liveSetsEnded },
  });

  return { erased: true };
}
