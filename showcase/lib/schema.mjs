// The contract for creator files and the station catalog.
//
// Version 2 (owner decisions, 2026-11-12) adds, all optional so a version 1
// file still validates:
//   - `places` as typed https objects, each placed on a station;
//   - per station: a `why` (required once the frequency has events or a
//     programme) and a `programme` of scheduled slots;
//   - `events`: links to OurSharedEvents (OSE) events, one frequency each, with
//     an intent (one-off, pop-up, programme, trial);
//   - `campaigns`: links to OSE campaigns, one frequency each;
//   - `oseBrand`: the OSE brand the events live on;
//   - `privateNames`: other names the creator or her ventures go by, never
//     shown, used only to keep them out of text read from OSE.
// A "frequency" in a link is a station id (teach, sound, ...).
import { z } from 'zod';
import { safeHttpsUrl } from './showcase.mjs';

const text = z.string().trim().min(1).max(2000);
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase words joined by hyphens');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const https = z.string().refine((u) => safeHttpsUrl(u) !== null, 'must be an https: URL');
const freq = z.number().min(88).max(108);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24 hour');

// OSE's own shapes: brand ids (handlers/events.ts), event ids (evt_…), poster
// deployment ids (pd_…). Campaign ids are not fixed by OSE yet (S14).
const oseBrand = z.string().regex(/^[a-z0-9_-]{1,64}$/, 'an OSE brand id');
const oseEventId = z.string().regex(/^evt_[A-Za-z0-9-]{8,64}$/, 'an OSE event id (evt_...)');
const oseDeploymentId = z.string().regex(/^pd_[A-Za-z0-9]{6,40}$/, 'an OSE placement id (pd_...)');
const oseCampaignId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'an OSE campaign id');

export const PLACE_KINDS = ['store', 'school', 'product', 'social', 'calendar', 'other'];
export const INTENTS = ['one-off', 'pop-up', 'programme', 'trial'];
export const CADENCES = ['daily-weekdays', 'weekly', 'biweekly', 'monthly', 'as-announced'];
export const MODES = ['online', 'in_person', 'both'];
export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const WEEKS = ['first', 'second', 'third', 'fourth', 'last'];
// The layout and display menu (owner, 2026-11-12): a fixed set of safe options.
// An unknown option fails the build; it never falls back silently.
export const LAYOUTS = ['dial', 'list', 'grid'];
export const STATION_ORDERS = ['file', 'next-event'];
export const DISPLAYS = ['page', 'tv'];
export const SECTIONS = ['values', 'scatter', 'reports', 'schedule', 'sources'];

const event = z
  .object({
    title: text,
    date: isoDate.optional(),
    kind: text,
    price: z.string().optional(),
    location: text.optional(),
    demo: z.enum(['high', 'medium', 'low']),
    // Where this demo event's codes hung, in the instance's own words (a bar has
    // no garment tag). Absent: the demo size's labels (SHAPES in showcase.mjs).
    placements: z.array(z.string().trim().min(1).max(40)).min(1).max(4).optional(),
  })
  .strict();

