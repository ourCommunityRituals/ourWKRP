/**
 * Server-side HTML escaping for worker-rendered markup (OW-122).
 *
 * The page handler injects database-sourced text (contributor names, brand
 * names) into the served HTML *before* it reaches the browser. Crawlers do not
 * execute JavaScript, so profile.html's client-side escapeHtml() — which relies
 * on the DOM — cannot protect this content. Anything the worker splices into
 * the document must go through one of these helpers instead.
 */

/**
 * Escape text for an HTML attribute value (also correct in text position).
 *
 * Escapes the full five-character set; `"` and `'` are what stop an
 * attacker-controlled value from breaking out of a `content="..."` attribute.
 */
export function escapeHtmlAttr(value: string | null | undefined): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize text destined for a quoted CSS string inside a `<style>` element.
 *
 * `<style>` content is raw text, not parsed markup: HTML entities are NOT
 * decoded there, so escapeHtmlAttr is the wrong tool — it would render a
 * literal `&quot;` into the stylesheet. The real hazards are the sequence that
 * closes the element (`</style>`) and the characters that terminate the CSS
 * string, so those are removed outright. Spaces, hyphens and ordinary
 * punctuation survive, so a brand name like "New York Radio" is unchanged.
 *
 * Found by the OW-122 OG-escaping tests: the brand name reaches both the
 * `<style>` block and `og:site_name`, and only the latter was escaped.
 */
export function cssStringSafe(value: string | null | undefined): string {
  if (value == null) return '';
  return String(value).replace(/["'<>\\\r\n]/g, '');
}

/**
 * A CSS color safe to interpolate into a declaration, or null when the stored
 * value is not a plain color token. Blocks a stored value such as
 * `red;} body{display:none` from rewriting the rest of the stylesheet.
 */
export function safeCssColor(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  // #rgb / #rrggbb / #rrggbbaa, or a bare CSS keyword such as `rebeccapurple`.
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed) || /^[a-zA-Z]+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}
