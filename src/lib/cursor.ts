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

// btoa/atob operate on Latin1 only and throw on code points > 0xFF. Sort values
// are user-derived (track titles, artist names) and routinely contain emoji or
// non-Latin scripts, so round-trip through UTF-8 bytes to avoid a 500 on encode.
function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeCursor(id: string, sortValue?: string | number): string {
  const data: CursorData = { id };
  if (sortValue !== undefined) data.v = sortValue;
  return toBase64(JSON.stringify(data));
}

export function decodeCursor(cursor: string): CursorData | null {
  try {
    const decoded = fromBase64(cursor);
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
