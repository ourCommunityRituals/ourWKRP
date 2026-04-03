/**
 * Title and artist normalization for cross-platform track deduplication.
 *
 * Strips version suffixes (Remastered, Deluxe, Radio Edit),
 * featured artist tags, and normalizes multi-artist formatting
 * so the same recording matches across Spotify, Apple Music, Last.fm, etc.
 */

const TITLE_STRIP_PATTERNS = [
  // Remastered variants
  /\s*[-–—]\s*remaster(ed)?\s*(\d{4})?\s*$/i,
  /\s*\(remaster(ed)?\s*(\d{4})?\)\s*$/i,
  /\s*\[remaster(ed)?\s*(\d{4})?\]\s*$/i,
  // Deluxe / Special / Bonus
  /\s*\((deluxe|special|bonus|expanded)\s*(edition|version)?\)\s*$/i,
  /\s*\[(deluxe|special|bonus|expanded)\s*(edition|version)?\]\s*$/i,
  // Radio Edit / Single Version
  /\s*[-–—]\s*(radio\s+edit|single\s+version|album\s+version)\s*$/i,
  /\s*\((radio\s+edit|single\s+version|album\s+version)\)\s*$/i,
  // Featured artists in title
  /\s*\(feat\.?\s+[^)]+\)\s*$/i,
  /\s*\[feat\.?\s+[^\]]+\]\s*$/i,
  /\s*feat\.?\s+.+$/i,
  // "with" collaborators in title
  /\s*\(with\s+[^)]+\)\s*$/i,
  /\s*\[with\s+[^\]]+\]\s*$/i,
];

const ARTIST_SEPARATORS = /\s*[,&]\s*|\s+and\s+|\s+x\s+/i;

/**
 * Normalize a track title for dedup matching.
 * Strips remaster/deluxe/feat suffixes, lowercases, trims.
 */
export function normalizeTitle(title: string): string {
  let normalized = title.trim().toLowerCase();

  for (const pattern of TITLE_STRIP_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Normalize an artist string for dedup matching.
 * Splits multi-artist strings, sorts alphabetically, rejoins.
 */
export function normalizeArtist(artist: string): string {
  const parts = artist
    .trim()
    .toLowerCase()
    .split(ARTIST_SEPARATORS)
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .sort();

  return parts.join(', ');
}

/**
 * Extract release year from various date formats.
 * Handles: "2024-03-15", "2024", "March 15, 2024", "15/03/2024"
 */
export function extractReleaseYear(date: string | undefined | null): number | null {
  if (!date) return null;

  // Try YYYY-MM-DD or YYYY
  const isoMatch = date.match(/^(\d{4})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    if (year >= 1900 && year <= 2100) return year;
  }

  // Try MM/DD/YYYY or DD/MM/YYYY
  const slashMatch = date.match(/(\d{4})$/);
  if (slashMatch) {
    const year = parseInt(slashMatch[1], 10);
    if (year >= 1900 && year <= 2100) return year;
  }

  return null;
}
