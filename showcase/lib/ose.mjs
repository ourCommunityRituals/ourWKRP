// Read a creator's events from OurSharedEvents (OSE) at build time, through
// OSE's public API only: no key, no cookie, GET only.
//
//   GET /api/v2/events?brand=<brand>           which events are public on the brand
//   GET /api/v2/events/:id                     each linked event (When, Where, How), and the series it sits on
//   GET /api/v2/events/:id/poster-bundle[?deployment=<placement>]   its codes
//   GET /api/v2/events/:id/sponsor-bundle?surface=public            its consented sponsors
//   GET /brands/<brand>/calendar.ics                                the brand's calendar feed, where OSE serves one
//   GET /api/v2/map/areas?cells=<cell>,…&around=1                   each station's where map, as OSE draws it
//
// A linked event that is missing, not public, or on another brand drops off the
// page and fails nothing. Text read from OSE that names the creator stops the
// build: until she agrees, OSE carries neutral titles only (owner, 2026-11-12).
import { assertLocalBase, safeHttpsUrl } from './showcase.mjs';
import { codesFromBundle } from './codes.mjs';
import { creatorSchema, MODES } from './schema.mjs';
import { isLeadStation, isPast, stationSchedule } from './schedule.mjs';
import { areaCell, mapFromAnswer, mapKey, mapPath, whereAreas } from './map.mjs';

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
    // The area the event is in: OSE's resolution-7 cell, about 5 square
    // kilometres. Its latitude and longitude are not kept: a map here is drawn
    // from the area alone (place, not person).
    area: areaCell(item.h3_res7),
    // How the event is held: online, in person or both (OSE S13). An OSE from
    // before the field, or a value that is not a mode, reads as no mode.
    attendanceMode: MODES.includes(item.attendance_mode) ? item.attendance_mode : null,
  };
}

/**
 * The sponsors a page may show for one event, from OSE's public sponsor bundle.
 * OSE lists a sponsor there only when both sides accepted and the event has
 * sponsors switched on, so the page shows exactly this list and never adds to
 * it. Only a name and, when OSE gives one, the campaign leave the bundle: no
 * token, logo, website or tier.
 */
export function sponsorsFromBundle(bundle) {
  const seen = new Set();
  const out = [];
  for (const s of bundle?.sponsors ?? []) {
    const id = String(s?.id ?? '');
    const title = String(s?.title ?? s?.display_name ?? s?.name ?? '').trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const c = s.campaign;
    const campaign = c && typeof c.id === 'string' && c.id ? { id: c.id, title: String(c.title ?? '').trim() } : null;
    out.push({ id, title, campaign });
  }
  return out;
}

/**
 * The declared series an event sits on, from the `series` beside `item` in
 * OSE's public event read (OSE ADR-029): its label and its schedule. OSE shows
 * only a series the organizer declared or confirmed. Returns the series, null
 * when OSE says the event sits on none, or undefined when this OSE does not
 * say either way (a build of OSE from before it served series).
 */
export function seriesFromRead(body) {
  if (!body || !('series' in body)) return undefined;
  const s = body.series;
  if (!s || typeof s.id !== 'string' || !s.id) return null;
  const whole = (n, lo, hi) => (Number.isInteger(n) && n >= lo && n <= hi ? n : null);
  return {
    id: s.id,
    name: String(s.name ?? '').trim(),
    cadence: typeof s.cadence === 'string' ? s.cadence : null,
    dayOfWeek: whole(s.day_of_week, 0, 6),
    hourOfDay: whole(s.hour_of_day, 0, 23),
  };
}

/** Between two map reads, at least this long: under 6 a second, as OSE asks of a build of many stations. */
export const MAP_GAP_MS = 200;
/** A map read that has not answered by now is given up on. */
export const MAP_TIMEOUT_MS = 10_000;

/**
 * The maps a build needs: each station's areas, in the order its list numbers
 * them, once per distinct list. The renderer works the same lists out from the
 * same events (`whereAreas`), and finds its map under the same key.
 *
 * @returns {string[][]}
 */
export function mapLists(creator, linked, now) {
  if (creator.sections?.map === false) return [];
  const lists = new Map();
  for (const s of creator.stations ?? []) {
    const { upcoming } = stationSchedule(s, linked, now, { isLead: isLeadStation(s) });
    const cells = whereAreas(upcoming).areas.map((a) => a.cell);
    if (cells.length) lists.set(mapKey(cells), cells);
  }
  return [...lists.values()];
}

/**
 * Read each map from OurSharedEvents, one request per list, cells only. This
 * read never stops a build: an answer that is late, refused, rate-limited or
 * not a map of the cells asked for leaves that map out, the page is built with
 * its list alone, and the reason is returned in `mapsMissed` for the build to
 * print. It is not retried: the next build reads again.
 *
 * @returns {Promise<{maps: Record<string, object>, mapsMissed: string[]}>}
 */
