# ourWKRP Community Playbook

> How to run a music community that matters. Not a user manual — a field guide for building something real.

---

## The Stack

Everything ourWKRP does lives across four layers. Each one extends the reach of the one before it.

| Layer | Format | What it does |
|-------|--------|--------------|
| **Live** | DJs, vinyl, the room | Creates the experience |
| **Spotify / Apple Music** | Curated playlists, DJ mixes | Extends the room beyond the walls |
| **Podcast** | OurRecordStories oral history | Deepens the story |
| **ourWKRP App** | Free download, community layer | Captures the identity |

**Integration with OurRecordStories** runs through every layer — the stories are what connect the music to the people to the place.

---

## Part 1: DJs

> DJs are the top of the community. They're in the room making the moment happen. Their influence is the product.

### Getting Started

1. **Register** at yourwkrp.com — select "DJ" as your role
2. **Go to /dashboard** — this is your home base
3. **Import your library** — upload a CSV export from Exportify or add tracks through the catalog

### Running a Live Set

1. Open your **Dashboard** (`/dashboard`)
2. Enter the **venue name** (e.g., "RIPH")
3. Tap **Start Set**
4. Search and **add tracks** as you play them — the set list builds in real time
5. When you're done, tap **End Set**

### The Poster

Your poster URL: **`/dj/[your-id]/poster`**

This is the page you frame, print, or display on a screen. It has:
- Your name
- QR code linking to your live set
- "Now Playing" — updates automatically every 15 seconds
- Sponsor slot (optional)

**Where to put it:**
- Framed on the DJ booth
- On every table (tabletop ops, same as OSE)
- On a screen behind the bar
- At the door / entrance
- On the back of the bathroom stall door (people look at something, make it yours)

**Poster URL parameters:**
- `?sponsor=Lagunitas` — adds sponsor branding
- `?event=ose-event-id` — ties attributions to a specific OurSharedEvents event

### How Attribution Works

1. Someone in the room hears a song that hits
2. They scan your QR code on their phone
3. They see your live set — the tracks you've been playing
4. They tap **"This hit"** on the track
5. Three things happen:
   - You get permanent credit for introducing them to that song
   - The song gets saved to their Spotify or Apple Music (if connected)
   - If at an event, it's added to their "Discovered at [venue]" playlist

**You don't need to do anything except put out the QR code.** The attribution happens automatically. Anonymous scans still count toward your stats — the listener doesn't need an account.

### Your Influence Record

Over time, your dashboard shows:
- **Total attributions** — how many times someone tapped "This hit" on your tracks
- **Unique listeners** — how many different people discovered music through you
- **Total sets** — how many times you've played
- **Top discovered tracks** — the songs people attribute to you most

This is your portfolio. No algorithm can manufacture it. No bot can inflate it. It's real people saying "I heard this through you."

### Best Practices

- **Update your set list in real time.** The more accurate it is, the more attributions you get.
- **Put the poster where people will see it.** Every table, the bar, the door.
- **Tell people what it is.** "See that QR code? Scan it and save whatever I'm playing."
- **Don't overthink it.** Play what you play. The data follows naturally.
- **Share your stats.** Your influence record is proof of your taste. Use it.

### Integration with OurRecordStories

DJs are the perfect storytellers. Between sets or after a night:
- Record a 5-minute story about a track that defined the night
- Why did you play it? What happened in the room when it dropped?
- These stories attach to your profile and the track — anyone who finds the song later hears your story

---

## Part 2: Curators

> Curators are a close second to DJs. They build the playlists that make the room possible. The editorial voice.

### Getting Started

1. **Register** at yourwkrp.com — select "Curator" as your role
2. **Import your library** — go to `/import`, upload your Exportify CSV
3. **Browse the catalog** — see what the community has contributed

### Building Playlists

1. Go to `/create`
2. Name your playlist and add a description
3. Search for tracks and add them
4. Export as JSON for Apple Music import

Curators are the only ones (alongside founders and DJs) who can create playlists. This isn't a democracy — taste is earned.

### Importing Music

The catalog is CSV-first. Export from:
- **Exportify** (exportify.net) — exports your Spotify library as CSV
- **Apple Music** — export library via Music app or third-party tools
- **Manual** — any CSV with name, artist, album columns

Go to `/import`, select your file, preview the first 5 rows, then import. Duplicates are automatically skipped by ISRC or artist+title matching.

