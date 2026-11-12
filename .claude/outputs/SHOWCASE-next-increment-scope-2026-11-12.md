# Creator showcase: the next increment (scope, not built)

Written 2026-11-12, for the owner to approve before any build. It follows the container in
ourCommunityRituals/ourWKRP#106 (`showcase/`) and changes nothing in it.

This repository is public, so this plan names no real creator. "Creator #1" is the first, private instance.
Her own station-by-station mapping is kept outside the repository with her creator file.

## The goal, in the owner's words

> [The creator] will be able to have a 5W page with links to digital qr codes for each category page and then can schedule events to hold workshops, teaching, digital pop ups, links to online store, schools, and all time products, etc.

Two additions, later the same day:

> This is how her followers can interact with more and find her in each bucket as they have their own advertising / marketing ad vehicle for those she wants to work with.

> Next is the customizability of the page itself to what ever display desired.

Sections 5 and 6 cover them.

## The short answer

Almost everything this needs already exists in OurSharedEvents (OSE). The next increment is mostly ourWKRP (OW) **reading** OSE, not new OSE features.

- **5W:** OSE events already carry 5W fields: `what_short`, `who_host`, `why_purpose`, `how_details`, `where_address`, plus the date and time. That is migration `0029_events_5w_and_corridor.sql`. The fields are writable on create and update, and they are in the public projection.
- **Digital QR codes:** OSE already issues both kinds per event. `/q/<token>` comes from a poster placement and is tracking. `/s/<code>` comes from the poster's codes and is routing. The public `GET /api/v2/events/:id/poster-bundle?deployment=<placement id>` returns both. No new path is needed.
- **Scheduling:** an OSE event is the home. OSE already has create, the 5W fields, the event-type catalog, repeat (a draft copy on a new date), a per-event `.ics` file and a public list by brand.
  The real gap is **who may create**. OSE admin is founder-only (owner, 2026-10-07). A creator or organizer of her own brand waits on the tenant-boundary chain (OSE-1446 and the tickets after it).
- **Store, schools, products:** these are not events. They become typed `https` links in the creator file, shown per station. They are not tracked, unless the owner chooses otherwise (question 4).
- **Each station as a partner vehicle:** this is OSE's sponsor model as it stands. A sponsor backs events and appears only with two-sided consent. Sponsors that back a whole station group under one OSE **campaign**. The station page shows what OSE's public sponsor bundle already returns, and no sponsor list is kept in OW.
- **Customizing the page:** the look stays on the locked `@ocr/ui` tokens. A brand's colours come only as a `[data-brand]` block from the white-label pipeline. Layout and display start as a **fixed menu of safe options** in the creator file, each passing the accessibility gates. Self-serve editing comes later.

## What exists today (evidence)

