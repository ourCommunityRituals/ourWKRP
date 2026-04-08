/**
 * Cursor-based pagination helpers
 *
 * Cursor = base64-encoded JSON of { id, sort_value }
 * Uses keyset pagination (WHERE id > cursor_id) for stable, efficient paging.
 * Avoids OFFSET which scans/discards rows and degrades on D1.
 */

interface CursorData {
  id: string;
  v?: string | number; // sort column value (optional)
}

export function encodeCursor(id: string, sortValue?: string | number): string {
  const data: CursorData = { id };
  if (sortValue !== undefined) data.v = sortValue;
  return btoa(JSON.stringify(data));
}

export function decodeCursor(cursor: string): CursorData | null {
  try {
    const decoded = atob(cursor);
    const data = JSON.parse(decoded) as CursorData;
    if (!data.id || typeof data.id !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

export function parsePaginationParams(url: URL): { cursor: string | null; limit: number } {
  const cursor = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  let limit = 25;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
      limit = parsed;
    }
  }
  return { cursor, limit };
}