### The Curatorial Role

You're not just adding songs. You're shaping the catalog. You decide:
- What genres are represented
- How playlists tell a story (not just a collection of tracks)
- Which contributors' taste gets amplified through curation
- What the community's collective voice sounds like from the outside

### Best Practices

- **Import your full library** — even the weird stuff. Genre blind spots are the enemy.
- **Create themed playlists** — not just "favorites" but playlists that tell a story or serve a moment
- **Use genre discovery links** — tap any genre tag to explore Discogs, Last.fm, and Every Noise
- **Credit contributors** — when you build a playlist from someone else's imports, acknowledge them
- **Export regularly** — `/api/export/tracks?format=csv` backs up the whole catalog

### Integration with OurRecordStories

Curators are the bridge between the music and the oral history:
- Interview contributors about the records they brought in
- Build playlists that pair with specific stories
- Create "liner notes" playlists — the tracklist IS the story

### Spotify / Apple Music

Curators should maintain presence on both platforms:
- **Spotify playlists** under the community brand — these extend the room beyond the walls
- **Apple Music** playlists exported from ourWKRP — use the export feature
- The external presence is the proof that the music layer is real before anyone downloads the app

---

## Part 3: Contributors

> Contributors bring the taste. They import their libraries and make the catalog what it is.

### Getting Started

1. **Register** at yourwkrp.com — select "Contributor" as your role
2. Pick your **generation**:
   - **Founder** — been here since day one
   - **Gen 2** — brought in by a founder
   - **Gen 3** — newest to the table
3. **Import your library** if invited by a founder or curator
4. **Browse the catalog** and discover what the community has built

### What Contributors Do

- Import music libraries (when given access by a founder/curator)
- Browse and search the catalog
- Discover tracks through DJ live sets (scan QR, tap "This hit")
- Have a public profile showing your contribution to the catalog

### Your Profile

Your contributor profile at `/contributor/[your-id]` shows:
- Your name, role, and generation
- How many tracks you've contributed
- Your playlists
- Your top genres
- Which communities (brands) you're part of
- Your contribution sources (Spotify, Last.fm, CSV, etc.)

### The Lineage Model

Generations matter. Founder → Gen 2 → Gen 3. The grandparent, parent, child all contributing is the power. This isn't about who's cooler or whose playlist is better. There's a culture of old and new, grinding and cherishing. Every generation has a place.

### Best Practices

- **Import everything** — not just your cool records. The deep cuts, the guilty pleasures, the stuff nobody else knows about. That's what makes the catalog alive.
- **Scan QR codes at events** — every "This hit" tap grows the community's data and credits the DJ
- **Tell your stories** — when OurRecordStories launches, you're the oral history. Five minutes, one side of a record, why does it matter to you.
- **Bring people in** — Gen 2 brings Gen 3. The community grows through personal invitation, not marketing.

### Integration with OurRecordStories

Contributors are the storytellers:
- **Your story matters.** You don't need to be a DJ or curator to have a story worth telling.
- "This album was playing in my apartment the night my kid was born."
- "I stole this CD from my older brother in 1997 and never gave it back."
- Those stories attach to your profile and the tracks — they become part of the catalog's soul.

---

## Part 4: Listeners

> Listeners discover. They're the audience that makes the whole thing worth building.

### Getting Started

1. **Browse the catalog** — you don't even need an account. Go to `/catalog`.
2. **Register** when you're ready — select "Listener" as your role
3. **Scan QR codes** at events — discover what the DJ is playing and save it to your library

### What Listeners Get

- **Full catalog access** — search, filter by genre/energy/mood, browse by contributor
- **DJ attribution** — scan QR at a live set, tap "This hit," song goes to your Spotify or Apple Music
- **Discovery playlists** — "Discovered at RIPH" auto-created when you attribute at events
- **Community stats** — see what the community is listening to at `/stats`

### The QR Flow

1. You're at a bar. A DJ is playing. There's a QR code framed on the table.
2. You scan it. Your phone opens the live set page.
3. You see the setlist. The current track is highlighted.
4. You tap **"This hit"** on anything that grabbed you.
5. The song is saved to your Spotify or Apple Music automatically.
6. The DJ gets credit for introducing you to it.
7. That's it. You go back to your drink.

