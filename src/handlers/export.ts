/**
 * Catalog Export handlers
 *
 * GET /api/export/tracks          — full catalog as JSON
 * GET /api/export/tracks?format=csv — full catalog as CSV download
 *
 * Auth required: founder or curator only.
 * Brand-scoped: subdomain filters to that brand's tracks.
 */

import type { Env } from '../types';
import { getSession } from '../lib/kv-storage';
import { getSessionToken } from '../lib/session-cookie';
import { extractBrandId } from '../lib/brand';
import { log } from '../lib/logger';

const ALLOWED_EXPORT_ROLES = ['founder', 'curator', 'dj'];

/**
 * GET /api/export/tracks
 * Query params:
 *   format=csv  — download as CSV (default: JSON)
 */
export async function handleExportTracks(request: Request, env: Env): Promise<Response> {
  // Auth check
  const token = getSessionToken(request);
  if (!token) {
    return Response.json({ ok: false, error: 'Authentication required' }, { status: 401 });
  }
  const session = await getSession(env.WKRP_KV, token);
  if (!session) {
    return Response.json({ ok: false, error: 'Session expired' }, { status: 401 });
  }

  // Role check
  const contributor = await env.WKRP_DB.prepare(
    'SELECT id, role FROM contributors WHERE id = ?'
  ).bind(session.userId).first();

  if (!contributor || !ALLOWED_EXPORT_ROLES.includes(contributor.role as string)) {
    return Response.json(
      { ok: false, error: 'Only founders, curators, and DJs can export the catalog' },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'json';
  const brandId = extractBrandId(request);

  log('CATALOG_EXPORT', { format, brand_id: brandId, user: session.userId });

  // Build query — brand scoped via contributions join
  let sql: string;
  let binds: string[];

  if (brandId !== 'wkrp') {
    sql = `
      SELECT DISTINCT t.name, t.artist, t.album, t.genre, t.isrc, t.release_year,
             t.energy, t.danceability, t.valence, t.tempo,
             ct.name as contributor_name, cn.source_platform
      FROM tracks t
      INNER JOIN contributions cn ON t.id = cn.track_id
      INNER JOIN contributors ct ON cn.contributor_id = ct.id
      WHERE ct.brand_id = ? AND t.merged_into_id IS NULL
      ORDER BY t.artist ASC, t.name ASC, t.album ASC, ct.name ASC
    `;
    binds = [brandId];
  } else {
    sql = `
      SELECT DISTINCT t.name, t.artist, t.album, t.genre, t.isrc, t.release_year,
             t.energy, t.danceability, t.valence, t.tempo,
             ct.name as contributor_name, cn.source_platform
      FROM tracks t
      LEFT JOIN contributions cn ON t.id = cn.track_id
      LEFT JOIN contributors ct ON cn.contributor_id = ct.id
      WHERE t.merged_into_id IS NULL
      ORDER BY t.artist ASC, t.name ASC, t.album ASC, ct.name ASC
    `;
    binds = [];
  }

  const result = await env.WKRP_DB.prepare(sql).bind(...binds).all();
  const rows = result.results;

  if (format === 'csv') {
    return buildCsvResponse(rows as Record<string, unknown>[]);
  }

  return Response.json({
    ok: true,
    track_count: rows.length,
    tracks: rows,
    exported_at: new Date().toISOString(),
  });
}

function buildCsvResponse(rows: Record<string, unknown>[]): Response {
  const columns = [
    'name', 'artist', 'album', 'genre', 'isrc', 'release_year',
    'energy', 'danceability', 'valence', 'tempo',
    'contributor_name', 'source_platform',
  ];

  const header = columns.join(',');
  const csvRows = rows.map(row =>
    columns.map(col => csvEscape(row[col])).join(',')
  );

  const csv = [header, ...csvRows].join('\n');
  const timestamp = new Date().toISOString().split('T')[0];

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ourwkrp-catalog-${timestamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
