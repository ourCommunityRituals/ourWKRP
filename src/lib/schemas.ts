/**
 * Zod schemas for all API request/response types
 *
 * WKRP-9 Reliability: typed validation at every boundary.
 * Every schema produces actionable error messages with field paths.
 */

import { z } from 'zod';

// --- Shared primitives ---

export const uuidSchema = z.string().uuid('Must be a valid UUID');
export const nameSchema = z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less').transform(s => s.replace(/<[^>]*>/g, '').trim());
export const roleSchema = z.enum(['dj', 'curator', 'contributor', 'listener'], { message: 'Role must be: dj, curator, contributor, or listener' });
export const generationSchema = z.enum(['founder', 'gen2', 'gen3'], { message: 'Generation must be: founder, gen2, or gen3' });
export const brandIdSchema = z.string().regex(/^[a-z0-9-]+$/, 'Brand ID must be lowercase alphanumeric with hyphens');

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

// Role + generation default so the simplest sign-up is just a name.
// Callers (e.g. DJ-specific onboarding) can still pass explicit values.
export const registerBodySchema = z.object({
  name: nameSchema,
  role: roleSchema.default('contributor'),
  generation: generationSchema.default('founder'),
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

// --- DJ Sets ---

export const startSetBodySchema = z.object({
  venue_name: z.string().max(200).trim().nullable().optional(),
  event_id: z.string().max(200).nullable().optional(),
});

export const addSetTrackBodySchema = z.object({
  track_id: z.string().min(1, 'track_id is required'),
});

// --- Attributions ---

export const createAttributionBodySchema = z.object({
  dj_id: z.string().min(1, 'dj_id is required'),
  track_id: z.string().min(1, 'track_id is required'),
  event_id: z.string().nullable().optional(),
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
