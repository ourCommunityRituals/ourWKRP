// The contract for creator files and the station catalog.
import { z } from 'zod';
import { safeHttpsUrl } from './showcase.mjs';

const text = z.string().trim().min(1).max(2000);
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase words joined by hyphens');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const https = z.string().refine((u) => safeHttpsUrl(u) !== null, 'must be an https: URL');
const freq = z.number().min(88).max(108);

const event = z
  .object({
    title: text,
    date: isoDate.optional(),
    kind: text,
    price: z.string().optional(),
    location: text.optional(),
    demo: z.enum(['high', 'medium', 'low']),
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
    event: event.nullable(),
  })
  .strict();

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
    places: z.array(z.tuple([text, text])),
    values: z.object({ title: text, body: text }).strict(),
    sponsorship: z.object({ title: text, body: text }).strict(),
    stations: z.array(station).min(1),
    schedule: z
      .object({ intro: text, source: text, rows: z.array(z.tuple([isoDate, text, z.string(), text])) })
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

/**
 * Everything wrong with one creator file against the catalog, as readable lines.
 * An empty list means the file may be built.
 */
export function creatorProblems(creator, catalog) {
  const parsed = creatorSchema.safeParse(creator);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  const problems = [];
  const ids = new Set();
  for (const s of creator.stations) {
    if (ids.has(s.id)) problems.push(`stations.${s.id}: station id used twice`);
    ids.add(s.id);
    const cat = catalog.categories.find((k) => k.id === (s.category ?? s.id));
    if (!cat) problems.push(`stations.${s.id}: category "${s.category ?? s.id}" is not in categories.json`);
    else if (cat.status === 'future') problems.push(`stations.${s.id}: category "${cat.id}" is not open yet`);
  }
  return problems;
}