No app download required. No account required. You can register later if you want your attributions linked to a profile.

### Becoming a Contributor

Listeners can grow into contributors:
- Start by scanning and attributing at events
- Register and connect your music platform
- Ask a founder or curator for import access
- Import your library — now you're feeding the catalog
- The community grows from the bottom up

### Best Practices

- **Scan every QR code you see.** Even if you don't tap "This hit" immediately, you can come back to the set list later.
- **Connect your music platform** — Spotify or Apple Music. Then "This hit" saves directly to your library with zero extra steps.
- **Check /stats** — see what the community is listening to. Find contributors with similar taste. Follow their profiles.
- **Don't be passive.** The best listeners become contributors. The best contributors become curators. The best curators become DJs.

---

## Part 5: QR Codes — The Physical Layer

> The QR code is the bridge between the room and the platform. It's the simplest possible interaction: scan and tap.

### Where QR Codes Live

| Location | Format | Purpose |
|----------|--------|---------|
| DJ booth | Framed poster | Direct attribution to the DJ playing |
| Every table | Tabletop tent / frame | Ambient — people scan between drinks |
| Bar top | Sticker or frame | Bartender can point to it |
| Entrance / door | Poster | First thing you see walking in |
| Bathroom | Sticker on door/mirror | Captive audience |
| Event merch table | Card with QR | Take-home attribution |
| Social media | Screenshot of poster | Pre-event promotion |

### Poster Formats

**Standard poster:** `/dj/[id]/poster`
- DJ name, QR code, "Now Playing," venue name
- Auto-updates every 15 seconds
- Works on any screen — phone, tablet, TV

**With sponsor:** `/dj/[id]/poster?sponsor=Lagunitas`
- Same poster, sponsor name displayed at bottom
- Sponsor gets association with a live room and documented engagement

**With event context:** `/dj/[id]/poster?event=ose-event-123`
- Links attributions to a specific OurSharedEvents event
- Sponsor reports include this event's data

**Combined:** `/dj/[id]/poster?sponsor=Lagunitas&event=ose-event-123`
- Full tabletop ops — sponsor, event, DJ, QR, now playing

### Printing QR Codes

For framed/permanent displays:
1. Open the poster URL on a laptop
2. Screenshot or print the page
3. Frame it — standard 4x6" or 5x7" works
4. The QR code stays the same forever — it points to `/dj/[id]` which always shows the current set

For events:
1. Print the poster page on card stock
2. One per table, one at the bar, one at the door
3. The `?event=` parameter can be unique per event night

### Best Practices

- **Frame > sticker > nothing.** A framed QR code signals permanence. A sticker signals intention. Nothing signals missed opportunity.
- **Put them at eye level sitting down.** People scan from their seats, not standing up.
- **The bartender is your best promoter.** "See that QR? Scan it to save whatever's playing." One sentence.
- **Refresh the poster URL, not the physical code.** The QR points to your live page forever. The content changes per set.

---

## Part 6: Integration with OurRecordStories

> Five minutes. One side of a record. Why does it matter to you.

### What OurRecordStories Is

OurRecordStories (OSR) is the oral history engine of ourCommunityRituals. Short-form audio stories from real people about real records. Not reviews. Not criticism. Just: why does this song matter to you?

### How It Connects to Each Layer

**Live:**
- After a DJ set, record a quick story about a track that defined the night
- "This song cleared the floor and I played it anyway because it needed to be heard"
- These stories become part of the DJ's profile and the track's history

**Spotify / Apple Music:**
- Curated playlists paired with OSR stories
- "Listen to the playlist, then listen to why each track matters"
- The playlist is the soundtrack. The stories are the liner notes.

**Podcast:**
- OSR episodes are standalone audio — works as a podcast feed
- Each episode is one person, one record, five minutes
- Seasons organized by theme: "RIPH Regulars," "Vinyl Collectors," "Blue Island Stories"
- The podcast develops only if there's organic need — not forced

**ourWKRP App:**
- Contributor profiles show stories alongside tracks
- Track cards in the catalog show "1 story" badges
- Tap a story to listen inline
- "Tell your record story" CTA on every profile

### Who Tells Stories

Everyone. But the strongest content comes from:
- **DJs** — they have context no one else has. What happened in the room.
- **Founders** — they have the deepest history. The records that started everything.
- **Curators** — they can frame a collection as a narrative.
- **Contributors** — the personal stories. Why this album. Why this song. Why now.
- **Listeners** — the discovery stories. "I scanned a QR code at RIPH and this song changed my week."

