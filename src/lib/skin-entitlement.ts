/**
 * Custom looks are a paid add-on (owner, 2026-11-25).
 *
 * The standard skin is the base: free, and it always works. Any other skin,
 * ready-made or custom, needs the add-on. There is no billing yet, only a
 * flag (migration 0016), on when either:
 *   - the person's brand has it (brands.custom_skins = 1), for a venue or
 *     community instance that bought it for everyone on it; or
 *   - an admin granted it to the person (contributors.custom_skins_since),
 *     through POST /admin/skins/grant.
 *
 * Taking the add-on away never breaks a page: the page shows the standard
 * skin again (handlers/profile.ts readProfileLayout).
 */

import type { Env } from '../types';

export const BASE_SKIN = 'standard';

export const ADD_ON_MESSAGE = 'Custom looks are an add-on. Ask us to turn them on.';

export interface EntitlementRow {
  custom_skins_since: string | null;
  brand_custom_skins: number | null;
}

const ENTITLEMENT_SELECT =
  'c.custom_skins_since AS custom_skins_since, b.custom_skins AS brand_custom_skins';

function entitledFrom(row: Partial<EntitlementRow> | null | undefined): boolean {
  if (!row) return false;
  return Boolean(row.custom_skins_since) || row.brand_custom_skins === 1;
}

export async function hasCustomSkins(env: Env, contributorId: string): Promise<boolean> {
  const row = await env.WKRP_DB.prepare(
    `SELECT ${ENTITLEMENT_SELECT} FROM contributors c LEFT JOIN brands b ON b.id = c.brand_id WHERE c.id = ?`,
  ).bind(contributorId).first<EntitlementRow>();
  return entitledFrom(row);
}
