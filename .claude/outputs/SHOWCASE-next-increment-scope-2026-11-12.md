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

Sections 5 and 6 cover them. A third, the owner's decision:

> OW's natural space where it can be online or in reality. When creating an OW event, need to make that distinction

Section 3 covers it ("Online or in person").

## The short answer

Almost everything this needs already exists in OurSharedEvents (OSE). The next increment is mostly ourWKRP (OW) **reading** OSE, not new OSE features.

- **5W:** OSE events already carry 5W fields: `what_short`, `who_host`, `why_purpose`, `how_details`, `where_address`, plus the date and time. That is migration `0029_events_5w_and_corridor.sql`. The fields are writable on create and update, and they are in the public projection.
- **Digital QR codes:** OSE already issues both kinds per event. `/q/<token>` comes from a poster placement and is tracking. `/s/<code>` comes from the poster's codes and is routing. The public `GET /api/v2/events/:id/poster-bundle?deployment=<placement id>` returns both. No new path is needed.
- **Scheduling:** an OSE event is the home. OSE already has create, the 5W fields, the event-type catalog, repeat (a draft copy on a new date), a per-event `.ics` file and a public list by brand. A feed of all a brand's events is new (S8).
  The real gap is **who may create**. OSE admin is founder-only (owner, 2026-10-07). A creator or organizer of her own brand waits on the tenant-boundary chain (OSE-1446 and the tickets after it).
  The second gap is **online or in person**. The owner's decision is that every event says which it is, at creation. OSE has no such field today, so this is the one OSE schema change in the near-term stories (S13).
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
| **Where** | Online: her places. In person: each event's `where_address`. | The places for this station. Each event is marked **Online**, **In person** or **Both** (section 3). An in-person event shows its `where_address`, and its area on the map is OSE's H3 cell. |
| **Why** | The values section that exists today ("How many, never who."). | The station's purpose. That is a new field (`why`); today the closest is `choice`. |
| **How** | How to follow her: links, not accounts. | How to join each event: OSE's `how_details` and the digital codes (section 2). |

What changes in the layout:

- Each station becomes **its own page** (owner, 2026-11-12): `out/<slug>/<station>/index.html`, with the tuner kept as navigation between them.
  Today's `#teach` links keep working: the creator page sends a station hash on to that station's page. One `<h1>` on each page; the creator page keeps its own `<h1>`.
  Its own page is what a QR code or a link in bio can point at. A `#teach` tab cannot be printed as a destination that a scan then counts.
- Event-level 5W (When, Where, How) comes **from OSE**. Station-level 5W (Who, What, Why) comes from the creator file. Nothing is kept in both places.
- The copied `schedule` table retires once its rows are real OSE events. Until then it stays, labelled as copied from her site.

## 2. How a station page links to digital QR codes

Only OSE's existing paths are used. **No new tracking path, in OSE or OW.**

For each upcoming OSE event linked to a station:

1. **One placement per surface the showcase publishes** (a poster deployment, `placement_type` `community`), for example "Showcase: Teach page".
   Its `/q/<token>` is the station page's main "go to this event" code. A scan or a tap is then one more counted placement in that event's SharedReport, next to the clip link and the door QR.
   This is exactly what the local seed already does with its "Clip link" placement.
2. **The event's own poster codes** (`/s/<code>`) for where to go next: the event page, plus up to four typed codes on Mid (owner, 2026-11-12), for example TICKETS, REGISTER, SIGN UP, MORE, MUSIC or SPONSOR. They route and count clicks, and they never identify anyone.
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
| Which frequency an event or campaign is on | The frequency decides (owner, 2026-11-12). See "Frequency decides" below. | OW |
| The creator scheduling her own events | A brand per creator, and her admin membership on it (`admin_brand_memberships`). This is **blocked on the tenant-boundary chain** (OSE-1446 and the tickets after it), since admin is founder-only. Until then the owner creates her events on her brand, on local or staging. | OSE (owner decision) |
| Online or in person, chosen at creation (owner, 2026-11-12) | A required choice on every event, kept on the OSE event. See below. | OSE (S13) |
| One calendar for all her events | A brand-level `.ics` feed in OSE, in this increment (owner, 2026-11-12). Per-event `.ics` exists today. See S8. | OSE (S8) |

