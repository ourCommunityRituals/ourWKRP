/**
 * CSV import engine — orchestrates parse → dedup → batched write.
 *
 * Handles Exportify (Spotify), Last.fm, and Apple Music CSV formats.
 * Deduplicates tracks via ISRC > platform ID > canonical title+artist.
 * Records provenance (who brought what, how, from where).
 *
 * Budget note: a naive per-row resolver issued 3–6 sequential D1 subrequests
 * per track, so a realistic library (thousands of rows) blew past Cloudflare's
 * ~1000-subrequest-per-invocation limit and failed mid-import. This engine is
 * set-based: it bulk-loads existing matches with chunked IN lookups, resolves
 * everything in memory (including in-file duplicates), then writes through
 * db.batch() in fixed-size groups. Cost is ~1 subrequest per ~10 rows, which
 * keeps the budget-derived row cap (see MAX_ROWS in csv-parser) comfortable.
 */

import type { Env, ImportResult, NormalizedTrackData, SourceType } from '../types';
import { parseCsv, MAX_ROWS } from './csv-parser';
import { normalizeTitle, normalizeArtist, extractReleaseYear } from '../lib/normalize';
import { log, logError } from '../lib/logger';

/** Single-column IN lookups — kept under D1's 100-bound-parameter cap. */
const LOOKUP_CHUNK = 90;
/** (title, artist) OR-group lookups bind 2 params each. */
const PAIR_CHUNK = 45;
/** Statements per db.batch() round-trip — one subrequest regardless of size. */
const WRITE_BATCH = 50;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const platformKey = (platform: string, platformId: string) => `${platform}|||${platformId}`;

/**
 * Import a CSV file for a contributor: parse, deduplicate, and record
 * contributions with full provenance.
 */
