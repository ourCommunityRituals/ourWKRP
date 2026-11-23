/**
 * Each play's vote on OurSharedEvents (OW-219; OSE ADR-040).
 *
 * Votes live on OurSharedEvents, never on ourWKRP: ourWKRP holds named people
 * and a vote is anonymous. When the DJ logs a song in a set that names an
 * OurSharedEvents event, this opens a song on that event's vote set there, and
 * closes the song that was playing. ourWKRP keeps only the link
 * (`playback_events.vote_object_id`). It sends OurSharedEvents the song's
 * label only: no ourWKRP id, no DJ, no contributor name.
 *
 * SWITCHED OFF BY DEFAULT. It runs only when every one of these is set:
 *   - OSE_VOTE_LINK = "on" (a [vars] value, off in every environment today);
 *   - OSE_VOTE_API_BASE, the OurSharedEvents origin (https only);
 *   - OSE_SERVICE_TOKEN_ID and OSE_SERVICE_TOKEN_SECRET, a Cloudflare Access
 *     service token the owner makes and sets as Worker secrets. No agent
 *     creates or reads it.
 * Production has none of them.
 *
 * NEVER IN THE DJ'S WAY. Each call waits at most LINK_TIMEOUT_MS. Any failure
 * (off, no answer, a refusal) leaves the play logged and the link empty, and
 * logs one line with a label and an HTTP status only: never the song, the
 * event or the token.
 *
 * The host still makes the event's vote set on OurSharedEvents and opens it
 * (ADR-040 decision 10: voting turns on when an admin opens a set). A song
 * added before that is refused there, and the link stays empty.
 */

import { log } from './logger';

export interface VoteLinkEnv {
  OSE_VOTE_LINK?: string;
  OSE_VOTE_API_BASE?: string;
  OSE_SERVICE_TOKEN_ID?: string;
  OSE_SERVICE_TOKEN_SECRET?: string;
}

/** How long one call to OurSharedEvents may take before the play goes on without it. */
export const LINK_TIMEOUT_MS = 2500;

/** OurSharedEvents' own limit is longer; a label past this is cut. */
export const LABEL_MAX = 120;

const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const OBJECT_ID = /^vobj_[0-9a-f]{32}$/;

/** The link runs only when it is switched on and fully configured. */
export function voteLinkEnabled(env: VoteLinkEnv): boolean {
  if (env.OSE_VOTE_LINK !== 'on') return false;
  if (!env.OSE_SERVICE_TOKEN_ID || !env.OSE_SERVICE_TOKEN_SECRET) return false;
  try {
    return new URL(env.OSE_VOTE_API_BASE ?? '').protocol === 'https:';
  } catch {
    return false;
  }
}

/** "Title by Artist", single-spaced, cut to LABEL_MAX characters. */
export function songLabel(name: string, artist: string | null): string {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  const label = artist && clean(artist) ? `${clean(name)} by ${clean(artist)}` : clean(name);
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label;
}

function votablesPath(env: VoteLinkEnv, eventId: string, tail: string): string {
  const base = new URL(env.OSE_VOTE_API_BASE as string);
  return `${base.origin}/api/v2/admin/events/${encodeURIComponent(eventId)}/votables${tail}`;
}

async function post(env: VoteLinkEnv, url: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Access-Client-Id': env.OSE_SERVICE_TOKEN_ID as string,
        'CF-Access-Client-Secret': env.OSE_SERVICE_TOKEN_SECRET as string,
      },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

function warn(step: string, status: number | null): void {
  log('OSE_VOTE_LINK_SKIPPED', { step, status });
}

/**
 * Add the song to the event's vote set on OurSharedEvents and open it. Returns
 * the object's id, or null when the link is off or anything is refused.
 */
export async function openSongVote(
  env: VoteLinkEnv,
  oseEventId: string | null,
  label: string
): Promise<string | null> {
  if (!voteLinkEnabled(env) || !oseEventId || !EVENT_ID.test(oseEventId) || !label) return null;
  const made = await post(env, votablesPath(env, oseEventId, '/objects'), { kind: 'song', label });
  if (!made || made.status !== 201) {
    warn('add', made?.status ?? null);
    return null;
  }
  const json = (await made.json().catch(() => null)) as { object?: { id?: unknown } } | null;
  const id = json?.object?.id;
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) {
    warn('add', made.status);
    return null;
  }
  const opened = await post(
    env,
    votablesPath(env, oseEventId, `/objects/${encodeURIComponent(id)}/open`),
    {}
  );
  if (!opened || opened.status !== 200) {
    warn('open', opened?.status ?? null);
    return null;
  }
  return id;
}

/** Close a song's vote on OurSharedEvents. Best effort: a failure is logged and ignored. */
export async function closeSongVote(
  env: VoteLinkEnv,
  oseEventId: string | null,
  objectId: string | null
): Promise<void> {
  if (!voteLinkEnabled(env) || !oseEventId || !EVENT_ID.test(oseEventId)) return;
  if (!objectId || !OBJECT_ID.test(objectId)) return;
  const res = await post(
    env,
    votablesPath(env, oseEventId, `/objects/${encodeURIComponent(objectId)}/close`),
    {}
  );
  if (!res || res.status !== 200) warn('close', res?.status ?? null);
}
