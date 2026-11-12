// Read a creator's events from OurSharedEvents (OSE) at build time, through
// OSE's public API only: no key, no cookie, GET only.
//
//   GET /api/v2/events?brand=<brand>           which events are public on the brand
//   GET /api/v2/events/:id                     each linked event (When, Where, How)
//   GET /api/v2/events/:id/poster-bundle[?deployment=<placement>]   its codes
//
// A linked event that is missing, not public, or on another brand drops off the
// page and fails nothing. Text read from OSE that names the creator stops the
// build: until she agrees, OSE carries neutral titles only (owner, 2026-11-12).
import { assertLocalBase, safeHttpsUrl } from './showcase.mjs';
import { codesFromBundle } from './codes.mjs';
import { creatorSchema } from './schema.mjs';
import { isPast } from './schedule.mjs';

/** OSE staging. Production is closed, so a build never reads it. */
export const OSE_STAGING = 'https://stg.oursharedevents.com';

/** The build reads a local OSE worker or OSE staging, nothing else. */
export function assertReadBase(base) {
  if (base === OSE_STAGING) return base;
  return assertLocalBase(base);
}

/**
 * The words a page about this creator may carry but OSE may not, until she
 * agrees, as `{ term, word }`. A `word` term matches only as a whole word: each
 * word of her name, and any term shorter than 4 letters (a 3-letter name is
 * still a name). A longer phrase (her full name, a venture, a link) also
 * matches inside other text.
 */
export function identityTerms(creator) {
  const terms = new Map();
  const add = (t, word = false) => {
    const s = String(t ?? '').trim().toLowerCase();
    if (s.length < 2) return;
    const w = word || s.length < 4;
    terms.set(s, (terms.get(s) ?? true) && w);
  };
  const addName = (n) => {
    add(n);
    for (const part of String(n ?? '').split(/[^\p{L}\p{N}]+/u)) add(part, true);
  };
  addName(creator.name);
  for (const n of creator.privateNames ?? []) addName(n);
  for (const p of creator.places ?? []) {
    if (Array.isArray(p)) add(p[0]);
    else {
      add(p.label);
      const href = safeHttpsUrl(p.url);
      if (href) {
        add(p.url);
        add(new URL(href).hostname.replace(/^www\./, ''));
      }
    }
  }
  for (const s of creator.sources ?? []) add(s.url);
  return [...terms].map(([term, word]) => ({ term, word }));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (hay, t) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t)}($|[^\\p{L}\\p{N}])`, 'u').test(hay);

/** Lines naming each identity term found in a piece of OSE text. */
export function neutralProblems(label, text, terms) {
  const hay = String(text ?? '').toLowerCase();
  return terms.filter(({ term, word }) => (word ? hasWord(hay, term) : hay.includes(term))).map(({ term }) => `${label} names "${term}"`);
}

// Every text field OSE serves about an event. brand_id is not among them: an
// event on any brand but the creator file's own oseBrand is dropped first.
const EVENT_TEXT = ['title', 'name', 'slug', 'description', 'location', 'venue', 'what_short', 'who_host', 'why_purpose', 'how_details', 'where_address'];

/** Normalise the public event projection into what the page uses. */
export function toEvent(item) {
  return {
    id: String(item.id),
    brandId: item.brand_id ?? null,
    title: item.name ?? item.title ?? '',
    whatShort: item.what_short ?? null,
    whoHost: item.who_host ?? null,
    whyPurpose: item.why_purpose ?? null,
    howDetails: item.how_details ?? null,
    whereAddress: item.where_address ?? null,
    venue: item.venue ?? item.location ?? null,
    startDate: item.start_date ?? null,
    endDate: item.end_date ?? null,
    timezone: item.timezone ?? null,
    startsAt: item.starts_at ?? null,
    // OSE S13 adds this; until it lands every event reads without a mode.
    attendanceMode: item.attendance_mode ?? null,
  };
}

/**
 * Read every linked event. Returns `{ origin, linked, dropped }`, where
 * `linked` is `[{ link, event, codes }]` for each public event on the brand.
 *
 * @param {{ base: string, creator: object, fetch?: typeof fetch, now?: Date|number, paced?: () => Promise<void> }} o
 */
export async function readOse({ base, creator, fetch: f = globalThis.fetch, now = Date.now(), paced = async () => {} }) {
  const origin = assertReadBase(base);
  const links = creator.events ?? [];
  if (!links.length) return { origin, linked: [], dropped: [] };
  // The creator file is checked before OSE is read: a bad file reads nothing.
  const parsed = creatorSchema.safeParse(creator);
  const fileProblems = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  if (!creator.oseBrand) fileProblems.push('oseBrand: needed once events are linked (the OSE brand they live on)');
  if (fileProblems.length) throw new Error(`creator file refused:\n  ${fileProblems.join('\n  ')}`);
  const terms = identityTerms(creator);
  const problems = [];
  const codeErrors = [];

  async function get(path) {
    await paced();
    const res = await f(`${origin}${path}`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit' });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  const list = await get(`/api/v2/events?brand=${encodeURIComponent(creator.oseBrand)}`);
  if (list.status !== 200 || !Array.isArray(list.body?.items)) throw new Error(`OSE brand list answered ${list.status}`);
  const listed = new Set(list.body.items.map((i) => String(i.id)));

  const linked = [];
  const dropped = [];
  for (const link of links) {
    if (!listed.has(link.oseEventId)) {
      dropped.push({ link, reason: 'not public on the brand' });
      continue;
    }
    const one = await get(`/api/v2/events/${encodeURIComponent(link.oseEventId)}`);
    const item = one.body?.item;
    if (one.status !== 200 || !item) {
      dropped.push({ link, reason: `answered ${one.status}` });
      continue;
    }
    if (item.brand_id !== creator.oseBrand) {
      dropped.push({ link, reason: 'on another brand' });
      continue;
    }
    for (const k of EVENT_TEXT) problems.push(...neutralProblems(`${link.oseEventId} ${k}`, item[k], terms));
    const event = toEvent(item);

    // A past event shows no code, so its bundle is never read.
    let codes = [];
    if (!isPast(event, now)) {
      const q = link.placement ? `?deployment=${encodeURIComponent(link.placement)}` : '';
      const bundle = await get(`/api/v2/events/${encodeURIComponent(link.oseEventId)}/poster-bundle${q}`);
      // An upcoming public event whose codes cannot be read, or whose placement
      // OSE does not know, stops the build: a station never loses its codes unseen.
      if (bundle.status !== 200 || !bundle.body) {
        codeErrors.push(`${link.oseEventId}: its poster bundle answered ${bundle.status}`);
      } else {
        if (link.placement && bundle.body.deploymentId !== link.placement) {
          codeErrors.push(`${link.oseEventId}: placement ${link.placement} is not an active placement on this event`);
        }
        codes = codesFromBundle(bundle.body, origin);
        for (const s of bundle.body.slots ?? []) problems.push(...neutralProblems(`${link.oseEventId} code ${s.kind}`, `${s.word ?? ''} ${s.label ?? ''}`, terms));
      }
    }
    linked.push({ link, event, codes });
  }
  if (problems.length) throw new Error(`OSE text is not neutral:\n  ${problems.join('\n  ')}`);
  if (codeErrors.length) throw new Error(`OSE codes refused:\n  ${codeErrors.join('\n  ')}`);
  return { origin, linked, dropped };
}
