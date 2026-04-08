/**
 * Multi-tenant brand extraction
 *
 * Extracts brand_id from the request hostname:
 *   bronzeville.ourwkrp.com -> 'bronzeville'
 *   ourwkrp.com             -> 'wkrp' (default)
 *   localhost:8787           -> 'wkrp' (local dev)
 */

const DEFAULT_BRAND = 'wkrp';
const BASE_DOMAINS = ['ourwkrp.com', 'localhost'];

export function extractBrandId(request: Request): string {
  const host = new URL(request.url).hostname;

  // Local dev — always default brand
  if (host === 'localhost' || host === '127.0.0.1') {
    return DEFAULT_BRAND;
  }

  // Check for subdomain: {brand}.ourwkrp.com
  for (const base of BASE_DOMAINS) {
    if (host.endsWith(`.${base}`)) {
      const subdomain = host.slice(0, -(base.length + 1));
      // Skip www and stg — not brands
      if (subdomain === 'www' || subdomain === 'stg') {
        return DEFAULT_BRAND;
      }
      if (subdomain && /^[a-z0-9-]+$/.test(subdomain)) {
        return subdomain;
      }
    }
  }

  return DEFAULT_BRAND;
}