### Frequency decides (owner decision, 2026-11-12)

> Events and campaigns should be available and should be dictated on frequency

Confirmed by the owner, 2026-11-12: the station's frequency (Teach 89.1, Sound 97.3, and so on) is what places an event or a campaign, and each frequency has its own purpose and schedule. Each frequency makes **all** of its events and campaigns available, not one demo event each.

- **Every event and every campaign has one frequency**, chosen when it is made, just as online or in person is. An event also has an intent: one-off, pop-up, programme or trial (see "Four kinds of event" below).
  OW keeps the link, because OSE knows brands and events but not stations: `events: [{ frequency, oseEventId }]` and `campaigns: [{ frequency, oseCampaignId }]` in the creator file now, and an OW table later (the same shape as `dj_sets.event_id`).
  An OW creation flow (later, with S6) asks for the frequency and writes the OSE record and the OW link together.
- **The frequency decides where it shows.**
  - Its station page lists every upcoming event on that frequency, soonest first, with each event's codes and consented partners.
  - It shows every active campaign on that frequency at the top of the page.
  - The tuner, the TV view (S11) and the creator page's "When" are all read from the same links. Nothing is placed by hand.
- **Lead (the operator's view) is the whole dial.** It shows every frequency's events. A campaign set on Lead is a whole-creator campaign: a sponsor backing the season, not one station.
- **One frequency per event.** An event that serves two stations (a class that is also streamed) picks the one it belongs to. Lead still shows it.
  The catalog's `eventKinds` only suggests a frequency when an event is made, the same way an event type suggests poster codes. It never decides.
- **A frequency with nothing on it** still shows its station copy, places and links, and says that nothing is scheduled. It shows no codes and no partner.
- **Checks (born red):**
  - an event or campaign linked to an unknown frequency fails the build;
  - an event is never shown on a frequency it is not linked to (Lead excepted);
  - a past event never shows a code;
  - a campaign whose events are all past is not shown.

### A frequency is purposeful and scheduled (owner, 2026-11-12)

> purposeful, scheduled frequency

A frequency is more than a category label. Like a radio station, it has **a reason to be on air** and **a programme**: when it broadcasts, how often, and in what form. Events are the programme's occurrences, and campaigns back the programme. A follower tuning in should be able to read:

> **Teach · 89.1** · *Why:* free and pay-what-you-can skills for people the industry leaves out.
> *On air:* Mondays to Thursdays, 5 pm, online (the daily room) · first Saturday of the month, 10 am, in person (workshop).
> *Next:* … · *Backed by:* … (a consented campaign partner).

(This is an illustration, not creator #1's real copy.)

**Purposeful.**

- Every frequency in use states its **why** (the S1 `why` field, the 5W Why). A frequency with events but no why fails the build: nothing goes on air without a purpose.
- Each programme slot may add a one-line purpose of its own ("the daily room", "the monthly workshop").
- An event's Why is its own `why_purpose` when the event has one. Otherwise it is the slot's purpose, and failing that the frequency's.
- A campaign's place in the programme is its frequency and its window. A partner backs a purpose (a station's programme), not a page.

**Scheduled.**

- Each frequency in the creator file carries a **programme**, a list of slots. Each slot has:
  - `cadence`: `daily-weekdays` · `weekly` · `biweekly` · `monthly` · `as-announced`;
  - `day`, `time` and timezone;
  - `mode`: online, in person or both, the S13 values;
  - `kind`: a catalog `eventKinds` value.
- The page shows the programme as "On air", under When, above the list of upcoming events. A slot with no upcoming event says "next date to be announced". It never makes a date up.
- **The occurrences are OSE events,** one per date, as decided (one OSE record). The owner creates them on staging: one, then copies with **repeat** (`POST /api/v2/admin/events/:id/repeat`, a draft on a new date). Each copy is linked to the frequency in OW.
  Generating a whole programme's dates in one step is the bulk season intake (an intake form, a processor and an OSM batch), which is later work outside this plan.
- **OSE already has series, but only by detection.**
  - What exists: `event_series` (migration 0033: `cadence` weekly, biweekly or monthly, plus `day_of_week` and `hour_of_day`) and `events.series_id` (0034). A confirmed series feeds the SharedReport's trend across occurrences.
  - What is missing (checked 2026-11-12): series rows are written only by the auto-detector, and only once it finds 3 or more events at the same venue, day and hour. They start as `pending`, and no route lets an organizer confirm one, or declare one up front.
  - That rules out a new programme, and an online programme has no venue at all. S15 lets an organizer declare a series and attach its events. Its anchor is an event, not a venue, which suits online slots.
- **Checks (born red):**
  - an event linked to a frequency whose date and time match none of its slots is never shown as part of the programme; its intent (below) decides how it reads;
  - a slot's mode must equal the mode of each event attached to it;
  - "On air" text is built only from slot fields, never free text that could carry a name.

**Four kinds of event (owner, 2026-11-12).**

> this is what separates a one off, temperal event vs a purposeful event vs a let see and try and it may be more fluid.

The owner then added **pop-up** as a kind of its own.

Every event on a frequency has an **intent**, chosen when it is made, alongside its frequency and its mode:

| Intent | What it is | How the page reads it | Where it lives |
|---|---|---|---|
| `one-off` | A single, temporal moment that stands alone: one date, not part of a programme. A launch, a guest talk. | "One time only", with its date. No "next". | The OSE event; the OW link carries `intent`. No series. |
| `pop-up` | A short window that appears and goes. It is often inside someone else's event or space, or it is a digital pop-up online (a live shop session, a limited drop). It is often short notice, and often commerce or merch. | "Pop-up", with its window: date plus start and end time, and the host's place when in person. Never under "On air". | The OSE event, with a start and an end time, and the place the host gives. The OW link carries `intent`. No series. |
| `programme` | Purposeful: an occurrence of a frequency's scheduled slot. | Under "On air", as the slot's next date. | The OSE event, attached to the slot's declared series (S15). |
| `trial` | "Let's see and try": fluid, maybe repeated, not yet committed. Its timing and form may change from one try to the next. | "Trying this out", with its date. Never under "On air" and never promised as recurring. | The OSE event; the OW link carries `intent`. No series yet. |

- **A trial can become a programme.** When the creator decides it works, the owner declares a series from it (S15), adds the slot to the frequency's programme, and the trial's past occurrences join the series.
  The series trend then starts from the first try, so the partner and the creator see how it grew. A trial that stops is simply not repeated; nothing is deleted.
- **OSE's detector fits this:** three or more tries at the same venue, day and hour already produce a *suggested* series (`pending`). That is a prompt to promote, never a promotion on its own; the owner confirms.
- **Pop-ups in more detail:**
  - A pop-up can be online, in person or both (S13). An in-person pop-up at a host's event takes the host venue as its place: place, not person. It names the host only as the host chooses to be named on their own public event.
  - A pop-up that recurs on a fixed slot, like a monthly table, is a programme slot whose kind is `pop-up`. The intent `pop-up` is for the ones that are not scheduled.
  - The catalog kind `pop-up` (Wear) suggests this intent when an event is made. It never decides.
  - Its "go next" codes are usually the store: the event's MORE or TICKETS `/s/` code points at the shop. That is the one way a product click is counted (decision 4).
  - **A short-notice pop-up reaches the page only on a rebuild,** because the page is a privately shared file built from OSE (decision 7). Its own OSE event page and codes work as soon as it is active.
- **Campaigns follow the intent.** A partner can back:
  - a programme, for a season or its window;
  - a one-off, as a single event's sponsor (today's per-event placement);
  - a trial, as a pilot partner;
  - a pop-up, as its partner for that window (for example a collaborating artist's piece on the table).
  
  The page says which. A trial partner sees the same floored counts, and trials often read "Fewer than 5". That is the floor working, not a fault.
- **Checks (born red):**
  - an event without an intent fails the build;
  - a `trial`, `one-off` or `pop-up` never appears under "On air" or with a "next" date;
  - a `pop-up` without both a start and an end time fails the build;
  - a `programme` event must sit on a declared series and match a slot;
  - promoting a trial never changes its past occurrences' dates or counts.

**How campaigns follow the programme.** A campaign on a frequency backs that frequency's scheduled occurrences inside its window (campaign `status` active, paused or completed). Its partner's report is the floored per-occurrence counts plus the series trend: `campaign_summary` and the headcount trend at Mid depth.

### Her events on staging (owner decision, 2026-11-12)

The owner creates creator #1's events, on staging, through OSE admin, until she can have her own access (S6). What follows from that:

- **Her own brand, never `root`.** The `/events` list and the landing page read the `root` brand only (`dp.listEvents('root')` in `handlers/pages.ts`).
  On her own brand, her events leave the stock seed's pinned per-zip totals alone (`stock/totals.json`), and those totals are what the staging tests expect. OW reads her events with `GET /api/v2/events?brand=<her brand>`.
- **Staging is open.** Its owner chose no login gate, so robots are told not to crawl but anyone with a link can still open a page. Every page says "Testing purposes only."
  Her active events are therefore reachable by link and through the public brand list, even though `/events` does not show them.
- **Neutral until she says yes (owner, 2026-11-12, question 12).** Nothing OSE serves on staging names her or her ventures:
  - the event titles, `what_short`, `who_host`, `why_purpose` and `how_details`;
  - the brand's id and display name;
  - the placement labels and the targets of the poster codes. A code that would point at her store or school points at a neutral placeholder page instead.
  
  For example, "Data class (showcase demo)" and the brand `showcase-creator-1`. Her name, places and links appear only on the privately shared OW page, which carries them from her git-ignored creator file.
  When she agrees, the owner renames the events, sets `who_host` and repoints the codes. The event ids, the `/q` placements and the `/s` codes stay the same, so printed or shared codes keep working.
  A born-red check in S3 fails the build if any text read from staging OSE contains a name or a URL from the creator file's real-identity fields.
- **The page still uses demo visitors until she says yes.** SharedReports on the showcase page come from a local run labelled demo, as today.
  Staging events give the page real codes, 5W text and sponsor wiring. They give no real visitors, because nobody is invited to scan.
- **The admin steps** for each event:
  1. Create it, with its 5W fields and its online or in-person mode once S13 lands.
  2. Set its poster codes.
  3. Add one showcase placement per station page.
  4. Make it active.
  
  The OW seed script stays local-only. It never writes to staging, because its local-only check is part of the security layer in `showcase/TESTING.md`.

### Online or in person (owner decision, 2026-11-12)

OW's natural space covers both sides: a moment can happen online or in person. The station layout already has both sides (its `online` and `live` copy). When an event is created, the creator says which kind it is.

Today OSE has no such field. Online and virtual appear nowhere in the event schema or the handlers (checked 2026-11-12). An event without a location is only "no place given", which is not the same as "online".

The proposal, as story S13:

- **One event record, in OSE (owner, 2026-11-12).** OW never creates a second, OW-only event. OW's own rows refer to it by the OSE event id, as `dj_sets.event_id` already does. An OW creation flow (later, with S6) writes the OSE event through OSE's API, so the decision is made where the event is made.
- **A new field, `attendance_mode`,** required on create, with three values (owner, 2026-11-12: `both` is allowed):
  - `in_person`: needs a place. The event gets its H3 cell and shows on the map, as today.
  - `online`: no place. It has no cell, so it is off the map and opens by link (owner ruling, OSE-1643 q4). Its `/q` and `/s` codes still count, as they do for any event.
    **Link only for now (owner, 2026-11-12):** it is also left out of `/events`, the landing page and the sitemap.
    Today those lists do not check for a place: `listEvents` filters on published, brand, active and `listed_from` (the publish grace) only. So an active `root` event with no location would show. S13 adds that rule, with a born-red check.
    `place_kind` (migration 0106: a business or an address) describes the spot for the zoomed map and stays as it is. The mode is a separate field.
    The brand API (`GET /api/v2/events?brand=`), which OW reads, still returns it.
  - `both`: a place and an online side. It is on the map by its place.

  The field follows schema.org's attendance modes (offline, online, mixed), so event pages can later carry that structured data.
- **Existing events** become `in_person` in the migration, because every OSE event so far is a physical one. A dry run on staging confirms that before production.
- **The join link is never public.** For example, the meeting link for a paid class stays off every public OSE response. Visitors reach it through the event's REGISTER, TICKETS or SIGN UP code (`/s/`), which points at the creator's own page, and that page hands out the link.
  So OSE stores no meeting URL, and the public projection gains only `attendance_mode`.
- **Place, not person** holds: an online event has no place at all, never the visitor's. A placement for an online event (for example "Clip link") is a community placement, as in the seed.
- **What changes in OSE:** the migration, create and update validation (`in_person` and `both` need a location), the public projection allowlist and its contract snapshot, the admin event form, and the event page label ("Online", "In person", "Online and in person").
- **What changes in OW:** the station page and the TV view show the label, read from OSE (S3). The seed sets the mode for each demo event.

## 4. Store, schools and products as places and sources

"All time products" (always available) are not events, so they are not scheduled in OSE.

- `places` becomes a list of objects: `{ label, note, url, station, kind }`.
  - `url` is https only (the existing allowlist check).
  - `station` places it on a station page.
  - `kind` is one of `store`, `school`, `product`, `social`, `calendar`, `other`.
  - The current label and note pairs stay valid, with no link, until they are filled in.
- `sources` stays what it is: citations with a read date, listed at the foot of the page. A place may also be a source; the page does not merge them.
- Each station page lists its places under "Where". The creator page lists them all.
- **Tracking (owner, 2026-11-12):** evergreen links are plain links, **not counted** (OSE's `/s/` codes belong to an event).
  They carry no tracking parameters and fire no beacon, and the page adds nothing to the URL the creator file gives. A born-red check in S1 fails the build if a place URL is rewritten or redirected through any counting path.
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
- **Campaign is one concept (owner, 2026-11-12: a station partner is a campaign).** A partner that backs a whole station is an OSE campaign across that station's events. It is not a separate "station sponsor" object.
  What exists: the `campaigns` table (migration 0039: brand-scoped, with a title and a status) and `sponsor_placement.campaign_id` (0067). The SharedReport's `campaign_summary` section is shown at Mid depth (`lib/report-depth.ts`), and the showcase brand is on Mid.
  What does not exist (checked 2026-11-12): no route creates a campaign (nothing in the worker inserts into `campaigns`), and the public sponsor bundle does not say which campaign a placement belongs to. S14 adds both.
- **Entitlements.** How many sponsor and code slots an event carries is a tier entitlement (`lib/poster-codes.ts` limits).
- **Assets.** Bulk sponsor asset onboarding is OSM's job; OSE renders.

What the station page does:

- For each linked event, it reads the **public** sponsor bundle (`GET /api/v2/events/:id/sponsor-bundle?surface=public`). It shows the consented sponsors in the strip, below the event's title and date.
  A static page has no OSE surface of its own. Using `public` keeps it to exactly what the event page already shows.
- A frequency with a campaign shows that campaign's partner once, at the top of its station page. The campaign's frequency comes from the creator file's `campaigns` link (section 3, "Frequency decides").
  The partner shows only if the public sponsor bundle of at least one upcoming station event lists it under that campaign, which means both sides consented on that placement. OW never stores the sponsor or picks it.
- A partner's link is the event's own SPONSOR code (`/s/`), so a click is counted in the event's report like any other code.
- The page does **not** fire OSE's impression or click beacons (owner, 2026-11-12: clicks only for now). A partner's count from the showcase is the click on the event's SPONSOR `/s/` code, floored like any other count. A born-red check fails the build if the page contains a request to `/impression` or `/click`.
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

**Layout and display (structure).** Automatic first, self-serve later, starting as a fixed menu in the creator file. The first set is confirmed (owner, 2026-11-12): dial, list and grid layouts, plus page and TV displays. An embed is not in it.

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
| S1 | **Creator contract v2.** `places` as typed https objects with `station` and `kind`; a `why` per station; `events: [{ frequency, oseEventId, intent }]` with intent `one-off`, `pop-up`, `programme` or `trial`, and `campaigns: [{ frequency, oseCampaignId }]`, many per frequency. A `programme` of slots per frequency (cadence, day, time, mode, kind, purpose). The why is required on any frequency with events. (Owner, 2026-11-12: frequency decides, purposeful and scheduled, four kinds of event.) The schema and the fixture creator change, and old files still validate. | OW | #106 merged | M |
| S2 | **Station pages with 5W(+H).** One page per station plus the creator page. The tuner becomes navigation; one `<h1>` each; places under "Where". "On air" shows the programme, and events read as "One time only", "Pop-up", "Trying this out" or as a programme date. E2E at 375, 768 and 1280 px, in both themes. | OW | S1 | M |
| S3 | **Read events from OSE at build time.** `GET /api/v2/events?brand=` and `/api/v2/events/:id` fill When, Where and How. A missing or non-public event drops off the page and fails nothing. Integration against the pinned local OSE (`.ose-ref`). | OW | S1 | M |
| S4 | **Digital codes per station.** The seed creates one showcase placement per station event. The build reads the public poster bundle for that placement and shows the `/q` code plus the event's `/s` codes, as QR and link. Born-red checks are in section 2. | OW (uses OSE as is) | S2, S3 | M |
| S5 | **Retire the copied schedule.** Rows that are linked OSE events come from OSE; any others stay labelled as copied. | OW | S3 | S |
| S6 | **A creator schedules her own events.** A brand per creator and her membership. | OSE | The tenant-boundary chain (OSE-1446 …), owner | L, not now |
| S7 | *(Later, owner 2026-11-12: a private file for now.)* **Serve the page from OW staging, private.** Behind an access gate, with the showcase CSP check live. | OW | S2; `stg.ourwkrp.com` TLS fixed (owner action) | M |
| S8 | **A brand calendar feed** (owner, 2026-11-12: in this increment). `GET /brands/:brand/calendar.ics` lists the brand's public events, so followers can subscribe once.<br>It reuses the per-event `.ics` writer (`handlers/calendar.ts`). It reads the same published, active and listed rows as the brand API, through the public projection only. It is rate-limited like other public reads and returns 404 for an unknown or invalid brand.<br>It includes online events, since a subscription is reached by link, and each entry carries the mode label once S13 lands. An entry's link is the event page, never a meeting link. Nothing about attendees is in it. On staging the neutral-title rule applies.<br>The creator page lists it under "Where" as a `calendar` place. Both test layers apply, with born-red checks for brand isolation (another brand's event never appears), drafts left out, and no field outside the public projection. | OSE | none (S13 for the mode label) | S |
| S9 | **Partners per station.** Read each linked event's public sponsor bundle and show the strip below the title and date. A station campaign's partner shows once, at the top of the station. The partner link is the event's SPONSOR `/s/` code. Born-red checks are in section 5. | OW | S3, S4; S14 for the campaign partner | M |
| S14 | **Campaigns an organizer can use.**<br>An admin route creates and lists campaigns on a brand: brand-scoped through `guardAdminObjectScope`, audited, with a title and a status only. A placement can then be attached to a campaign.<br>The public sponsor bundle gains each consented placement's campaign (`id` and `title` only) as a sibling field, so the public event projection is unchanged.<br>Born-red checks: another brand's campaign can never be attached or seen; a campaign never appears for a placement without both sides' consent; a campaign title is never a filter or search key. | OSE | none | M |
| S10 | **Layout and display menu.** `layout`, `stationOrder`, `sections` and `display` in the creator contract. Each option is rendered and run through the e2e and accessibility set; an unknown option fails the build. | OW | S2 | M |
| S11 | **TV display option.** Auto-advancing stations, large type, no counts, codes and consented sponsors only. | OW | S10, S4 | S |
| S13 | **Online or in person on every event.** A required `attendance_mode` field (`in_person` · `online` · `both`). The section 3 rules apply: existing rows become `in_person`; a place is needed for `in_person` and `both`; `online` events are left out of `/events`, the landing page and the sitemap; no meeting link is stored or published. Both test layers, the contract snapshot bump, and a born-red check per rule. | OSE | none | M |
| S15 | **A series an organizer declares.**<br>An admin route declares a series on a brand up front (name, cadence, day, hour), anchored on an event, not a venue, so online programmes work. It attaches events to the series (`events.series_id`), confirms or rejects a detector suggestion, and promotes a trial: its past events join the series.<br>It is brand-scoped and audited. A declared series is `confirmed` and feeds the SharedReport trend as a detected one does.<br>Born-red checks: another brand's event can never join a series; a series never carries a per-attendee field; promoting changes no past date or count. | OSE | none | M |
| S12 | **A creator's own colours.** The page takes a pipeline-made `[data-brand]` block from the pinned `@ocr/ui`. It waits on the white-label pipeline (intake, processor, OSM, OA) and on a contrast checker for brand sets. OW only consumes the block. | OW; the pipeline is OSM and OA | The white-label pipeline | S here; L for the pipeline, not now |

The recommended order:
1. S1 in OW and S13 in OSE, in parallel.
2. S2 and S3 in parallel, and S8 in OSE after S13. S3 shows the mode once S13 is merged.
3. S4, then S5.
4. S9 and S10 in parallel, then S11. S14 and S15 run in OSE any time before S9 needs a campaign partner and S2 needs declared programmes.

S6, S7 and S12 wait on their prerequisites.
S1 to S5, S10 and S11 need no OSE code change. S13, S8, S14 and S15 are the near-term OSE changes.

## Questions for the owner

1. **Who creates the creator's events, for now?** *Decided, owner 2026-11-12: the owner, on staging, until the tenant chain lands. S6 stays later.* See "Her events on staging" below.
2. **Station pages.** *Decided, owner 2026-11-12: one page per category (station), with the creator page as the dial.* S2 builds it.
3. **Online or in person.** *Decided, owner 2026-11-12: every event says which it is, at creation, and **both** is a third choice.* Still open:
   - (b) *Decided, owner 2026-11-12: an OW event is one OSE record. OW writes it through OSE's API and never keeps events of its own.*
   - (c) *Decided, owner 2026-11-12: online events are link only for now.* See S13.
4. **Evergreen links (store, school, products).** *Decided, owner 2026-11-12: plain links, not counted.* A product click is counted only through an event's own code (for example a pop-up's MORE code).
5. **Plan tier for the showcase brand.** *Decided, owner 2026-11-12: Mid, so 5 codes per event, counting the event-page code.* That matches the own-brand decision, because `docs/features/BRANDS.md` puts Free on `root` and Mid on its own brand. Two things to know before the owner applies it on staging:
   - **The tier on staging is global, not per brand.** `detectCurrentTier` reads the global flag set, so applying Mid (`POST /api/v2/admin/flags/apply-tier`) changes the code allotment and every other Mid feature for every staging brand, `root` included.
     I found no Bruno or Playwright test for poster codes that expects the Free limit of 3. I did not check every Mid-gated feature against the staging tests, so watch the first T2 to T4 run after applying it.
   - **Bruno's tier test sets Free and then restores** the tier it read before (`POST Restore Tier Preset`), so Mid survives a T2 run. While T2 runs, though, the tier is briefly Free.
     A poster-codes save with 4 or 5 codes during that window is refused. Save them outside a staging CI run.
   - A per-brand tier would remove both caveats. That is OSE work outside this plan, and not proposed here.
6. **The brand calendar feed (S8).** *Decided, owner 2026-11-12: yes, in this increment.* It runs after S13.
7. **Where the page is shown.** *Decided, owner 2026-11-12: a privately shared static file for now.* S7 is later.
   - The build's output folder `out/<slug>/` is what gets shared. It is now several pages (S2), so it is shared as a folder or a zip, or as one private artifact with its station pages as supporting files.
   - The page reads OSE only at build time, so a shared copy shows the events, codes and sponsors as of its build. To show newer events, rebuild and share again.
8. **A partner for a whole station.** *Decided, owner 2026-11-12: an OSE campaign across that station's events.* S14 makes campaigns usable.
9. **Partner reporting from the showcase page.** *Decided, owner 2026-11-12: clicks only for now.* No impression or click beacons; only the SPONSOR `/s/` click is counted.
10. **The layout menu.** *Decided, owner 2026-11-12: `dial`, `list` and `grid` layouts, plus `page` and `tv` displays, as the first set.* No embed for now.
11. **A creator's own colours:** wait for the white-label pipeline (recommended)? Or stay on the OW brand for creator #1 until then?
12. **Her name on open staging, before she agrees.** *Decided, owner 2026-11-12: neutral titles first, then rename when she says yes.* See "Her events on staging".
