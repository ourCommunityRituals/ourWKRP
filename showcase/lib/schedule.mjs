// A frequency's programme and its events: pure functions, no I/O.
//
// A frequency is purposeful and scheduled (owner, 2026-11-12). Its programme is
// a list of slots in the creator file; its events are OSE events linked to it,
// each with an intent. "On air" is built from slot fields only. Events read as
// "One time only", "Pop-up", "Trying this out" or as a programme date.
import { WEEKDAYS } from './schema.mjs';

export const INTENT_LABELS = {
  'one-off': 'One time only',
  'pop-up': 'Pop-up',
  trial: 'Trying this out',
  programme: 'On air',
};

export const MODE_LABELS = { online: 'Online', in_person: 'In person', both: 'Online and in person' };

const CAP = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The local date, weekday and time of a UTC instant in a timezone. */
export function localParts(instant, timeZone) {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'long',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday.toLowerCase(), time: `${parts.hour}:${parts.minute}` };
}

const weekdayOf = (isoDate) => WEEKDAYS[(new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7];

/** When an OSE event happens, in its own timezone. A date-only event has no time. */
export function eventWhen(ev, timeZone = ev.timezone || 'UTC') {
  if (ev.startsAt) {
    const p = localParts(ev.startsAt, timeZone);
    if (p) return p;
  }
  if (!ev.startDate) return null;
  return { date: ev.startDate, weekday: weekdayOf(ev.startDate), time: null };
}

/** Today's date in a timezone, as YYYY-MM-DD. */
export const todayIn = (now, timeZone = 'UTC') => localParts(now, timeZone)?.date ?? new Date(now).toISOString().slice(0, 10);

/** An event is past once its last day is over where it happens. */
export function isPast(ev, now) {
  const last = ev.endDate || eventWhen(ev)?.date;
  if (!last) return true; // no date at all: never shown as upcoming
  return last < todayIn(now, ev.timezone || 'UTC');
}

/** "17:00" reads "5 pm"; "17:30" reads "5:30 pm". */
export function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${suffix}`;
}

const zoneName = (tz) => (tz ? `${tz.split('/').pop().replace(/_/g, ' ')} time` : '');

/** Which week of its month a date falls in: first ... fourth, and whether it is the last. */
function weekOfMonth(isoDate) {
  const day = Number(isoDate.slice(8, 10));
  const [y, m] = isoDate.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { ordinal: ['first', 'second', 'third', 'fourth', 'fifth'][Math.floor((day - 1) / 7)], last: day + 7 > daysInMonth };
}

/** Does an event fall on a slot: its cadence, day and time, read in the slot's timezone. */
export function slotMatches(slot, ev) {
  const when = eventWhen(ev, slot.timezone || ev.timezone || 'UTC');
  if (!when) return false;
  if (slot.time && when.time !== slot.time) return false;
  switch (slot.cadence) {
    case 'daily-weekdays':
      return WEEKDAYS.indexOf(when.weekday) < 5;
    case 'weekly':
    case 'biweekly':
      return when.weekday === slot.day;
    case 'monthly': {
      if (when.weekday !== slot.day) return false;
      const w = weekOfMonth(when.date);
      return slot.week === 'last' ? w.last : w.ordinal === slot.week;
    }
    case 'as-announced':
      return true;
    default:
      return false;
  }
}

/** The "On air" line for a slot, built from the slot's own fields and nothing else. */
export function onAirText(slot) {
  const day = slot.day ? CAP(slot.day) : '';
  const when = {
    'daily-weekdays': 'Mondays to Fridays',
    weekly: `Every ${day}`,
    biweekly: `Every other ${day}`,
    monthly: `${CAP(slot.week ?? '')} ${day} of the month`,
    'as-announced': 'As announced',
  }[slot.cadence];
  const time = slot.time ? `, ${fmtTime(slot.time)} (${zoneName(slot.timezone)})` : '';
  const parts = [`${when}${time}`, MODE_LABELS[slot.mode], slot.kind];
  if (slot.purpose) parts.push(slot.purpose);
  return parts.join(' · ');
}

/** How an event's date and time read on a page. */
export function whenText(ev, link) {
  const w = eventWhen(ev);
  if (!w) return 'Date to be announced';
  const date = new Date(`${w.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (!w.time) return date;
  const end = link?.intent === 'pop-up' && link.until ? ` to ${fmtTime(link.until)}` : '';
  return `${date}, ${fmtTime(w.time)}${end} (${zoneName(ev.timezone)})`;
}

/**
 * One frequency's schedule: its "On air" slots, each with its next programme
 * date, and every upcoming event on it, soonest first. Lead is the whole dial:
 * it lists every frequency's events. `problems` are reasons the build stops.
 *
 * @param {{id: string, programme?: object[]}} station
 * @param {{link: object, event: object}[]} linked  every public OSE event the creator links
 * @param {Date|number} now
 */
export function stationSchedule(station, linked, now, { isLead = false } = {}) {
  const problems = [];
  const mine = linked.filter(({ link }) => isLead || link.frequency === station.id);
  const upcoming = mine.filter(({ event }) => !isPast(event, now)).sort(soonestFirst);
  const slots = isLead ? [] : (station.programme ?? []);

  // Only what will show is held to the programme: a past event is not on the
  // page, so a programme that has since moved never stops a later build.
  for (const { link, event } of upcoming) {
    const where = `${link.frequency}: ${link.oseEventId}`;
    if (link.intent === 'pop-up' && !eventWhen(event)?.time) problems.push(`${where}: a pop-up needs a start time on its OSE event`);
    if (link.intent !== 'programme' || isLead) continue;
    const own = (station.programme ?? []).filter((s) => slotMatches(s, event));
    if (!own.length) problems.push(`${where}: a programme event matches none of its frequency's slots`);
    if (event.attendanceMode) {
      for (const s of own) if (s.mode !== event.attendanceMode) problems.push(`${where}: its mode (${event.attendanceMode}) differs from its slot's (${s.mode})`);
    }
  }

  const onAir = slots.map((slot) => {
    // Only programme events stand under "On air": a one-off, pop-up or trial never does.
    const next = upcoming.find(({ link, event }) => link.intent === 'programme' && slotMatches(slot, event));
    return { slot, text: onAirText(slot), next: next ?? null };
  });
  return { onAir, upcoming, problems };
}

// Soonest first: the UTC start when there is one, else the date (end of day).
const sortKey = (ev) => ev.startsAt || `${ev.startDate ?? '9999-12-31'}T23:59:59Z`;

/** Order linked events soonest first; every list of events on every page uses it. */
export const soonestFirst = (a, b) => sortKey(a.event).localeCompare(sortKey(b.event));

/** The programme slot a programme event stands on, or null for any other intent. */
export function slotOf(station, link, event) {
  if (link.intent !== 'programme') return null;
  return (station.programme ?? []).find((s) => slotMatches(s, event)) ?? null;
}
