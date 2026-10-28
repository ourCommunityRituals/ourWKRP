/**
 * Zod schemas for all API request/response types
 *
 * WKRP-9 Reliability: typed validation at every boundary.
 * Every schema produces actionable error messages with field paths.
 */

import { z } from 'zod';
import { SLUG_RE, SLUG_MAX_LENGTH, SLUG_MIN_LENGTH, isReservedSlug } from './slug';
import { SAFE_ID_RE } from './ids';

// --- Shared primitives ---

// Strip HTML tags to a fixpoint. A single pass over a multi-character pattern
// can leave a recombined tag behind (CodeQL js/incomplete-multi-character-
// sanitization), so repeat until the string stops changing — each pass only
// removes characters, so this terminates. Escaping at render remains the real
// XSS boundary; this keeps stored labels clean.
const stripHtmlTags = (s: string): string => {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, '');
  } while (s !== prev);
  return s;
};

export const uuidSchema = z.string().uuid('Must be a valid UUID');
export const nameSchema = z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less').transform(s => stripHtmlTags(s).trim());
export const roleSchema = z.enum(['dj', 'curator', 'contributor', 'listener'], { message: 'Role must be: dj, curator, contributor, or listener' });
// Sign-up may only self-assign unprivileged roles. dj/curator are privileged
// (they pass server-side authz gates) and are conferred out-of-band — see
// lib/roles.ts grantPrivilegedRole. F1 auth hardening 2026-09-12.
export const selfAssignableRoleSchema = z.enum(['contributor', 'listener'], {
  message: 'Sign-up role must be contributor or listener; dj and curator are granted separately',
});
export const generationSchema = z.enum(['founder', 'gen2', 'gen3'], { message: 'Generation must be: founder, gen2, or gen3' });
export const brandIdSchema = z.string().regex(/^[a-z0-9-]+$/, 'Brand ID must be lowercase alphanumeric with hyphens');

// Vanity profile slug (OW-122). Length is checked before shape so an
// over-length input reports "too long" rather than the opaque pattern message.
// No lowercase-folding transform: an uppercase slug is rejected, not silently
// rewritten, so a claimed slug has exactly one spelling.
export const slugSchema = z.string()
  .min(SLUG_MIN_LENGTH, `Slug must be at least ${SLUG_MIN_LENGTH} characters`)
  .max(SLUG_MAX_LENGTH, `Slug must be ${SLUG_MAX_LENGTH} characters or less`)
  .regex(SLUG_RE, 'Slug must be lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen')
  .refine((s) => !isReservedSlug(s), 'That name is reserved');

// Spotify URI: spotify:track:{22-char base62 ID}
export const spotifyTrackUriSchema = z.string().regex(
  /^spotify:track:[a-zA-Z0-9]{22}$/,
  'Must be a valid Spotify track URI (spotify:track:{id})',
);

export const spotifyTrackIdSchema = z.string().regex(
  /^[a-zA-Z0-9]{22}$/,
  'Must be a valid Spotify track ID (22 alphanumeric characters)',
);

// --- Auth ---

// Role + generation default so the simplest sign-up is just a name. Sign-up may
// only self-assign an unprivileged role (F1); dj/curator are granted via
// POST /admin/roles/grant (grantRoleBodySchema below).
export const registerBodySchema = z.object({
  name: nameSchema,
  role: selfAssignableRoleSchema.default('contributor'),
  generation: generationSchema.default('founder'),
});

// Admin grant of a privileged role (F1). Only dj/curator are grantable here —
// self-assignable roles are the register default and need no grant.
export const grantRoleBodySchema = z.object({
  contributorId: uuidSchema,
  role: z.enum(['dj', 'curator'], { message: 'Grantable role must be dj or curator' }),
});

// --- Playlists ---

