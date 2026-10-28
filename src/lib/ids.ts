/**
 * Shape of an external id OW carries but does not mint.
 *
 * Letters, digits, underscore and hyphen; 1 to 128 characters. This is the
 * shape of an OSE event id, and the one rule every place that accepts an id
 * from outside holds it to: the request schemas that store an event id next to
 * attributions and DJ sets (lib/schemas.ts), and the DJ poster that puts the DJ
 * id and the event id into its QR (handlers/pages.ts). Nothing matching it can
 * carry markup, whitespace, a quote, a slash or a percent, so a stored value
 * can never change the meaning of a URL or a page it later appears in.
 *
 * src/templates/live.html repeats the same literal for the browser (it cannot
 * import); a unit test pins the two to each other.
 *
 * Pure and dependency-free, like lib/slug.ts and lib/route-path.ts.
 */
export const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
