/**
 * POST /import/:contributorId — Import a CSV library file for a contributor.
 *
 * Accepts multipart/form-data with:
 * - file: The CSV file
 * - source_type: (optional) liked | saved_album | created_playlist | curated_submission | lastfm_history | apple_library | manual
 * - source_name: (optional) e.g., "RecNights Season 3", "Liked Songs"
 *
 * Or application/json with:
 * - csv: The CSV content as a string
 * - source_type / source_name as above
 */

import type { Env, SourceType } from '../types';
import { importCsv } from '../import/csv-engine';
import { getSession } from '../lib/kv-storage';
import { getSessionToken } from '../lib/session-cookie';
import { log, logError } from '../lib/logger';

const VALID_SOURCE_TYPES: SourceType[] = [
  'liked', 'saved_album', 'created_playlist', 'curated_submission',
  'lastfm_history', 'apple_library', 'manual',
];

const MAX_CSV_SIZE = 10 * 1024 * 1024; // 10MB

export async function handleImport(
  request: Request,
  env: Env,
  contributorId: string,
): Promise<Response> {
  // Authenticate — session cookie must match contributorId
  const sessionToken = getSessionToken(request);
  if (!sessionToken) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = await getSession(env.WKRP_KV, sessionToken);
  if (!session || session.userId !== contributorId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let csvContent: string;
  let sourceType: SourceType | undefined;
  let sourceName: string | undefined;

  const contentType = request.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const fileField = formData.get('file');

      if (!fileField || typeof fileField === 'string') {
        return new Response(JSON.stringify({ error: 'No CSV file provided' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const file = fileField as unknown as { size: number; text(): Promise<string> };

      if (file.size > MAX_CSV_SIZE) {
        return new Response(JSON.stringify({ error: 'CSV file too large (max 10MB)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      csvContent = await file.text();
      sourceType = (formData.get('source_type') as SourceType) || undefined;
      sourceName = (formData.get('source_name') as string) || undefined;
    } else if (contentType.includes('application/json')) {
      const body = await request.json() as { csv?: string; source_type?: string; source_name?: string };

      if (!body.csv || typeof body.csv !== 'string') {
        return new Response(JSON.stringify({ error: 'Missing csv field in JSON body' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (body.csv.length > MAX_CSV_SIZE) {
        return new Response(JSON.stringify({ error: 'CSV content too large (max 10MB)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      csvContent = body.csv;
      sourceType = body.source_type as SourceType | undefined;
      sourceName = body.source_name;
    } else {
      return new Response(JSON.stringify({ error: 'Unsupported content type. Use multipart/form-data or application/json.' }), {
        status: 415,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    logError('IMPORT_PARSE_ERROR', err);
    return new Response(JSON.stringify({ error: 'Failed to parse request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate source_type if provided
  if (sourceType && !VALID_SOURCE_TYPES.includes(sourceType)) {
    return new Response(JSON.stringify({
      error: `Invalid source_type. Valid values: ${VALID_SOURCE_TYPES.join(', ')}`,
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  log('IMPORT_REQUEST', { contributorId, sourceType, sourceName, csvLength: csvContent.length });

  const result = await importCsv(env, contributorId, csvContent, sourceType, sourceName);

  const status = result.errors.length > 0 && result.contributions_created === 0 ? 422 : 200;

  return new Response(JSON.stringify(result), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
