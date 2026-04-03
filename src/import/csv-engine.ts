/**
 * CSV import engine — orchestrates parse → dedup → insert contributions.
 *
 * Handles Exportify (Spotify), Last.fm, and Apple Music CSV formats.
 * Deduplicates tracks via ISRC > platform ID > canonical title+artist.
 * Records provenance (who brought what, how, from where).
 */

import type { Env, ImportResult, SourceType } from '../types';
import { parseCsv } from './csv-parser';
import { resolveOrCreateTrack } from '../lib/track-resolver';
import { log, logError } from '../lib/logger';

/**
 * Import a CSV file for a contributor.
 * Parses the CSV, deduplicates tracks, and records contributions.
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

  // Step 1: Parse CSV
  const { format, tracks } = parseCsv(csvContent, sourceType, sourceName);

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

  // Step 2: Process each track — resolve/create + record contribution
  for (const trackData of tracks) {
    try {
      // Resolve or create the track in the master library
      const { trackId, isNew } = await resolveOrCreateTrack(env.WKRP_DB, trackData);

      if (isNew) {
        result.tracks_new++;
      } else {
        result.tracks_matched++;
      }

      // Record the contribution (provenance)
      const contributionId = crypto.randomUUID();
      const now = new Date().toISOString();

      const insertResult = await env.WKRP_DB.prepare(`
        INSERT OR IGNORE INTO contributions (
          id, track_id, contributor_id, source_type, source_name,
          source_platform, original_submitter_id, play_count,
          first_listened_at, added_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        contributionId,
        trackId,
        contributorId,
        trackData.source_type,
        trackData.source_name ?? sourceName ?? null,
        trackData.platform,
        null, // original_submitter_id — set separately for curated submissions
        trackData.play_count ?? null,
        trackData.first_listened_at ?? null,
        trackData.added_at ?? now,
        now,
      ).run();

      if (insertResult.meta.changes > 0) {
        result.contributions_created++;
      } else {
        result.contributions_skipped++; // Already existed (unique constraint)
      }

      // Register platform identifier if not already done by resolveOrCreateTrack
      if (!isNew && trackData.platform_id) {
        await env.WKRP_DB.prepare(`
          INSERT OR IGNORE INTO track_identifiers (track_id, platform, platform_id, platform_uri, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(trackId, trackData.platform, trackData.platform_id, trackData.platform_uri ?? null, now).run();
      }
    } catch (err) {
      const errorMsg = `Failed to import "${trackData.name}" by ${trackData.artist}: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(errorMsg);
      logError('IMPORT_TRACK_ERROR', err, { name: trackData.name, artist: trackData.artist });
    }
  }

  result.duration_ms = Date.now() - start;
  log('IMPORT_COMPLETE', {
    contributorId,
    format,
    ...result,
  });

  return result;
}