export const createPlaylistBodySchema = z.object({
  name: z.string().min(1, 'Playlist name is required').max(200, 'Playlist name must be 200 characters or less').transform(s => s.trim()),
  description: z.string().max(1000, 'Description must be 1000 characters or less').transform(s => s.trim()).nullable().optional(),
});

export const playlistTracksBodySchema = z.object({
  track_ids: z.array(z.string().min(1, 'Track ID cannot be empty'))
    .min(1, 'At least one track_id is required')
    .max(100, 'Maximum 100 tracks per request'),
});

// --- Portfolio (preferred playlists) ---

export const addPortfolioBodySchema = z.object({
  url: z.string().min(1, 'A playlist URL is required').max(500, 'URL must be 500 characters or less'),
  title: z.string().max(200, 'Title must be 200 characters or less').transform(s => s.trim()).nullable().optional(),
});

// --- Profile (vanity slug) ---

export const claimSlugBodySchema = z.object({
  slug: slugSchema,
});

// --- Flag Facets (declared domains + depth) ---

// The four depth tiers a contributor can declare for a domain. Mirrors the
// enum-with-message shape of roleSchema/generationSchema.
export const facetDepthSchema = z.enum(['lifelong', 'hobbyist', 'dabbler', 'newcomer'], {
  message: 'Depth must be: lifelong, hobbyist, dabbler, or newcomer',
});

// A domain is a short free-text label (e.g. "bocce"). Strip HTML + trim like
// nameSchema, then reject anything that trims away to empty — the domain is the
// identity half of the (contributor, domain) uniqueness key, so it must be real.
export const facetDomainSchema = z
  .string()
  .min(1, 'A domain is required')
  .max(64, 'Domain must be 64 characters or less')
  .transform((s) => stripHtmlTags(s).trim())
  .refine((s) => s.length > 0, 'A domain is required');

export const facetBodySchema = z.object({
  domain: facetDomainSchema,
  depth: facetDepthSchema,
});

// OSE event id (lib/ids.ts). Stored next to named listener and DJ ids and shown
// later in per-event aggregates and the music seam, so a value that is present
// must have the shape; null and omitted stay allowed.
export const eventIdSchema = z.string().regex(SAFE_ID_RE, 'Invalid event id');

// --- DJ Sets ---

export const startSetBodySchema = z.object({
  venue_name: z.string().max(200).trim().nullable().optional(),
  event_id: eventIdSchema.nullable().optional(),
});

export const addSetTrackBodySchema = z.object({
  track_id: z.string().min(1, 'track_id is required'),
});

// --- Attributions ---

export const createAttributionBodySchema = z.object({
  dj_id: z.string().min(1, 'dj_id is required'),
  track_id: z.string().min(1, 'track_id is required'),
  event_id: eventIdSchema.nullable().optional(),
});

// --- Catalog Query ---

export const catalogQuerySchema = z.object({
  q: z.string().max(500).optional(),
  genre: z.string().max(100).optional(),
  artist: z.string().max(200).optional(),
  contributor: z.string().optional(),
  year_min: z.coerce.number().int().min(1900).max(2100).optional(),
  year_max: z.coerce.number().int().min(1900).max(2100).optional(),
  energy_min: z.coerce.number().min(0).max(1).optional(),
  energy_max: z.coerce.number().min(0).max(1).optional(),
  valence_min: z.coerce.number().min(0).max(1).optional(),
  valence_max: z.coerce.number().min(0).max(1).optional(),
  danceability_min: z.coerce.number().min(0).max(1).optional(),
  danceability_max: z.coerce.number().min(0).max(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25).optional(),
});

// --- Import ---

export const importSourceTypeSchema = z.enum([
  'liked', 'saved_album', 'created_playlist', 'curated_submission',
  'lastfm_history', 'apple_library', 'manual',
], { message: 'Invalid source_type' });

// --- Response shapes ---

export const apiErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  field_errors: z.record(z.string(), z.array(z.string())).optional(),
});

export const apiSuccessResponseSchema = z.object({
  ok: z.literal(true),
});