export async function importCsv(
  env: Env,
  contributorId: string,
  csvContent: string,
  sourceType?: SourceType,
  sourceName?: string,
): Promise<ImportResult> {
  const start = Date.now();
  const result: ImportResult = {
    tracks_new: 0,
    tracks_matched: 0,
    contributions_created: 0,
    contributions_skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  log('IMPORT_START', { contributorId, sourceType, sourceName });

  const { format, tracks, truncated } = parseCsv(csvContent, sourceType, sourceName);

  if (truncated) {
    result.errors.push(`File exceeded the ${MAX_ROWS.toLocaleString()}-row import limit; only the first ${MAX_ROWS.toLocaleString()} rows were processed.`);
  }

  if (format === 'unknown') {
    result.errors.push('Unrecognized CSV format. Supported: Exportify, Last.fm, Apple Music.');
    result.duration_ms = Date.now() - start;
    return result;
  }

  if (tracks.length === 0) {
    result.errors.push('No tracks found in CSV.');
    result.duration_ms = Date.now() - start;
    return result;
  }

  log('IMPORT_PARSED', { format, trackCount: tracks.length });

  const db = env.WKRP_DB;
  const now = new Date().toISOString();

  try {
    // Precompute canonical keys once — reused for lookup and resolution.
    const canon = tracks.map((t) => ({
      title: normalizeTitle(t.name),
      artist: normalizeArtist(t.artist),
    }));

    // --- Phase 1: bulk-load existing matches (chunked, read-only) ---
    const isrcToId = await loadIsrcMatches(db, distinct(tracks.map((t) => t.isrc).filter(isStr)));
    const platformToId = await loadPlatformMatches(db, groupPlatformIds(tracks));
    const canonToId = await loadCanonMatches(db, distinctPairs(canon));

    // --- Phase 2: resolve in memory + collect writes ---
    const trackInserts: D1PreparedStatement[] = [];
    const identifierInserts: D1PreparedStatement[] = [];
    const isrcBackfills: D1PreparedStatement[] = [];
    const contributionInserts: D1PreparedStatement[] = [];

    const seenIdentifier = new Set<string>(); // platform|||platform_id
    const seenBackfill = new Set<string>();    // trackId
    const seenContribution = new Set<string>(); // trackId|||source_type|||source_name

    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      const { title: canonTitle, artist: canonArtist } = canon[i];
      const canonK = `${canonTitle}|||${canonArtist}`;
      const pKey = t.platform_id ? platformKey(t.platform, t.platform_id) : null;

      let trackId: string;
      let isNew = false;

      if (t.isrc && isrcToId.has(t.isrc)) {
        trackId = isrcToId.get(t.isrc)!;
      } else if (pKey && platformToId.has(pKey)) {
        trackId = platformToId.get(pKey)!;
      } else if (canonToId.has(canonK)) {
        trackId = canonToId.get(canonK)!;
      } else {
        // No match anywhere (DB or earlier in this file) — mint a new track.
        trackId = crypto.randomUUID();
        isNew = true;
        trackInserts.push(buildTrackInsert(db, trackId, t, canonTitle, canonArtist, now));
        // Register in every map so later rows in this file dedup against it.
        if (t.isrc) isrcToId.set(t.isrc, trackId);
        if (pKey) platformToId.set(pKey, trackId);
        canonToId.set(canonK, trackId);
      }

      if (isNew) result.tracks_new++;
      else result.tracks_matched++;

      // Register the platform identifier (new or matched track) once per pair.
      if (pKey && !seenIdentifier.has(pKey)) {
        seenIdentifier.add(pKey);
        identifierInserts.push(
          db.prepare(`
            INSERT OR IGNORE INTO track_identifiers (track_id, platform, platform_id, platform_uri, created_at)
            VALUES (?, ?, ?, ?, ?)
          `).bind(trackId, t.platform, t.platform_id, t.platform_uri ?? null, now),
        );
      }

      // Backfill ISRC onto an existing track that lacks one (SQL guard makes it
      // a no-op otherwise). New tracks already carry their ISRC.
      if (!isNew && t.isrc && !seenBackfill.has(trackId)) {
        seenBackfill.add(trackId);
        isrcBackfills.push(
          db.prepare('UPDATE tracks SET isrc = ? WHERE id = ? AND isrc IS NULL').bind(t.isrc, trackId),
        );
      }

      // Contribution — dedup in-file by the table's unique key.
      const cSourceName = t.source_name ?? sourceName ?? null;
      const cKey = `${trackId}|||${t.source_type}|||${cSourceName ?? ''}`;
      if (seenContribution.has(cKey)) {
        result.contributions_skipped++;
        continue;
      }
      seenContribution.add(cKey);
      contributionInserts.push(
        db.prepare(`
          INSERT OR IGNORE INTO contributions (
            id, track_id, contributor_id, source_type, source_name,
            source_platform, original_submitter_id, play_count,
            first_listened_at, added_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          trackId,
          contributorId,
          t.source_type,
          cSourceName,
          t.platform,
          null,
          t.play_count ?? null,
          t.first_listened_at ?? null,
          t.added_at ?? now,
          now,
        ),
      );
    }

    // --- Phase 3: batched writes ---
    // Tracks first so identifier/contribution foreign keys resolve.
    await runBatches(db, trackInserts);
    await runBatches(db, [...identifierInserts, ...isrcBackfills]);
    const contribResults = await runBatches(db, contributionInserts);

    // A 0-change result means the row already existed (unique constraint).
    for (const r of contribResults) {
      if ((r?.meta?.changes ?? 0) > 0) result.contributions_created++;
      else result.contributions_skipped++;
    }
  } catch (err) {
    logError('IMPORT_ERROR', err, { contributorId, format });
    result.errors.push(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  result.duration_ms = Date.now() - start;
  log('IMPORT_COMPLETE', { contributorId, format, ...result });
  return result;
}

function isStr(v: string | undefined): v is string {
  return typeof v === 'string' && v.length > 0;
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function distinctPairs(pairs: { title: string; artist: string }[]): { title: string; artist: string }[] {
  const seen = new Set<string>();
  const out: { title: string; artist: string }[] = [];
  for (const p of pairs) {
    const k = `${p.title}|||${p.artist}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Group platform_ids by platform so each lookup binds a single platform. */
function groupPlatformIds(tracks: NormalizedTrackData[]): Map<string, string[]> {
  const byPlatform = new Map<string, Set<string>>();
  for (const t of tracks) {
    if (!t.platform_id) continue;
    let set = byPlatform.get(t.platform);
    if (!set) {
      set = new Set();
      byPlatform.set(t.platform, set);
    }
    set.add(t.platform_id);
  }
  const out = new Map<string, string[]>();
  for (const [platform, ids] of byPlatform) out.set(platform, [...ids]);
  return out;
}

async function loadIsrcMatches(db: D1Database, isrcs: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const group of chunk(isrcs, LOOKUP_CHUNK)) {
    const placeholders = group.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT id, isrc FROM tracks WHERE merged_into_id IS NULL AND isrc IN (${placeholders})`,
    ).bind(...group).all<{ id: string; isrc: string }>();
    for (const r of rows.results ?? []) map.set(r.isrc, r.id);
  }
  return map;
}

async function loadPlatformMatches(db: D1Database, byPlatform: Map<string, string[]>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const [platform, ids] of byPlatform) {
    for (const group of chunk(ids, LOOKUP_CHUNK)) {
      const placeholders = group.map(() => '?').join(',');
      const rows = await db.prepare(
        `SELECT track_id, platform_id FROM track_identifiers WHERE platform = ? AND platform_id IN (${placeholders})`,
      ).bind(platform, ...group).all<{ track_id: string; platform_id: string }>();
      for (const r of rows.results ?? []) map.set(platformKey(platform, r.platform_id), r.track_id);
    }
  }
  return map;
}

async function loadCanonMatches(db: D1Database, pairs: { title: string; artist: string }[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const group of chunk(pairs, PAIR_CHUNK)) {
    const ors = group.map(() => '(canonical_title = ? AND canonical_artist = ?)').join(' OR ');
    const binds: string[] = [];
    for (const p of group) binds.push(p.title, p.artist);
    const rows = await db.prepare(
      `SELECT id, canonical_title, canonical_artist FROM tracks WHERE merged_into_id IS NULL AND (${ors})`,
    ).bind(...binds).all<{ id: string; canonical_title: string; canonical_artist: string }>();
    for (const r of rows.results ?? []) map.set(`${r.canonical_title}|||${r.canonical_artist}`, r.id);
  }
  return map;
}

function buildTrackInsert(
  db: D1Database,
  id: string,
  t: NormalizedTrackData,
  canonTitle: string,
  canonArtist: string,
  now: string,
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO tracks (id, name, artist, album, duration_ms, preview_url, image_url,
      energy, danceability, valence, tempo, acousticness, instrumentalness,
      genre, isrc, release_year, canonical_title, canonical_artist, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    t.name,
    t.artist,
    t.album,
    t.duration_ms ?? null,
    t.preview_url ?? null,
    t.image_url ?? null,
    t.energy ?? null,
    t.danceability ?? null,
    t.valence ?? null,
    t.tempo ?? null,
    t.acousticness ?? null,
    t.instrumentalness ?? null,
    t.genre ?? null,
    t.isrc ?? null,
    extractReleaseYear(t.release_date),
    canonTitle,
    canonArtist,
    now,
  );
}

async function runBatches(db: D1Database, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
  const out: D1Result[] = [];
  for (const group of chunk(stmts, WRITE_BATCH)) {
    if (group.length === 0) continue;
    const res = await db.batch(group);
    out.push(...res);
  }
  return out;
}
