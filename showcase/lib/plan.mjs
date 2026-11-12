// A seed plan: the upcoming OSE events a fixture creator links, described by
// day rather than by date, so the same plan seeds a local OSE worker
// (seed-local.mjs) and stands in for OSE in the tests. Pure: no I/O.
import { WEEKDAYS } from './schema.mjs';
import { todayIn } from './schedule.mjs';

const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekdayIndex = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;

/**
 * The date a plan entry falls on, from today in its timezone:
 *   { weekday, weeks }  the weekday's next date strictly after today, then `weeks - 1` weeks on
 *                       (weeks 0 or less: that many weeks back from the next one)
 *   { days }            today plus `days`
 */
export function planDate(on, now, timeZone = 'UTC') {
  const today = todayIn(now, timeZone);
  if (typeof on.days === 'number') return addDays(today, on.days);
  const want = WEEKDAYS.indexOf(on.weekday);
  if (want < 0) throw new Error(`plan: unknown weekday ${on.weekday}`);
  const ahead = ((want - weekdayIndex(today) + 7) % 7) || 7;
  return addDays(today, ahead + ((on.weeks ?? 1) - 1) * 7);
}

/** The UTC instant of a local date and HH:MM in a timezone. */
export function zonedInstant(isoDate, hhmm, timeZone) {
  const guess = Date.parse(`${isoDate}T${hhmm}:00Z`);
  // The zone's offset at that moment, applied once and checked once (DST edges).
  const offset = (t) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t).toISOString().replace('.000Z', 'Z');
}