export async function readMaps({ origin, lists, fetch: f = globalThis.fetch, paced = async () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), clock = Date.now }) {
  const maps = {};
  const mapsMissed = [];
  let last = null;
  for (const cells of lists) {
    if (last !== null) {
      const wait = MAP_GAP_MS - (clock() - last);
      if (wait > 0) await sleep(wait);
    }
    await paced();
    last = clock();
    let why = null;
    try {
      const res = await f(`${origin}${mapPath(cells)}`, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', credentials: 'omit', signal: globalThis.AbortSignal.timeout(MAP_TIMEOUT_MS) });
      if (res.status !== 200) why = `answered ${res.status}`;
      else {
        const map = mapFromAnswer(await res.json(), cells);
        if (map) maps[mapKey(cells)] = map;
        else why = 'answered with something that is not a map of the areas asked for';
      }
    } catch (e) {
      why = e?.name === 'TimeoutError' ? `gave no answer in ${MAP_TIMEOUT_MS / 1000} seconds` : 'could not be read';
    }
    if (why) mapsMissed.push(`a map of ${cells.length} ${cells.length === 1 ? 'area' : 'areas'} was left out: OurSharedEvents ${why}`);
  }
  return { maps, mapsMissed };
}

/** Where OSE serves a brand's calendar feed. */
export const calendarPath = (brand) => `/brands/${encodeURIComponent(brand)}/calendar.ics`;

/**
 * Read every linked event. Returns `{ origin, linked, dropped, calendar, maps, mapsMissed }`:
 * `linked` is `[{ link, event, codes, sponsors, series }]` for each public event on the
 * brand, `calendar` is the brand feed's URL when OSE serves one, else null, and
 * `maps` holds each station's where map as OSE drew it (see `readMaps`).
 *
 * @param {{ base: string, creator: object, fetch?: typeof fetch, now?: Date|number, paced?: () => Promise<void>, sleep?: (ms: number) => Promise<void>, clock?: () => number }} o
 */
export async function readOse({ base, creator, fetch: f = globalThis.fetch, now = Date.now(), paced = async () => {}, sleep, clock }) {
  const origin = assertReadBase(base);
  const links = creator.events ?? [];
  if (!links.length) return { origin, linked: [], dropped: [], calendar: null, maps: {}, mapsMissed: [] };
  // The creator file is checked before OSE is read: a bad file reads nothing.
  const parsed = creatorSchema.safeParse(creator);
  const fileProblems = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  if (!creator.oseBrand) fileProblems.push('oseBrand: needed once events are linked (the OSE brand they live on)');
  if (fileProblems.length) throw new Error(`creator file refused:\n  ${fileProblems.join('\n  ')}`);
  const terms = identityTerms(creator);
  const problems = [];
  const codeErrors = [];
  const sponsorErrors = [];

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
    const series = seriesFromRead(one.body);
    if (series) problems.push(...neutralProblems(`${link.oseEventId} series`, series.name, terms));

    // A past event shows no code and no sponsor, so neither bundle is read.
    let codes = [];
    let sponsors = [];
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
      // The same for its sponsors: a list that cannot be read stops the build,
      // so a partner never drops off a page unseen, and none is ever guessed.
      const backing = await get(`/api/v2/events/${encodeURIComponent(link.oseEventId)}/sponsor-bundle?surface=public`);
      if (backing.status !== 200 || !Array.isArray(backing.body?.bundle?.sponsors)) {
        sponsorErrors.push(`${link.oseEventId}: its sponsor bundle answered ${backing.status}`);
      } else {
        sponsors = sponsorsFromBundle(backing.body.bundle);
        for (const s of sponsors) problems.push(...neutralProblems(`${link.oseEventId} sponsor`, `${s.title} ${s.campaign?.title ?? ''}`, terms));
      }
    }
    linked.push({ link, event, codes, sponsors, series });
  }

  // The brand's calendar feed is listed only where OSE serves one: a missing
  // route, an empty brand or an edge challenge leaves it off and fails nothing.
  // It carries every public event on the brand, linked here or not, so its
  // text is held to the same neutral rule.
  let calendar = null;
  if (linked.length) {
    await paced();
    const path = calendarPath(creator.oseBrand);
    const res = await f(`${origin}${path}`, { method: 'GET', headers: { Accept: 'text/calendar' }, redirect: 'error', credentials: 'omit' }).catch(() => null);
    const feed = res?.status === 200 ? await res.text().catch(() => '') : '';
    if (/^BEGIN:VCALENDAR\r?\n/.test(feed)) {
      // Folded lines are joined first, so a name split across two lines is
      // still seen. The brand's own id is left out, as it is for an event.
      const lines = feed.replace(/\r?\n[ \t]/g, '').replaceAll(creator.oseBrand, '');
      problems.push(...neutralProblems('the calendar feed', lines, terms));
      calendar = `${origin}${path}`;
    }
  }
  if (problems.length) throw new Error(`OSE text is not neutral:\n  ${problems.join('\n  ')}`);
  if (codeErrors.length) throw new Error(`OSE codes refused:\n  ${codeErrors.join('\n  ')}`);
  if (sponsorErrors.length) throw new Error(`OSE sponsors refused:\n  ${sponsorErrors.join('\n  ')}`);
  // Last, and only for a build that will go on: the where maps.
  const { maps, mapsMissed } = await readMaps({ origin, lists: mapLists(creator, linked, now), fetch: f, paced, sleep, clock });
  return { origin, linked, dropped, calendar, maps, mapsMissed };
}
