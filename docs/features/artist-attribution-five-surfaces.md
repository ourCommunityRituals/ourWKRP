# Artist Attribution Across the Five Surfaces

**Status:** Architecture — substrate built, generalization not started
**Products:** OSE (surfaces + events) · OW (attribution + catalog) — hybrid
**Last updated:** 2026-11-18 (voting follows the owner's decisions; `playback_events` exists: migration 0011, OW-219)
**Companion:** `fist-of-five-competition.md` (FOF is a *format* on top of this, not a peer)

## What this is

One attribution model, worn by every artist type, delivered through OSE's five
existing surfaces (**Poster · Admin · Display · Public · SharedReport**), with
Fist of Five as the first *tourney-series format* built on top.

Honest state: the FOF game (teams, votes, belts) is *not built*. What is built —
and what this doc generalizes — is the substrate: OW's attribution engine
(migration 0006: `dj_sets`, `set_tracks`, `attributions`), the uniform count
floor (`lib/count-floor.ts`, OW facet of OSE-665/683/711), the floored sponsor
report (`handlers/sponsor.ts`), and all five OSE surfaces.

## The two-dimension rule (settled 2026-08-26)

Artist type is **vocabulary** (data — cheap, open-ended). Attribution shape is
**schema** (code — closed set of three). A new discipline is a taxonomy row,
never a new code path.

| Attribution shape | A scan resolves to… | Artist types (starters) |
|---|---|---|
| **time-indexed** | the unit playing *now* (playback event) | DJ, Band |
| **session-indexed** | the bounded session itself | Theater, spoken word, academic talk |
| **object-indexed** | a specific physical thing | Sculpture, painting, print, art-fair table |

Bands are DJs with a setlist — same shape, different vocabulary. Theater is the
simplest shape (one code, one session, no sub-unit). Object-indexed already has
its mechanism: one `poster_deployments` row per table/piece (OSE-711-floored).

**Scan-resolution law (binding, from the CCR):** a time-indexed scan resolves by
**unit id carried in the code**, never by timestamp intersection — OSE's scan
path stores hour-bucket only (`qr-scan.ts`, privacy invariant) and that is not
negotiable. "New song, new code" = rotating *logical* vote key on a screen, one
static poster on the wall. Requires the `playback_events` table
(`id, set_id, track_id, started_at, ended_at, brand_id`) — the FOF doc's
`set_tracks` PK cannot express a replay and must not be used for dedup.

**Built (2026-11-17, OW-219):** `playback_events` exists (migration 0011). Each
`POST /api/sets/:id/tracks` by the set's own DJ closes the set's open event and
opens a new one in one D1 batch, on server time, and returns its id; a replay
is a new event. A unique partial index keeps at most one open event per set;
ending a set (or starting the DJ's next one) closes it. `GET /dj/:id/live`
names the open event as `now_playing`. `brand_id` is the owning DJ's brand.
Old `set_tracks` rows were not backfilled (they hold no replays). Votes are
not built yet.

**Voting decided (owner, 2026-11-17 and 2026-11-18; ADR-040 in the
OurSharedEvents repository).** Votes are stored on OurSharedEvents as counters
on objects, never on ourWKRP and never as a row per vote. Each play is one
object; ourWKRP keeps the link from its `playback_events` id to the object id.
The room screen shows the event's own scan code, not a rotating key and not a
code per song: the vote page lists the songs open now and each button carries
its object id. No tally is shown before the night is final or on any display,
and afterwards only the outcome is published, never a count. Where the lines
above and the tables below say "rotating vote key", or list counts drawn from
votes, the decision record wins.

## The five surfaces, per shape

| Surface | time-indexed (DJ/Band) | session-indexed (Theater) | object-indexed (Art) |
|---|---|---|---|
| **Poster** | one static QR (venue) | one QR per production/session | one QR per table/piece (`placement_label`) |
| **Admin** | event + set logging | event + session schedule | event + per-object deployments |
| **Display** | now-playing + rotating vote key (the screen CAN change; posters cannot) | act/scene state, cast card | piece spotlight rotation |
| **Public** | five W's + set archive | five W's + trailer (`what_video_url`) | five W's + gallery of pieces |
| **SharedReport** | floored: distinct listeners, top tracks, per-DJ, hourly | floored: per-session draw, return share | floored: per-placement draw (funnel: scans → looks → nods → sales) |

Every SharedReport cell is governed by the uniform floor (candidate article
#28): sub-K rows DROP, totals sum surviving buckets, lexicon per #27
(distinct/draw/displays — never unique/reach/attendance).

## Data flow — the surfaces PULL FROM OW

OSE never reimplements attribution; its surfaces are renderers over OW's API.
OW remains the sole system of record for attribution (`attributions`,
`dj_sets`/`playback_events`, catalog); OSE remains the sole system of record
for events, placements, sponsors, and the five surfaces.

- **Display/Public** pull now-playing + set/session state from OW
  (`handlers/events.ts` — the existing OSE-facing music endpoint).
- **SharedReport** pulls OW's *floored* aggregates (`handlers/sponsor.ts`
  shape) and composes them with OSE's own primitives (scans, sponsor displays,
  corridor density). OW floors BEFORE the data crosses — the boundary never
  receives an unfloored count.
- Every crossing obeys the cross-product boundary (#1-mirror + #7,
  `sanitizeForExport`, locked by
  `tests/security/cross-product-boundary.invariant.spec.ts`): listener
  identity never crosses; presenters (DJ, cast, artist — the named pole) cross
  by design.
- New pull endpoints added for theater/bands/art join `CROSS_PRODUCT_HANDLERS`
  in that spec the day they are written — the allowlist grows with the surface
  area, never behind it.

## Taxonomy work (rows, not code)

`event_type_registry` (OSE D1) needs the missing artist rows: theater
production, band night, gallery opening, art walk — reconciled with the brain
taxonomy (`event-taxonomy.yaml` has `dj_set`/`live_music`; DB has
`art_show`/`photo_gallery`; overlap today is 2 of 47/17 — the two registries
must converge before rows are added to either). Each row declares its
attribution shape as a field — the shape is the one thing the taxonomy does not
yet encode.

## FOF as tourney-series format

FOF is not a discipline; it is a **competition format** applied to any
time-indexed (later: any) discipline:

- **Series:** OSE `event_series` already auto-clusters recurring events
  (venue × dow × hour, ≥3) — monthly cards ARE a series; standings hang off it.
- **Teams/votes/belts:** net-new (per the FOF doc), built ONCE on
  `playback_events` — then a "theater tourney" (audience-choice one-act series)
  or "battle of the bands" is the same engine with a different taxonomy row.
- **Sponsors:** mutual acceptance (article #26) + share covenant (#25) apply
  unchanged; the tourney is just a high-draw series to sponsor.

## Sequencing (launch-priority compliant)

1. **Now (docs only):** this doc; taxonomy reconciliation plan. No code.
2. **Post-staging:** `playback_events` migration (OW) + unit-id in the scan
   contract (OSE — flagged while the QR work is still open).
3. **Then:** taxonomy rows + shape field; theater pilot (simplest shape) on the
   five surfaces with zero new attribution code.
4. **Then:** FOF engine (teams/votes/belts) as the tourney format — after the
   team test validates basics, per the FOF doc's own placement.