| Need | Where it is | Notes |
|---|---|---|
| Station layout | OW#106 `showcase/lib/render.mjs`, `categories.json` | One page per creator; stations are tabs (`#teach`), not pages. |
| Creator facts | `showcase/creators/<slug>.json` (git-ignored) | `places` holds label and note pairs with **no URL**. `sources` holds https URLs, but as citations ("used for"), not as links for a visitor. `schedule` is a table copied from her public pages. |
| Event 5W | OSE `migrations/0029_events_5w_and_corridor.sql`; `handlers/events.ts` (create and update, length limits) | `who_host` is a display name: the presenter who opted in, the one named exception to "never who". |
| Public event list by brand | OSE `GET /api/v2/events?brand=<id>` (`handlers/events.ts`) | Active events only, through the public allowlist (`lib/public-event-projection.ts`). |
| Tracking codes | OSE `GET /q/:token`, placements `POST /api/v2/admin/events/:id/poster-deployments` | One token per placement. A scan is counted and feeds the SharedReport. |
| Routing codes | OSE `GET /s/:code`, poster codes `PUT /api/v2/admin/events/:id/poster-codes` (`lib/poster-codes.ts`) | Kinds: event page, tickets, external registration, sign up, donate, newsletter, menu, `ow` (music), league, other. Per event, **3 / 5 / 8 codes** (free / mid / enterprise), counting the event-page code. |
| Both, publicly | OSE `GET /api/v2/events/:id/poster-bundle?deployment=<id>` | Returns `slots` (`/s/` links) and `/q/` links for that placement. Refused (403) while the event's state allows no poster (`assertRenderable`). |
| Calendar | OSE `GET /events/:id/calendar.ics` | Per event only. There is no feed of a brand's events. |
| Recurring classes | OSE `POST /api/v2/admin/events/:id/repeat` | A draft copy on a new date, carrying nothing about who took part. |
| Reports | OSE SharedReport, signed link; `POST /api/v2/events/shared-reports/batch` (WKRP service token) | Already counts only, with the floor applied. |
| OW to OSE link | OW `dj_sets.event_id` (#102 requires the OSE id shape) | OW already keys its own rows to OSE event ids. |

## 1. What a 5W page means, against the station layout

Two levels, each answering the same five questions plus How:

| | Creator page (the dial) | Station page (one category) |
|---|---|---|
| **Who** | The creator, by the name she publishes under. She is the opted-in presenter. | Her role on this station (the station's eyebrow, for example "Founder and teacher"). |
| **What** | Her stations, in one line each. | The station's intro and what it covers (catalog `covers`). |
| **When** | The next few events across every station, read from OSE. | This station's upcoming events, read from OSE. Never typed into the creator file once an event is linked. |
| **Where** | Online: her places. Live: each event's `where_address`. | The places for this station, plus each event's `where_address`. An event's area on the map is OSE's H3 cell. |
| **Why** | The values section that exists today ("How many, never who."). | The station's purpose. That is a new field (`why`); today the closest is `choice`. |
| **How** | How to follow her: links, not accounts. | How to join each event: OSE's `how_details` and the digital codes (section 2). |

What changes in the layout:

- Each station becomes **its own page**: `out/<slug>/<station>/index.html`, with the tuner kept as navigation between them. One `<h1>` on each page; the creator page keeps its own `<h1>`.
  Its own page is what a QR code or a link in bio can point at. A `#teach` tab cannot be printed as a destination that a scan then counts.
- Event-level 5W (When, Where, How) comes **from OSE**. Station-level 5W (Who, What, Why) comes from the creator file. Nothing is kept in both places.
- The copied `schedule` table retires once its rows are real OSE events. Until then it stays, labelled as copied from her site.

## 2. How a station page links to digital QR codes

Only OSE's existing paths are used. **No new tracking path, in OSE or OW.**

For each upcoming OSE event linked to a station:

1. **One placement per surface the showcase publishes** (a poster deployment, `placement_type` `community`), for example "Showcase: Teach page".
   Its `/q/<token>` is the station page's main "go to this event" code. A scan or a tap is then one more counted placement in that event's SharedReport, next to the clip link and the door QR.
   This is exactly what the local seed already does with its "Clip link" placement.
2. **The event's own poster codes** (`/s/<code>`) for where to go next: the event page, plus at most two typed codes on the free plan (TICKETS, REGISTER, SIGN UP, MORE, MUSIC). They route and count clicks, and they never identify anyone.
3. The OW build reads both from the **public** poster bundle (`?deployment=<placement id>`). It draws each QR from the OSE URL with OW's own QR code, so the URL is the contract, not the picture.
   Every code is shown as a **link too**: on a phone the visitor taps it. The QR is for the other screen (a projector, a TV, a laptop being shown to a room).

Rules the build enforces (each one a born-red check):

- Every code on a page resolves to `<OSE origin>/q/…` or `<OSE origin>/s/…`. Any other host or path fails the build.
- The link text and the QR image carry the same URL.
- No form QR (register, check-in, survey) is shown as a tracked code. Forms are the identified side (FORMS_DB) and never feed the SharedReport.
  A station that wants registration uses OSE's form page as a plain link, or an external registration link through an `/s/` code.
- A station with no upcoming event shows no code. It never shows a code for a past event.

## 3. Where scheduling lives

**The OSE event, created by the creator or her organizer. OW reads it and never copies it.**

What OSE already offers covers the event itself:

- Create and edit, with the 5W fields, timezone and event type.
- Category → Type picker (`GET /api/v2/admin/event-types`). The catalog's `eventKinds` (class, workshop, talk, game night, set, pop-up) map onto it.
- Repeat, for a class that runs again.
- Poster codes, placements and the poster itself.
- SharedReport after the event, and sponsor requests with two-sided consent (`SPONSOR_ON_SHOW_SQL`).

What is missing, and where each piece should go:

| Gap | Proposal | Product |
|---|---|---|
| Which station an event belongs to | OW keeps the link: a list of `{ station, oseEventId }` in the creator file now, an OW table later (the same shape as `dj_sets.event_id`). OSE stays unaware of stations. | OW |
| The creator scheduling her own events | A brand per creator, and her admin membership on it (`admin_brand_memberships`). This is **blocked on the tenant-boundary chain** (OSE-1446 and the tickets after it), since admin is founder-only. Until then the owner creates her events on her brand, on local or staging. | OSE (owner decision) |
| Online-only events ("digital pop-ups", online classes) | OSE already allows an event with no place (location is optional). Such an event has no H3 cell, so it is off the map and opens by link (owner ruling, OSE-1643 q4). A scan still counts. Proposal: no OSE change; the station page says "Online". | none |
| One calendar for all her events | Optional: a brand-level `.ics` feed in OSE. Per-event `.ics` exists today. | OSE (optional) |

## 4. Store, schools and products as places and sources

"All time products" (always available) are not events, so they are not scheduled in OSE.

- `places` becomes a list of objects: `{ label, note, url, station, kind }`.
  - `url` is https only (the existing allowlist check).
  - `station` places it on a station page.
  - `kind` is one of `store`, `school`, `product`, `social`, `calendar`, `other`.
  - The current label and note pairs stay valid, with no link, until they are filled in.
- `sources` stays what it is: citations with a read date, listed at the foot of the page. A place may also be a source; the page does not merge them.
- Each station page lists its places under "Where". The creator page lists them all.
- **Tracking:** evergreen links are plain links, **not tracked** (OSE's `/s/` codes belong to an event).
  When a product goes to an event (a pop-up table), the event's own MORE or TICKETS code points at the store page, and that click is counted in the event's report. See question 4.
- **Sponsor rule:** her own store or school is not a sponsor. A third-party brand on her page is a sponsor, and it appears only through OSE's consent flow (sponsor accepted and organizer accepted), never as a plain link in the creator file.

## 5. Each station as a partner and ad vehicle

The owner's point: followers find her in each bucket, and each bucket is an advertising vehicle for the partners she chooses. That is OSE's sponsor model, applied per station. **No new sponsor model is needed.**

What OSE already gives, and the rules that come with it:

- **Two-sided consent.** A sponsor shows only when it accepted and the organizer accepted (`SPONSOR_ON_SHOW_SQL`, `lib/sponsor-card.ts`). The event must also have sponsors switched on (`useSponsors` in its settings; it is off by default).
  A sponsor asks to back an event (`POST /api/v2/sponsor/requests`), and the organizer approves or declines it (`POST /api/v2/admin/sponsor-requests/:id/respond`).
- **Placement.** On a page that shows an event title, the sponsor strip sits below the title and date and above the content.
- **Sponsors are not a filter.** A visitor can never search or sort by sponsor.
- **Reports.** Sponsors see floored counts only, never people. A partner's report is its slice of the event's SharedReport.
- **Campaign is one concept.** A partner that backs a whole station is a campaign (`campaigns`, migration 0039, already linked from sponsor placements) across that station's events. It is not a separate "station sponsor" object.
- **Entitlements.** How many sponsor and code slots an event carries is a tier entitlement (`lib/poster-codes.ts` limits).
- **Assets.** Bulk sponsor asset onboarding is OSM's job; OSE renders.

What the station page does:

- For each linked event, it reads the **public** sponsor bundle (`GET /api/v2/events/:id/sponsor-bundle?surface=public`). It shows the consented sponsors in the strip, below the event's title and date.
  A static page has no OSE surface of its own. Using `public` keeps it to exactly what the event page already shows.
- A station with a campaign shows that campaign's partner once, at the top of the station, under the same consent rule. OW reads it; it never stores or picks it.
- A partner's link is the event's own SPONSOR code (`/s/`), so a click is counted in the event's report like any other code.
- The page does **not** fire OSE's impression or click beacons in the first version (question 9).
- The creator chooses the partners she works with. In OSE terms, she or her organizer is the side that accepts.
  Until she has her own brand access (S6), the owner accepts on her behalf, on local or staging, the same as for her events.

Born-red checks: a sponsor with only one side's consent never appears; the strip is never above the title; no sponsor appears on a station with no linked event; a sponsor name never appears in any filter, search or sort control.

## 6. Customizing the page

"To whatever display desired" is read here as two separate layers, each with its own path.

**Colours and brand look (paint).**

- The `@ocr/ui` tokens are locked. The page holds no colour value of its own, as today: `theme.css` is generated from the pinned `@ocr/ui`, and `.ocr-design-check.json` is the ratchet.
- A creator's own colours come only as a Tier-3 `[data-brand="<slug>"]` block. `@ocr/ui` already has the hook (`brandBlocks()` in `css.ts`).
  That block is produced by the white-label pipeline: an intake form (in FORMS_DB, destroyed after processing), then a processor, then the OSM batch API (run by OCR staff only), then OA deploys it. It is **never hand-edited**.
- A brand block must pass contrast checks in both themes before it ships. The checker for brand sets does not exist yet; that is pipeline work outside this plan.
- Until a brand block exists, the page uses the OW brand, as today.

**Layout and display (structure).** Automatic first, self-serve later, starting as a fixed menu in the creator file:

| Option | Choices | Default |
|---|---|---|
| `layout` | `dial` (today's tuner) · `list` (stations in a column) · `grid` (station cards) | `dial` |
| `stationOrder` | The creator's order, or by the next event | The creator's order |
| `sections` | Show or hide: values, scatter ("where the work lives"), reports, schedule, sources | All shown; sources can never be hidden while `sources` is non-empty |
| `display` | `page` (phone to desktop) · `tv` (large type, no interaction, auto-advancing stations) | `page` |

Rules for every option:

- One `<h1>` per page, 44 px touch targets, input text at least 16 px, no sideways scroll at 375 px, and an axe pass in both themes.
- The e2e suite runs **every option**, not only the default (pairwise, not every combination).
- The `tv` display obeys OSE's rule that a display shows no counts: it shows events, codes and consented sponsors, and no report.
- An unknown option fails the build. It never falls back silently.

## Invariants check

| Invariant | How this plan keeps it |
|---|---|
| Never who, only how many | The only name shown is the creator's (an opted-in presenter) and `who_host`. Codes and links carry no visitor id. Reports stay OSE SharedReports. |
| Under-5 floor | Every count on a page comes from a SharedReport, which floors it. The page prints no count of its own. The existing `floorText` check stays. |
| Place, not person | Places are her public channels and event venues. An event's area is OSE's H3 cell. No visitor location is read or shown. |
| Sponsors need two-sided consent | Sponsors come only through OSE's consent flow and the public sponsor bundle, never from the creator file. The strip sits below the title and date. A sponsor is never a filter. |
| Display shows no counts | The `tv` display option shows no report and no count. |
| Design system | Colours come only from `@ocr/ui` tokens and a pipeline-made `[data-brand]` block. One `<h1>`, 44 px targets and contrast are checked for every layout option. |
| No cookies on public surfaces | A static page sets none. `/q` sets only the anonymous `ose_anon` token, as today. |
| Production closed | Everything here runs on local or staging. Nothing plans or sets `PRODUCTION_LIVE`. |
| No new tracking path | Only `/q` and `/s`, issued by OSE. |

## Proposed stories

The sizes are relative. Every story has the full pyramid in `showcase/TESTING.md`, is born red, and is tested at two layers: local OSE in CI, then OSE staging once OW serves the page.

| # | Story | Product | Needs | Size |
|---|---|---|---|---|
| S1 | **Creator contract v2.** `places` as typed https objects with `station` and `kind`; a `why` per station; `events: [{ station, oseEventId }]`. The schema and the fixture creator change, and old files still validate. | OW | #106 merged | S |
| S2 | **Station pages with 5W(+H).** One page per station plus the creator page. The tuner becomes navigation; one `<h1>` each; places under "Where". E2E at 375, 768 and 1280 px, in both themes. | OW | S1 | M |
| S3 | **Read events from OSE at build time.** `GET /api/v2/events?brand=` and `/api/v2/events/:id` fill When, Where and How. A missing or non-public event drops off the page and fails nothing. Integration against the pinned local OSE (`.ose-ref`). | OW | S1 | M |
| S4 | **Digital codes per station.** The seed creates one showcase placement per station event. The build reads the public poster bundle for that placement and shows the `/q` code plus the event's `/s` codes, as QR and link. Born-red checks are in section 2. | OW (uses OSE as is) | S2, S3 | M |
| S5 | **Retire the copied schedule.** Rows that are linked OSE events come from OSE; any others stay labelled as copied. | OW | S3 | S |
| S6 | **A creator schedules her own events.** A brand per creator and her membership. | OSE | The tenant-boundary chain (OSE-1446 …), owner | L, not now |
| S7 | **Serve the page from OW staging, private.** Behind an access gate, with the showcase CSP check live. | OW | S2; `stg.ourwkrp.com` TLS fixed (owner action) | M |
| S8 | *(Optional)* A brand calendar feed (`.ics` of a brand's public events). | OSE | none | S |
| S9 | **Partners per station.** Read each linked event's public sponsor bundle and show the strip below the title and date. A station campaign's partner shows once, at the top of the station. The partner link is the event's SPONSOR `/s/` code. Born-red checks are in section 5. | OW (uses OSE as is) | S3, S4 | M |
| S10 | **Layout and display menu.** `layout`, `stationOrder`, `sections` and `display` in the creator contract. Each option is rendered and run through the e2e and accessibility set; an unknown option fails the build. | OW | S2 | M |
| S11 | **TV display option.** Auto-advancing stations, large type, no counts, codes and consented sponsors only. | OW | S10, S4 | S |
| S12 | **A creator's own colours.** The page takes a pipeline-made `[data-brand]` block from the pinned `@ocr/ui`. It waits on the white-label pipeline (intake, processor, OSM, OA) and on a contrast checker for brand sets. OW only consumes the block. | OW; the pipeline is OSM and OA | The white-label pipeline | S here; L for the pipeline, not now |

The recommended order:
1. S1.
2. S2 and S3 in parallel.
3. S4, then S5.
4. S9 and S10 in parallel, then S11.

S6, S7 and S12 wait on their prerequisites, and S8 comes only if the owner wants it.
S1 to S5 and S9 to S11 need no OSE code change.

## Questions for the owner

1. **Who creates the creator's events, for now?** (a) You, on her brand, on local or staging, until the tenant chain lands (recommended). (b) Pull S6 forward, which puts the tenant-boundary chain first.
2. **Station pages:** separate pages per station (recommended, so a code can point at one), or keep one page with tabs?
3. **Online-only events in OSE:** an event with no place, off the map and opened by link, with scans counted (recommended)? Or keep online moments out of OSE?
4. **Evergreen links (store, school, products):** plain and untracked (recommended)? Or should they be counted? Counting needs a decision on where, because `/s/` codes belong to an event today.
5. **Plan tier for the showcase brand:** free (3 codes per event, counting the event page) or mid (5)? This decides how many "go next" codes a station event can carry.
6. **The brand calendar feed (S8):** wanted now, later, or not at all?
7. **Where the page is shown:** stay a privately shared static page (today), or serve it from OW staging behind a gate (S7)? S7 waits on the staging TLS fix either way.
8. **A partner for a whole station:** an OSE campaign across that station's events (recommended, since campaign is one concept)? Or only per-event sponsors at first?
9. **Partner reporting from the showcase page:** first version without impression and click beacons, so only the SPONSOR `/s/` click is counted (recommended)? Or should the page fire OSE's impression beacons? Those are counted per event and are new traffic from an OW page.
10. **The layout menu:** are `dial`, `list` and `grid`, plus a `tv` display, the right first set? Is anything missing that "whatever display desired" meant, for example an embed for her own site?
11. **A creator's own colours:** wait for the white-label pipeline (recommended)? Or stay on the OW brand for creator #1 until then?