### Best Practices

- **Keep it to five minutes.** One side of a record. That constraint is what makes it powerful.
- **Don't script it.** The best stories are off the cuff. Just talk about the record.
- **Record in the room.** The ambient sound — glasses clinking, people talking, the hum of the bar — that's part of the story.
- **One record per story.** Not a top 10. Not a genre overview. One record. Why.
- **Let it compound.** Over months and years, a single track might have 5 different stories from 5 different people. That's the archive.

---

## Part 7: Community Best Practices

> This is what happens when old people with ideals make things. Individual customer and community experience is the #1 goal.

### Starting a New Community

1. **Start small.** A few DJs, a few people at a bar. That's it.
2. **No announcement.** Scenes don't get announced. They start happening in a room until enough people notice.
3. **Free until you clear the legal.** No barrier, no commitment. Just "here, take this."
4. **The founders ARE the product.** Matt, P, G, JS, M — the crew with zero genre blind spots. That's the founding curatorial voice.
5. **Multi-tenant from day one.** `bronzeville.ourwkrp.com`, `reckless.ourwkrp.com` — each community gets its own subdomain, its own colors, its own identity.

### Growing the Community

- **Gen 2 comes through personal invitation.** Founders bring in people they trust.
- **Gen 3 comes through Gen 2.** The grandparent → parent → child lineage is the growth model.
- **Listeners become contributors.** Contributors become curators. Curators become DJs. The path upward is always open.
- **Never recruit. Attract.** If someone asks "what's that QR code?" — that's the invitation.

### The Culture

- **No leaderboards.** Attribution stats exist for DJs to see their own influence, not to rank people against each other.
- **No popularity contests.** A DJ grinding Wednesday night and a DJ spinning Saturday are both at the top.
- **Old and new.** A founder who's been in the conversation for years and a Gen 3 who got pulled in last month both matter.
- **Grinding and cherishing.** The DJ building a set in an empty room and the crew reliving a legendary night — both are the culture.
- **Real people, real taste.** The human answer to AI playlists. No algorithm can manufacture what happens when people who actually care about music share it with each other.

### Privacy

- **ourWKRP is opted-in.** Every contributor chose to be here. Every attribution is consensual. The act of scanning is the consent.
- **OurSharedEvents is anonymous.** These are separate privacy networks.
- **OurRecordStories is the bridge.** Individuals choose how they connect their WKRP identity to their OSE presence.
- **Sponsor data is aggregate.** DJs are named (they opted into public attribution). Listeners are counts, never identities.

### Sponsor Integration

Sponsors get:
- Their name on the physical poster (`?sponsor=Name`)
- Documented engagement data: attributions, unique scans, top tracks
- Association with a live room and a real audience
- Access to `/api/sponsors/:eventId/report` for verified numbers

Sponsors never get:
- Individual listener names or identities
- The ability to influence the playlist or setlist
- Anything that feels manufactured or inauthentic

The ask to sponsors is backed by proof. The data is real, the influence is documented, and the community was never manufactured.

---

## Quick Reference

### URLs Every DJ Needs

| URL | What |
|-----|------|
| `/dashboard` | Your home base — start sets, see stats |
| `/dj/[your-id]/poster` | The page you frame and display |
| `/dj/[your-id]/poster?sponsor=Name` | Poster with sponsor |
| `/contributor/[your-id]` | Your public profile |

### URLs Every Curator Needs

| URL | What |
|-----|------|
| `/import` | Import CSV libraries |
| `/create` | Build playlists |
| `/catalog` | Browse and search |
| `/api/export/tracks?format=csv` | Export the full catalog |

### URLs for Everyone

| URL | What |
|-----|------|
| `/` | Register or connect |
| `/catalog` | Browse the catalog |
| `/stats` | Community stats |
| `/contributor/[id]` | Anyone's profile |

### API Endpoints for Integration

| URL | What |
|-----|------|
| `/api/events/:id/music` | Music data for an OSE event (aggregate only) |
| `/api/sponsors/:eventId/report` | Sponsor engagement report |
| `/dj/:id/stats` | DJ influence stats JSON |
| `/dj/:id/live` | Current live set JSON |
