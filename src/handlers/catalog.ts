/**
 * Catalog API handlers
 *
 * GET /api/tracks       — filtered, searchable, paginated track list
 * GET /api/contributors — all contributors with track counts
 * GET /api/stats        — catalog statistics
 * GET /api/playlists/:contributorId — contributor's playlists
 */

import type { Env } from '../types';
import { extractBrandId } from '../lib/brand';
import { encodeCursor, decodeCursor, parsePaginationParams } from '../lib/cursor';
import { log } from '../lib/logger';

/**
 * GET /api/tracks
 *
 * Query params:
 *   q           — full-text search (FTS5)
 *   genre       — exact genre match
 *   artist      — partial artist match (LIKE)
 *   contributor — contributor ID filter
 *   year_min    — minimum release year
 *   year_max    — maximum release year
 *   energy_min/energy_max       — audio feature range (0-1)
 *   valence_min/valence_max     — audio feature range (0-1)
 *   danceability_min/danceability_max — audio feature range (0-1)
 *   cursor      — pagination cursor
 *   limit       — page size (1-100, default 25)
 */
export async function handleGetTracks(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const brandId = extractBrandId(request);
  const { cursor, limit } = parsePaginationParams(url);

  const q = boundParam(url.searchParams.get('q'));
  const genre = boundParam(url.searchParams.get('genre'));
  const artist = boundParam(url.searchParams.get('artist'));
  const contributorId = boundParam(url.searchParams.get('contributor'));
  const layer = boundParam(url.searchParams.get('layer')); // dj, crew, community, or null (all)
  const yearMin = parseIntParam(url.searchParams.get('year_min'));
  const yearMax = parseIntParam(url.searchParams.get('year_max'));
  const energyMin = parseFloatParam(url.searchParams.get('energy_min'));
  const energyMax = parseFloatParam(url.searchParams.get('energy_max'));
  const valenceMin = parseFloatParam(url.searchParams.get('valence_min'));
  const valenceMax = parseFloatParam(url.searchParams.get('valence_max'));
  const danceabilityMin = parseFloatParam(url.searchParams.get('danceability_min'));
  const danceabilityMax = parseFloatParam(url.searchParams.get('danceability_max'));

  // Build query dynamically
  const conditions: string[] = [];
  const binds: (string | number)[] = [];

  // Full-text search uses a subquery on FTS5
  let fromClause: string;
  if (q && q.trim().length > 0) {
    const sanitized = sanitizeFtsQuery(q);
    fromClause = `tracks t INNER JOIN tracks_fts fts ON t.rowid = fts.rowid`;
    conditions.push('fts.tracks_fts MATCH ?');
    binds.push(sanitized);
  } else {
    fromClause = 'tracks t';
  }

  // Brand scoping: filter by contributions from contributors in this brand
  if (brandId !== 'wkrp') {
    fromClause += ' INNER JOIN contributions c ON t.id = c.track_id INNER JOIN contributors ct ON c.contributor_id = ct.id';
    conditions.push('ct.brand_id = ?');
    binds.push(brandId);
  }

  // Layer filtering: dj (from sets), crew (founders/curators), community (contributors/listeners)
  if (layer === 'dj') {
    // Tracks that appear in DJ sets (via set_tracks table)
    if (!fromClause.includes('set_tracks')) {
      fromClause += ' INNER JOIN set_tracks st ON t.id = st.track_id';
    }
  } else if (layer === 'crew') {
    // Tracks contributed by founders or curators
    if (!fromClause.includes('contributions')) {
      fromClause += ' INNER JOIN contributions c ON t.id = c.track_id INNER JOIN contributors ct ON c.contributor_id = ct.id';
    }
    conditions.push("ct.role IN ('founder', 'curator')");
  } else if (layer === 'community') {
    // Tracks contributed by contributors or listeners (not founders/curators/djs)
    if (!fromClause.includes('contributions')) {
      fromClause += ' INNER JOIN contributions c ON t.id = c.track_id INNER JOIN contributors ct ON c.contributor_id = ct.id';
    }
    conditions.push("ct.role IN ('contributor', 'listener')");
  }

  if (genre) {
    conditions.push('t.genre = ?');
    binds.push(genre);
  }
  if (artist) {
    // Escape LIKE metacharacters so user-supplied % / _ are matched literally
    // (otherwise they alter query semantics and can force full-table scans).
    conditions.push("t.artist LIKE ? ESCAPE '\\'");
    binds.push(`%${escapeLike(artist)}%`);
  }
  if (contributorId) {
    if (brandId === 'wkrp' && !fromClause.includes('contributions')) {
      fromClause += ' INNER JOIN contributions c ON t.id = c.track_id';
    }
    conditions.push('c.contributor_id = ?');
    binds.push(contributorId);
  }
  if (yearMin !== null) {
    conditions.push('t.release_year >= ?');
    binds.push(yearMin);
  }
  if (yearMax !== null) {
    conditions.push('t.release_year <= ?');
    binds.push(yearMax);
  }
  if (energyMin !== null) {
    conditions.push('t.energy >= ?');
    binds.push(energyMin);
  }
  if (energyMax !== null) {
    conditions.push('t.energy <= ?');
    binds.push(energyMax);
  }
  if (valenceMin !== null) {
    conditions.push('t.valence >= ?');
    binds.push(valenceMin);
  }
  if (valenceMax !== null) {
    conditions.push('t.valence <= ?');
    binds.push(valenceMax);
  }
  if (danceabilityMin !== null) {
    conditions.push('t.danceability >= ?');
    binds.push(danceabilityMin);
  }
  if (danceabilityMax !== null) {
    conditions.push('t.danceability <= ?');
    binds.push(danceabilityMax);
  }

  // Exclude merged tracks
  conditions.push('t.merged_into_id IS NULL');

  // Cursor-based pagination
  if (cursor) {
    const cursorData = decodeCursor(cursor);
    if (cursorData) {
      conditions.push('t.id > ?');
      binds.push(cursorData.id);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Fetch limit + 1 to detect has_more
  const fetchLimit = limit + 1;
  binds.push(fetchLimit);

  const sql = `
    SELECT DISTINCT t.id, t.name, t.artist, t.album, t.duration_ms,
           t.image_url, t.energy, t.danceability, t.valence, t.tempo,
           t.genre, t.isrc, t.release_year
    FROM ${fromClause}
    ${whereClause}
    ORDER BY t.id ASC
    LIMIT ?
  `;

  log('CATALOG_QUERY', { conditions: conditions.length, has_search: !!q, brand_id: brandId, limit });

  const result = await env.WKRP_DB.prepare(sql).bind(...binds).all();
  const rows = result.results;

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0
    ? encodeCursor(items[items.length - 1].id as string)
    : null;

  return Response.json({
    ok: true,
    tracks: items,
    cursor: nextCursor,
    has_more: hasMore,
  });
}

/**
 * GET /api/contributors
 */
export async function handleGetContributors(request: Request, env: Env): Promise<Response> {
  const brandId = extractBrandId(request);

  const result = await env.WKRP_DB.prepare(`
    SELECT c.id, c.name, c.generation, c.brand_id, c.role, c.status, c.created_at,
           COUNT(DISTINCT cn.track_id) as track_count
    FROM contributors c
    LEFT JOIN contributions cn ON c.id = cn.contributor_id
    WHERE c.brand_id = ? AND c.status = 'active'
    GROUP BY c.id
    ORDER BY c.name ASC, c.id ASC
  `).bind(brandId).all();

  return Response.json({
    ok: true,
    contributors: result.results,
  });
}

/**
 * GET /api/playlists/:contributorId
 */
export async function handleGetContributorPlaylists(request: Request, env: Env, contributorId: string): Promise<Response> {
  const result = await env.WKRP_DB.prepare(`
    SELECT p.id, p.name, p.description, p.track_count, p.image_url,
           p.is_curated, p.created_at
    FROM playlists p
    WHERE p.contributor_id = ?
    ORDER BY p.created_at DESC, p.id ASC
  `).bind(contributorId).all();

  return Response.json({
    ok: true,
    playlists: result.results,
  });
}

/**
 * GET /api/stats
 */
export async function handleGetStats(request: Request, env: Env): Promise<Response> {
  const brandId = extractBrandId(request);

  try {
  // For default brand, use simple queries without bind params on track counts
  const isDefaultBrand = brandId === 'wkrp';

  // Run queries in a batch for efficiency
  const [tracksResult, contributorsResult, playlistsResult, genresResult, decadesResult, audioFeaturesResult] =
    await env.WKRP_DB.batch([
      isDefaultBrand
        ? env.WKRP_DB.prepare('SELECT COUNT(*) as count FROM tracks WHERE merged_into_id IS NULL')
        : env.WKRP_DB.prepare(
            `SELECT COUNT(DISTINCT t.id) as count FROM tracks t
             INNER JOIN contributions cn ON t.id = cn.track_id
             INNER JOIN contributors ct ON cn.contributor_id = ct.id AND ct.brand_id = ?
             WHERE t.merged_into_id IS NULL`
          ).bind(brandId),
      env.WKRP_DB.prepare(
        "SELECT COUNT(*) as count FROM contributors WHERE brand_id = ? AND status = 'active'"
      ).bind(brandId),
      env.WKRP_DB.prepare(
        'SELECT COUNT(*) as count FROM playlists WHERE brand_id = ?'
      ).bind(brandId),
      isDefaultBrand
        ? env.WKRP_DB.prepare(
            `SELECT genre, COUNT(*) as count FROM tracks
             WHERE genre IS NOT NULL AND merged_into_id IS NULL
             GROUP BY genre ORDER BY count DESC, genre ASC LIMIT 10`)
        : env.WKRP_DB.prepare(
            `SELECT t.genre, COUNT(DISTINCT t.id) as count FROM tracks t
             INNER JOIN contributions cn ON t.id = cn.track_id
             INNER JOIN contributors ct ON cn.contributor_id = ct.id AND ct.brand_id = ?
             WHERE t.genre IS NOT NULL AND t.merged_into_id IS NULL
             GROUP BY t.genre ORDER BY count DESC, t.genre ASC LIMIT 10`
          ).bind(brandId),
      isDefaultBrand
        ? env.WKRP_DB.prepare(
            `SELECT (release_year / 10) * 10 as decade, COUNT(*) as count FROM tracks
             WHERE release_year IS NOT NULL AND merged_into_id IS NULL
             GROUP BY decade ORDER BY decade DESC LIMIT 10`)
        : env.WKRP_DB.prepare(
            `SELECT (t.release_year / 10) * 10 as decade, COUNT(DISTINCT t.id) as count FROM tracks t
             INNER JOIN contributions cn ON t.id = cn.track_id
             INNER JOIN contributors ct ON cn.contributor_id = ct.id AND ct.brand_id = ?
             WHERE t.release_year IS NOT NULL AND t.merged_into_id IS NULL
             GROUP BY decade ORDER BY decade DESC LIMIT 10`
          ).bind(brandId),
      isDefaultBrand
        ? env.WKRP_DB.prepare('SELECT COUNT(*) as count FROM tracks WHERE energy IS NOT NULL')
        : env.WKRP_DB.prepare(
            `SELECT COUNT(DISTINCT t.id) as count FROM tracks t
             INNER JOIN contributions cn ON t.id = cn.track_id
             INNER JOIN contributors ct ON cn.contributor_id = ct.id AND ct.brand_id = ?
             WHERE t.energy IS NOT NULL`
          ).bind(brandId),
    ]);

  const totalTracks = (tracksResult.results[0] as Record<string, unknown>)?.count as number ?? 0;
  const totalContributors = (contributorsResult.results[0] as Record<string, unknown>)?.count as number ?? 0;
  const totalPlaylists = (playlistsResult.results[0] as Record<string, unknown>)?.count as number ?? 0;
  const hasAudioFeatures = ((audioFeaturesResult.results[0] as Record<string, unknown>)?.count as number ?? 0) > 0;

  return Response.json({
    ok: true,
    stats: {
      total_tracks: totalTracks,
      total_contributors: totalContributors,
      total_playlists: totalPlaylists,
      top_genres: genresResult.results,
      top_decades: decadesResult.results,
      has_audio_features: hasAudioFeatures,
    },
  });
  } catch (error) {
    log('STATS_ERROR', { error: String(error), brand_id: brandId });
    return Response.json({ ok: false, error: 'Failed to load stats' }, { status: 500 });
  }
}

/**
 * GET /api/brands
 */
export async function handleGetBrands(_request: Request, env: Env): Promise<Response> {
  const result = await env.WKRP_DB.prepare(`
    SELECT b.id, b.name, b.subdomain, b.primary_color, b.accent_color, b.logo_url,
           COUNT(DISTINCT c.id) as contributor_count,
           (SELECT COUNT(*) FROM contributions cn
            INNER JOIN contributors ct ON cn.contributor_id = ct.id
            WHERE ct.brand_id = b.id) as track_count
    FROM brands b
    LEFT JOIN contributors c ON c.brand_id = b.id AND c.status = 'active'
    GROUP BY b.id
    ORDER BY b.name ASC, b.id ASC
  `).all();

  return Response.json({
    ok: true,
    brands: result.results,
  });
}

/**
 * GET /api/layers
 * Layer counts — how many tracks in each layer.
 */
export async function handleGetLayers(_request: Request, env: Env): Promise<Response> {
  const [djResult, crewResult, communityResult, totalResult] = await env.WKRP_DB.batch([
    env.WKRP_DB.prepare(
      'SELECT COUNT(DISTINCT track_id) as count FROM set_tracks'
    ).bind(),
    env.WKRP_DB.prepare(
      `SELECT COUNT(DISTINCT c.track_id) as count FROM contributions c
       INNER JOIN contributors ct ON c.contributor_id = ct.id
       WHERE ct.role IN ('founder', 'curator')`
    ).bind(),
    env.WKRP_DB.prepare(
      `SELECT COUNT(DISTINCT c.track_id) as count FROM contributions c
       INNER JOIN contributors ct ON c.contributor_id = ct.id
       WHERE ct.role IN ('contributor', 'listener')`
    ).bind(),
    env.WKRP_DB.prepare(
      'SELECT COUNT(*) as count FROM tracks WHERE merged_into_id IS NULL'
    ).bind(),
  ]);

  return Response.json({
    ok: true,
    layers: {
      dj: (djResult.results[0] as Record<string, unknown>)?.count as number ?? 0,
      crew: (crewResult.results[0] as Record<string, unknown>)?.count as number ?? 0,
      community: (communityResult.results[0] as Record<string, unknown>)?.count as number ?? 0,
      all: (totalResult.results[0] as Record<string, unknown>)?.count as number ?? 0,
    },
  });
}

/**
 * GET /api/contributors/:id
 * Full contributor profile with stats, genres, playlists, sources, and brands.
 */
export async function handleGetContributorProfile(_request: Request, env: Env, contributorId: string): Promise<Response> {
  const contributor = await env.WKRP_DB.prepare(
    // `slug` is additive (OW-122): the vanity URL is public, so the profile
    // page can render it. `slug_locked` is deliberately NOT exposed here — it
    // is an owner-only control flag, returned by POST /api/profile/slug.
    'SELECT id, name, generation, role, brand_id, status, slug, created_at FROM contributors WHERE id = ?'
  ).bind(contributorId).first();

  if (!contributor) {
    return Response.json({ ok: false, error: 'Contributor not found' }, { status: 404 });
  }

  const [trackCountResult, playlistCountResult, topGenresResult, sourcesResult, playlistsResult, brandsResult, rolesResult, facetsResult] =
    await env.WKRP_DB.batch([
      env.WKRP_DB.prepare(
        'SELECT COUNT(DISTINCT track_id) as count FROM contributions WHERE contributor_id = ?'
      ).bind(contributorId),
      env.WKRP_DB.prepare(
        'SELECT COUNT(*) as count FROM playlists WHERE contributor_id = ?'
      ).bind(contributorId),
      env.WKRP_DB.prepare(
        `SELECT t.genre, COUNT(DISTINCT t.id) as count FROM contributions cn
         INNER JOIN tracks t ON cn.track_id = t.id
         WHERE cn.contributor_id = ? AND t.genre IS NOT NULL
         GROUP BY t.genre ORDER BY count DESC, t.genre ASC LIMIT 5`
      ).bind(contributorId),
      env.WKRP_DB.prepare(
        'SELECT DISTINCT source_platform FROM contributions WHERE contributor_id = ? ORDER BY source_platform'
      ).bind(contributorId),
      env.WKRP_DB.prepare(
        `SELECT id, name, description, track_count, is_curated, created_at
         FROM playlists WHERE contributor_id = ? ORDER BY created_at DESC, id ASC`
      ).bind(contributorId),
      env.WKRP_DB.prepare(
        `SELECT DISTINCT b.id, b.name, b.subdomain,
                COUNT(DISTINCT cn.track_id) as track_count
         FROM contributions cn
         INNER JOIN contributors ct ON cn.contributor_id = ct.id
         INNER JOIN brands b ON ct.brand_id = b.id
         WHERE cn.contributor_id = ?
         GROUP BY b.id ORDER BY track_count DESC, b.id ASC`
      ).bind(contributorId),
      env.WKRP_DB.prepare(
        'SELECT role, granted_at FROM contributor_roles WHERE contributor_id = ? ORDER BY granted_at ASC, role ASC'
      ).bind(contributorId),
      env.WKRP_DB.prepare(
        'SELECT id, domain, depth, created_at FROM flag_facets WHERE contributor_id = ? ORDER BY created_at ASC, domain ASC, id ASC'
      ).bind(contributorId),
    ]);

  const trackCount = (trackCountResult.results[0] as Record<string, unknown>)?.count as number ?? 0;
  const playlistCount = (playlistCountResult.results[0] as Record<string, unknown>)?.count as number ?? 0;

  // Merge primary role with any additional roles from contributor_roles table
  const additionalRoles = (rolesResult.results as Array<Record<string, unknown>>).map(r => r.role as string);
  const allRoles = [...new Set([contributor.role as string, ...additionalRoles])];

  return Response.json({
    ok: true,
    contributor,
    roles: allRoles,
    track_count: trackCount,
    playlist_count: playlistCount,
    top_genres: topGenresResult.results,
    contribution_sources: (sourcesResult.results as Array<Record<string, unknown>>).map(r => r.source_platform),
    playlists: playlistsResult.results,
    brands: brandsResult.results,
    // Self-declared (domain, depth) facets — additive self-description (OW-121).
    facets: facetsResult.results,
  });
}

/**
 * GET /api/contributors/:id/brands
 * Cross-brand contributor discovery — which brands has this contributor contributed to?
 */
export async function handleGetContributorBrands(_request: Request, env: Env, contributorId: string): Promise<Response> {
  const result = await env.WKRP_DB.prepare(`
    SELECT DISTINCT b.id, b.name, b.subdomain, b.primary_color, b.accent_color, b.logo_url,
           COUNT(DISTINCT cn.track_id) as track_count
    FROM contributions cn
    INNER JOIN contributors ct ON cn.contributor_id = ct.id
    INNER JOIN brands b ON ct.brand_id = b.id
    WHERE cn.contributor_id = ?
    GROUP BY b.id
    ORDER BY track_count DESC, b.id ASC
  `).bind(contributorId).all();

  return Response.json({
    ok: true,
    contributor_id: contributorId,
    brands: result.results,
  });
}

// --- Helpers ---

export const MAX_PARAM_LENGTH = 200;
export const MAX_FTS_WORDS = 32;

/** Trim and length-bound a free-text query param; empty/oversized -> null. */
export function boundParam(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_PARAM_LENGTH);
}

/** Escape SQL LIKE metacharacters (\ % _) for use with ESCAPE '\'. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function parseIntParam(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

export function parseFloatParam(value: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : Math.max(0, Math.min(1, n));
}

/**
 * Sanitize FTS5 query to prevent injection.
 * FTS5 has its own query syntax — strip dangerous operators.
 */
export function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 special characters that could cause syntax errors
  const cleaned = query.replace(/[*"():^{}[\]\\]/g, ' ').trim();
  // Split into words and join with implicit AND
  // Cap word count so a fuzzed query can't expand into thousands of MATCH terms.
  const words = cleaned.split(/\s+/).filter(w => w.length > 0).slice(0, MAX_FTS_WORDS);
  if (words.length === 0) return '""';
  // Quote each word to prevent operator interpretation
  return words.map(w => `"${w}"`).join(' ');
}