/** One programme slot: when a frequency broadcasts, how often and in what form. */
const slot = z
  .object({
    cadence: z.enum(CADENCES),
    day: z.enum(WEEKDAYS).optional(),
    week: z.enum(WEEKS).optional(),
    time: hhmm.optional(),
    timezone: z.string().min(1).max(64).optional(),
    mode: z.enum(MODES),
    kind: text,
    purpose: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const station = z
  .object({
    id: slug,
    category: slug.optional(),
    name: text.optional(),
    freq: freq.optional(),
    eyebrow: text,
    title: text,
    where: text,
    intro: text,
    online: text,
    live: text,
    track: text,
    report: text,
    sponsor: text,
    choice: text,
    why: text.optional(),
    programme: z.array(slot).optional(),
    event: event.nullable(),
  })
  .strict();

// A v1 place is a [label, note] pair with no link. A v2 place is typed, and its
// link is shown exactly as given: plain, never counted (owner, 2026-11-12).
const place = z.union([
  z.tuple([text, text]),
  z
    .object({
      label: text,
      note: text.optional(),
      url: https.optional(),
      station: slug.optional(),
      kind: z.enum(PLACE_KINDS),
    })
    .strict(),
]);

// Overlap (owner, 2026-11-13): stations are a playful way in, not boxes, so an
// event or a campaign may show on more than one. `frequency` is where it lives
// (its codes and its programme slot); `also` lists the other stations it shows on.
const also = z.array(slug).min(1).max(8).optional();

const eventLink = z
  .object({
    frequency: slug,
    also,
    oseEventId,
    intent: z.enum(INTENTS),
    // The showcase placement on this event (one per station page): its /q code.
    placement: oseDeploymentId.optional(),
    // A pop-up's window ends at this local time. OSE events carry a start time
    // but no end time, so the window's end is kept here.
    until: hhmm.optional(),
  })
  .strict();

const campaignLink = z.object({ frequency: slug, also, oseCampaignId }).strict();

// A copied schedule row: date, title, price, pairing; and, once it is a real
// OSE event, that event's id (the row then retires and OSE is the source).
const scheduleRow = z.union([
  z.tuple([isoDate, text, z.string(), text]),
  z.tuple([isoDate, text, z.string(), text, oseEventId]),
]);

export const creatorSchema = z
  .object({
    $schema: z.string().optional(),
    slug,
    name: text,
    headline: z.tuple([text, text]),
    roles: z.array(text).min(1),
    lede: text,
    pronoun: z.object({ subject: text, object: text, possessive: text }).strict(),
    readOn: isoDate,
    sources: z.array(z.object({ label: text, url: https, usedFor: text }).strict()).min(1),
    disclaimer: text,
    places: z.array(place),
    values: z.object({ title: text, body: text }).strict(),
    sponsorship: z.object({ title: text, body: text }).strict(),
    stations: z.array(station).min(1),
    oseBrand: oseBrand.optional(),
    events: z.array(eventLink).optional(),
    campaigns: z.array(campaignLink).optional(),
    privateNames: z.array(text).optional(),
    // How the stations are laid out (default dial), in what order (default the
    // file's), which sections show (default all) and whether a TV board is
    // built beside the pages (default page: none).
    layout: z.enum(LAYOUTS).optional(),
    stationOrder: z.enum(STATION_ORDERS).optional(),
    display: z.enum(DISPLAYS).optional(),
    sections: z.object(Object.fromEntries(SECTIONS.map((k) => [k, z.boolean().optional()]))).strict().optional(),
    schedule: z
      .object({ intro: text, source: text, rows: z.array(scheduleRow) })
      .strict()
      .optional(),
  })
  .strict();

export const catalogSchema = z
  .object({
    about: text,
    categories: z
      .array(
        z
          .object({
            id: slug,
            name: text,
            freq,
            covers: text,
            eventKinds: z.array(text),
            status: z.enum(['future']).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const validZone = (tz) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Everything wrong with one programme slot, as readable lines. */
function slotProblems(where, s, cat) {
  const out = [];
  const needsDay = s.cadence === 'weekly' || s.cadence === 'biweekly' || s.cadence === 'monthly';
  if (needsDay && !s.day) out.push(`${where}: a ${s.cadence} slot needs a day`);
  if (!needsDay && s.day) out.push(`${where}: a ${s.cadence} slot takes no day`);
  if (s.cadence === 'monthly' && !s.week) out.push(`${where}: a monthly slot needs a week (first ... last)`);
  if (s.cadence !== 'monthly' && s.week) out.push(`${where}: only a monthly slot takes a week`);
  if (s.cadence === 'as-announced' && s.time) out.push(`${where}: an as-announced slot has no fixed time`);
  if (s.cadence !== 'as-announced' && !s.time) out.push(`${where}: a ${s.cadence} slot needs a time`);
  if (s.time && !s.timezone) out.push(`${where}: a slot with a time needs its timezone`);
  if (s.timezone && !validZone(s.timezone)) out.push(`${where}: unknown timezone "${s.timezone}"`);
  if (cat && !cat.eventKinds.includes(s.kind)) {
    out.push(`${where}: kind "${s.kind}" is not one of ${cat.id}'s event kinds (${cat.eventKinds.join(', ') || 'none'})`);
  }
  return out;
}

/**
 * Everything wrong with one creator file against the catalog, as readable lines.
 * An empty list means the file may be built.
 */
export function creatorProblems(creator, catalog) {
  const parsed = creatorSchema.safeParse(creator);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  const problems = [];
  // Sources are the page's citations: while the file lists any, they show.
  if (creator.sections?.sources === false && creator.sources.length) problems.push('sections.sources: sources cannot be hidden while the file lists any');
  const ids = new Set();
  const cats = new Map();
  for (const s of creator.stations) {
    if (ids.has(s.id)) problems.push(`stations.${s.id}: station id used twice`);
    ids.add(s.id);
    const cat = catalog.categories.find((k) => k.id === (s.category ?? s.id));
    if (!cat) problems.push(`stations.${s.id}: category "${s.category ?? s.id}" is not in categories.json`);
    else if (cat.status === 'future') problems.push(`stations.${s.id}: category "${cat.id}" is not open yet`);
    cats.set(s.id, cat);
  }

  // Places sit on a station the creator has.
  creator.places.forEach((p, i) => {
    if (!Array.isArray(p) && p.station && !ids.has(p.station)) problems.push(`places.${i}: station "${p.station}" is not one of the creator's stations`);
  });

  // Every event and campaign lives on a frequency the creator has, and may show
  // on others too. Lead already shows everything, so it is never listed in `also`.
  const events = creator.events ?? [];
  const onAir = new Set();
  const seen = new Set();
  const leadIds = new Set(creator.stations.filter((s) => (s.category ?? s.id) === 'lead').map((s) => s.id));
  const alsoProblems = (where, link) => {
    const out = [];
    const listed = link.also ?? [];
    listed.forEach((id, k) => {
      if (!ids.has(id)) out.push(`${where}: also "${id}" is not one of the creator's stations`);
      else if (id === link.frequency) out.push(`${where}: also "${id}" is already its frequency`);
      else if (leadIds.has(id)) out.push(`${where}: also "${id}" is Lead, which shows every station already`);
      if (listed.indexOf(id) !== k) out.push(`${where}: also "${id}" is listed twice`);
    });
    return out;
  };
  events.forEach((e, i) => {
    if (!ids.has(e.frequency)) problems.push(`events.${i}: frequency "${e.frequency}" is not one of the creator's stations`);
    else onAir.add(e.frequency);
    problems.push(...alsoProblems(`events.${i}`, e));
    for (const id of e.also ?? []) if (ids.has(id)) onAir.add(id);
    if (seen.has(e.oseEventId)) problems.push(`events.${i}: ${e.oseEventId} is linked twice (list its other stations in also)`);
    seen.add(e.oseEventId);
    if (e.intent === 'pop-up' && !e.until) problems.push(`events.${i}: a pop-up needs the end of its window (until)`);
    if (e.intent !== 'pop-up' && e.until) problems.push(`events.${i}: only a pop-up has an until`);
  });
  (creator.campaigns ?? []).forEach((c, i) => {
    if (!ids.has(c.frequency)) problems.push(`campaigns.${i}: frequency "${c.frequency}" is not one of the creator's stations`);
    problems.push(...alsoProblems(`campaigns.${i}`, c));
  });
  if (events.length && !creator.oseBrand) problems.push('oseBrand: needed once events are linked (the OSE brand they live on)');

  // Purposeful and scheduled: a frequency with events or a programme states its why.
  for (const s of creator.stations) {
    (s.programme ?? []).forEach((slotDef, i) => problems.push(...slotProblems(`stations.${s.id}.programme.${i}`, slotDef, cats.get(s.id))));
    if ((onAir.has(s.id) || (s.programme ?? []).length) && !s.why) {
      problems.push(`stations.${s.id}: a frequency with events or a programme needs its why`);
    }
  }

  // A schedule row that names an OSE event names a linked one.
  (creator.schedule?.rows ?? []).forEach((r, i) => {
    if (r.length === 5 && !seen.has(r[4])) problems.push(`schedule.rows.${i}: ${r[4]} is not in events`);
  });
  return problems;
}
