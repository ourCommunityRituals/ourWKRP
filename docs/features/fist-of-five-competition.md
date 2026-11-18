# Fist of Five — Live Team Competition

**Status:** Concept — roadmap, not built
**Product:** ourWKRP
**Last updated:** 2026-11-18 (voting follows the owner's decisions of 2026-11-17 and 2026-11-18; see the note below)

> **Voting is decided (owner, 2026-11-17 and 2026-11-18).** The decision record
> is ADR-040 in the OurSharedEvents repository ("An anonymous vote is a counter
> on an object, never a row about a voter"). Where this concept document says
> otherwise, the decision record wins. In short:
>
> - **Votes are stored on OurSharedEvents, never on ourWKRP.** ourWKRP holds
>   named people; a vote is anonymous. ourWKRP stores no vote, no voter and no
>   tally.
> - **There is no row per vote.** A vote is a counter on an object, with a
>   one-vote marker that names nobody.
> - **Each play of a song is one object.** ourWKRP keeps the link from its
>   `playback_events` id to the object's id; OurSharedEvents stores no ourWKRP
>   id and no name.
> - **The room screen shows the event's own scan code on OurSharedEvents.** It
>   is not an ourWKRP link and not a code per song. The vote page there lists
>   the songs open now, and each vote button carries its song's object id.
> - **No tally before the night is final, and none on any screen.** Afterwards
>   only the night's winner is published, or "too close to call, the champion
>   retains". No count per song, per team or of voters is published.
> - **One vote per person per song**, by the one-vote marker, not by a profile.
>
> So these parts of this document no longer hold as written: results that
> "surface immediately", published team vote totals and standings by votes,
> "one vote per profile/device", the anti-abuse list, and mobile-link voting.
> They are kept below as the original concept.

## Vision

Fist of Five is a **monthly, wrestling-style team music competition.** Profiles
form persistent teams; teams curate playlists; once a month they compete on a
shared playlist at a live event; the room votes by QR; votes roll up to the
team that picked the track; a team wins the night and holds **the belt.**

It turns ourWKRP from a music *catalog* into a *game with a season* — a reason
to show up, recruit, trash-talk, and come back next month.

## The wrestling model

Why wrestling: it gives the competition a **season**, not just a night. A
one-off vote gives nobody a reason to return; a season does.

- **Monthly cards** — recurring events; anticipation for who's on the next card.
- **Stables, not ad-hoc teams** — teams have persistent names, personas,
  identity.
- **Rivalries that carry over** — Team A beat Team B in March; the April
  rematch writes itself.
- **The belt** — a defended monthly title. Already in WKRP's product
  definition: *"winner takes home the belt."*
- **Standings** — a season record across the monthly cards → a champion.

## How a night runs

1. One **shared playlist** holds every team's tracks; each track is tagged to
   the team that picked it.
2. The playlist plays at the venue (a DJ set / shared queue).
3. Attendees vote by **QR scan** — a vote is **+1 for the now-playing song**,
   one tap, no track picker.
4. Votes **roll up**: track → team. The team with the most votes wins the
   night and the belt.

## Voting mechanic (the substrate)

- **Resolve by an id, never by the clock (binding).** Each play of a song is a
  `playback_events` row with its own id (migration 0011, OW-219);
  `GET /dj/:id/live` names the open one as `now_playing`. Each play is one
  votable object on OurSharedEvents, and a vote button carries that object's
  id. There is **no timestamp intersection**: the server never works out the
  song from *when* a tap arrived. The room screen shows the event's own scan
  code (see the note at the top); the **wall poster stays static**. This is
  the scan-resolution law in `artist-attribution-five-surfaces.md`.
- **Server-side resolution only** — never trust a client clock.
- **Dedup is per song-play** — one vote per profile/device per playback
  instance. Votes key to the **playback-event id**, not the bare track id, so a
  replay of the same song re-opens voting. A confirmed song change re-opens
  voting for everyone — and the song-change signal comes **only** from the
  authoritative playback source (the app / the DJ logging tracks), never from a
  voter.
- **Anti-abuse:** cookie dedup + a one-time scan token + a loose per-IP limit.

## Identity surfaces

A Fist of Five night carries **both** ADR-002 identity profiles at once:

- **Competing teams** — `identified`. The players are on the record.
- **Voting room** — `anonymous`. QR scan, no account.

This is exactly the dual-surface model in
[ADR-002](https://github.com/OurCommunityRituals/OCR-docs) — the architecture
already accounts for a single product surface-set spanning both profiles.

## Live results — SharedReports

Results surface **immediately** through OSE's **SharedReports**. This makes a
Fist of Five night a **WKRP ↔ OSE integration** — competition results flow
through OSE's reporting infrastructure rather than a WKRP-only dashboard.

It fits cleanly: team tallies are **aggregates** (team vote totals, no
individual voter records), so reporting them honors the aggregate-only
reporting rule by nature.

## Stretch — mobile-link voting

A mobile link with **one-button voting**, alongside the in-venue QR.

- **Reach** — vote from a phone, not only by scanning a physical code.
- **Sponsors** — the vote link/button is a sponsor surface; a sponsored vote
  button is an ad that *is* the culture (the hyperlocal-ad-economy flywheel).
- **Caveat** — a public link weakens "the room limits abuse." It needs
  stronger anti-gaming than the in-venue QR (rate limits, device attestation,
  geofencing, or proof-of-presence). Scope the integrity work before shipping.

## The Triple A belt — open challenge

ourWKRP runs **two belts**:

- **The Champion belt** — the monthly competition described above. Scheduled,
  multi-team, prestige. The season and the standings.
- **The Triple A belt** — *Anyone, Anywhere, Anytime.* An open-challenge title
  with no card and no schedule: a team calls out the holder, and a 1v1
  showdown is on.

The Triple A belt exists to kill the dead air. A monthly-only competition goes
quiet for 29 days; the Triple A belt keeps Fist of Five **always live** — there
is always a showdown that *could* drop. The Champion belt is prestige; the
Triple A belt is the one that is always trending. It is the virality engine.

**A Triple A showdown is a lighter event** than the monthly card — **1v1, two
playlists, head-to-head** — the simplest possible bracket, and faster to build.

**Mobile-link voting is load-bearing here, not a stretch.** "Anywhere, anytime"
means a showdown cannot rely on a venue's QR poster — so the mobile-link
one-button voting described above is the mechanism that *makes the Triple A
belt possible*. The two ideas are one system. (The public-link integrity
caveat applies in full — an open belt is the most gameable surface.)

The Triple A format originated in the OCR bocce league. The belt is a
**cross-product mechanic** — bocce, Fist of Five, and OSP's belted leagues all
share a "belt culture," with "Triple A" as one portable belt *format* within it.

## Builds on / net-new

**Builds on (exists today):**
- Profiles (`contributors`).
- The playlist builder (`playlists`, add/remove tracks) — today role-gated to
  founder/curator/DJ.
- The catalog (`tracks`).
- The DJ playback log (`set_tracks`, migration 0006).
- The Fist of Five voting mechanic (designed).

**Net-new:**
- A **team** entity + **team membership** (profiles → teams).
- A **competition / season** entity (groups monthly cards).
- The **Champion belt / title** (held by a team, defended monthly).
- The **Triple A belt** — an open-challenge title, the 1v1 showdown format,
  and challenge/defense rules.
- **Team-tagging on tracks** in the shared playlist, so votes can roll up.
- **Vote → team** rollup + per-night and per-season **standings**.
- The **SharedReports** (WKRP ↔ OSE) integration.

## Platform note

Multiple teams × ~5 players is far past Spotify's 5-user OAuth cap, so the
competition **cannot** depend on Spotify account integration. It runs on the
platform-agnostic catalog (populated via CSV import and/or Spotify embeds). The
"Spotify wrapper" question does not constrain this feature.

## Open design questions

- **Team formation** — who creates a team, team size, can a profile be on more
  than one team, persona/naming rules.
- **Playlist-creation role gate** — today only founder/curator/DJ can create a
  playlist; team playlists likely need to be open to any team member.
- **Season structure** — how many monthly cards make a season, belt-defense
  rules, standings and tiebreakers.
- **"Shared playlist" shape** — one interleaved mix of all teams' tracks, or
  per-team segments within the night.
- **Public-link integrity** — the anti-gaming model for mobile-link voting
  (load-bearing for the Triple A belt).
- **Triple A belt rules** — who can challenge, challenge frequency and
  cooldowns, defense obligations, and what keeps it lively without becoming
  pure noise.

## Placement

Roadmap. A substantial initiative — a D1 migration, new handlers, UI, and the
OSE SharedReports integration. The natural slot is **after** the team test
validates the basics (profiles, import, the playlist builder) with real people,
and after / alongside the ADR-002 migration.
