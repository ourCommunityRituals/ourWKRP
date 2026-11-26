/**
 * Linked music accounts (two-account playlist sync, story 1).
 *
 * A contributor can link more than one music account. The `source` account is
 * the one they edit in; ourWKRP pulls from it. A `mirror` account receives
 * copies that ourWKRP writes. Schema: migrations/0013_linked_accounts.sql.
 *
 * Token homes:
 *   source  -> wkrp:tokens:<contributor id>        (unchanged, so every
 *              existing caller and every existing user keeps working)
 *   mirror  -> wkrp:tokens:la:<linked account id>
 * Both are sealed with the same key as today (lib/crypto.ts).
 */

import type { Env, StoredTokens } from '../types';
import { sealJSON, openAndUpgrade } from './crypto';
import { log } from './logger';

export type LinkedPlatform = 'spotify' | 'apple_music';
export type LinkedRole = 'source' | 'mirror';

export interface LinkedAccount {
  id: string;
  contributor_id: string;
  platform: LinkedPlatform;
  platform_user_id: string;
  role: LinkedRole;
  status: 'active' | 'needs_reconnect';
  display_name: string | null;
}

export type EnsureSourceResult =
  | { ok: true; account: LinkedAccount }
  | { ok: false; reason: 'linked_elsewhere' | 'other_source' };

/** Where a linked account's tokens live in KV. */
export function tokenKeyFor(account: Pick<LinkedAccount, 'id' | 'contributor_id' | 'role'>): string {
  return account.role === 'source'
    ? `wkrp:tokens:${account.contributor_id}`
    : `wkrp:tokens:la:${account.id}`;
}

export async function listLinkedAccounts(env: Env, contributorId: string): Promise<LinkedAccount[]> {
  const res = await env.WKRP_DB.prepare(
    `SELECT id, contributor_id, platform, platform_user_id, role, status, display_name
       FROM linked_accounts WHERE contributor_id = ? ORDER BY role DESC, created_at ASC, id ASC`,
  ).bind(contributorId).all<LinkedAccount>();
  return res.results ?? [];
}

async function findByPlatformUser(
  env: Env,
  platform: LinkedPlatform,
  platformUserId: string,
): Promise<LinkedAccount | null> {
  return env.WKRP_DB.prepare(
    `SELECT id, contributor_id, platform, platform_user_id, role, status, display_name
       FROM linked_accounts WHERE platform = ? AND platform_user_id = ?`,
  ).bind(platform, platformUserId).first<LinkedAccount>();
}

/**
 * Make sure a contributor who signed in with Spotify has that account as
 * their source. Never moves an account from one contributor to another, and
 * never replaces a different source account (that is the swap, story 6).
 */
export async function ensureSourceAccount(
  env: Env,
  contributorId: string,
  platform: LinkedPlatform,
  platformUserId: string,
  displayName: string | null,
): Promise<EnsureSourceResult> {
  const existing = await findByPlatformUser(env, platform, platformUserId);
  if (existing) {
    if (existing.contributor_id !== contributorId) {
      log('LINKED_ACCOUNT_CONFLICT', { contributorId, platform, reason: 'linked_elsewhere' });
      return { ok: false, reason: 'linked_elsewhere' };
    }
    return { ok: true, account: existing };
  }

  const id = crypto.randomUUID().replace(/-/g, '');
  try {
    await env.WKRP_DB.prepare(
      `INSERT INTO linked_accounts (id, contributor_id, platform, platform_user_id, role, display_name)
       VALUES (?, ?, ?, ?, 'source', ?)`,
    ).bind(id, contributorId, platform, platformUserId, displayName).run();
  } catch (err) {
    // The unique indexes are the authority; a refused insert means the
    // contributor already has a different source, or a race linked it elsewhere.
    const again = await findByPlatformUser(env, platform, platformUserId);
    if (again && again.contributor_id !== contributorId) return { ok: false, reason: 'linked_elsewhere' };
    log('LINKED_ACCOUNT_CONFLICT', { contributorId, platform, reason: 'other_source', error: String(err) });
    return { ok: false, reason: 'other_source' };
  }
  log('LINKED_ACCOUNT_SOURCE_CREATED', { contributorId, platform, id });
  return {
    ok: true,
    account: {
      id, contributor_id: contributorId, platform, platform_user_id: platformUserId,
      role: 'source', status: 'active', display_name: displayName,
    },
  };
}

export async function storeAccountTokens(env: Env, account: LinkedAccount, tokens: StoredTokens): Promise<void> {
  await env.WKRP_KV.put(tokenKeyFor(account), await sealJSON(tokens, env.WKRP_ENCRYPTION_KEY));
}

export async function getAccountTokens(env: Env, account: LinkedAccount): Promise<StoredTokens | null> {
  return openAndUpgrade<StoredTokens>(env.WKRP_KV, tokenKeyFor(account), env.WKRP_ENCRYPTION_KEY);
}

/**
 * Right to erasure: drop every linked account and the mirrors' tokens. The
 * source account's tokens sit at the contributor key, which erasure already
 * deletes.
 */
export async function eraseLinkedAccounts(env: Env, contributorId: string): Promise<number> {
  const accounts = await listLinkedAccounts(env, contributorId);
  for (const account of accounts) {
    if (account.role === 'mirror') await env.WKRP_KV.delete(tokenKeyFor(account));
  }
  await env.WKRP_DB.prepare('DELETE FROM linked_accounts WHERE contributor_id = ?').bind(contributorId).run();
  return accounts.length;
}
