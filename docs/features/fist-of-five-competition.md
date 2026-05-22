# Fist of Five — Live Team Competition

**Status:** Concept — roadmap, not built
**Product:** ourWKRP
**Last updated:** 2026-05-22

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

- **Static QR + scan-timestamp inference.** One static QR at the venue. The
  server records *when* the scan arrived and resolves the now-playing track by
  intersecting that timestamp with the `set_tracks.played_at` playback log
  (migration 0006). No physically-rotating QR.
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
- The **belt / title** (held by a team, defended).
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
- **Public-link integrity** — the anti-gaming model for the mobile-link
  stretch.

## Placement

Roadmap. A substantial initiative — a D1 migration, new handlers, UI, and the
OSE SharedReports integration. The natural slot is **after** the team test
validates the basics (profiles, import, the playlist builder) with real people,
and after / alongside the ADR-002 migration.
