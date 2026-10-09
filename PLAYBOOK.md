# PLAYBOOK.md — New Community Setup Guide

> Step-by-step guide to launch a new ourWKRP instance for your community.
> Estimated time: 2-3 hours (plus 1-2 weeks for Apple Developer enrollment).

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| npm | 9+ | Comes with Node.js |
| Git | 2.x | [git-scm.com](https://git-scm.com) |
| Wrangler CLI | 3.x+ | `npm install -g wrangler` |
| Doppler CLI | latest | [docs.doppler.com/docs/install-cli](https://docs.doppler.com/docs/install-cli) |

### Accounts Needed

| Account | Purpose | Cost |
|---------|---------|------|
| [Cloudflare](https://dash.cloudflare.com/sign-up) | Worker hosting, D1 database, KV storage | Free tier covers it |
| [Doppler](https://doppler.com) | Secrets management across environments | Free for small teams |
| [Last.fm](https://www.last.fm/api/account/create) | Music metadata + scrobble history | Free |
| [Apple Developer Program](https://developer.apple.com/programs/) | Apple Music playlist publishing (Phase 2) | $99/year |
| Domain registrar | `yourwkrp.com` or similar | ~$12/year |

---

## Phase 1: Clone + Local Dev (30 min)

### 1.1 Clone the repository

```bash
git clone https://github.com/ourCommunityRituals/ourWKRP.git
cd ourWKRP
npm install
```

### 1.2 Verify the build

```bash
npm run typecheck    # TypeScript compiles cleanly
npm test             # 400+ tests pass
```

### 1.3 Run locally (no secrets needed)

```bash
npm run dev:local    # Starts wrangler dev on http://localhost:8787
```

Visit `http://localhost:8787/health` — you should see `{"ok":true}`.

> **Note:** Full functionality requires Doppler secrets (Phase 2).
> Local dev without Doppler gives you the HTML pages and health endpoint.

---

## Phase 2: Cloudflare Infrastructure (45 min)

### 2.1 Authenticate with Cloudflare

```bash
npx wrangler login
# Browser opens — authorize your Cloudflare account
npx wrangler whoami  # Verify: should show your account name
```

### 2.2 Run the automated setup script

```bash
chmod +x scripts/setup-infra.sh
./scripts/setup-infra.sh
```

This script will:
- Create D1 databases (`ourwkrp-staging` + `ourwkrp-production`)
- Create KV namespaces (staging + preview + production)
- Update `wrangler.toml` with real resource IDs
- Run all 5 D1 migrations on both environments

### 2.3 Manual alternative (if the script fails)

If you prefer to do it manually or the script doesn't work on your OS:

```bash
# Create D1 databases
npx wrangler d1 create ourwkrp-staging
npx wrangler d1 create ourwkrp-production
# Note the database_id from each output

# Create KV namespaces
npx wrangler kv:namespace create WKRP_KV
npx wrangler kv:namespace create WKRP_KV --preview
# Note the id from each output

# Update wrangler.toml — replace PLACEHOLDER values:
#   PLACEHOLDER_D1_STAGING   → staging database_id
#   PLACEHOLDER_D1_PROD      → production database_id
#   PLACEHOLDER_KV_STAGING   → staging KV id
#   PLACEHOLDER_KV_PREVIEW   → preview KV id
#   PLACEHOLDER_KV_PROD      → production KV id

# Run migrations in order (repeat for each .sql file)
npx wrangler d1 execute ourwkrp-staging --file=migrations/0001_initial.sql
npx wrangler d1 execute ourwkrp-staging --file=migrations/0002_unique_spotify_user.sql
npx wrangler d1 execute ourwkrp-staging --file=migrations/0003_multi_source_provenance.sql
npx wrangler d1 execute ourwkrp-staging --file=migrations/0004_backfill_provenance.sql
npx wrangler d1 execute ourwkrp-staging --file=migrations/0005_catalog_api_brands_fts.sql
npx wrangler d1 execute ourwkrp-staging --file=migrations/0006_dj_attribution.sql

# Repeat for production
npx wrangler d1 execute ourwkrp-production --file=migrations/0001_initial.sql
# ... (all 6 migration files)
```

### 2.4 Verify D1 setup

```bash
npx wrangler d1 execute ourwkrp-staging --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expected tables: `attributions`, `brands`, `contributions`, `contributor_roles`, `contributors`, `dj_sets`, `playlist_tracks`, `playlists`, `set_tracks`, `track_identifiers`, `tracks`, `tracks_fts`

---

## Phase 3: Domain + DNS (20 min)

### 3.1 Add your domain to Cloudflare

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Click **Add a Site** → enter your domain (e.g., `ourwkrp.com`)
3. Select the **Free** plan
4. Cloudflare gives you two nameservers — update these at your domain registrar
5. Wait for DNS propagation (usually 15 min, can take up to 24 hours)

### 3.2 DNS records

In Cloudflare DNS settings, add:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `@` | `192.0.2.1` | Proxied (orange cloud) |
| A | `*` | `192.0.2.1` | Proxied (orange cloud) |
| CNAME | `www` | `yourwkrp.com` | Proxied (orange cloud) |
| CNAME | `stg` | `yourwkrp.com` | Proxied (orange cloud) |

> The `192.0.2.1` IP is a dummy — Cloudflare Workers intercept before it hits origin.
> The `*` wildcard record enables multi-tenant subdomains (e.g., `bronzeville.ourwkrp.com`).

### 3.3 Update wrangler.toml routes

Replace `ourwkrp.com` with your domain in the production routes:

```toml
[env.production]
routes = [
  { pattern = "yourdomain.com/*", zone_name = "yourdomain.com" },
  { pattern = "www.yourdomain.com/*", zone_name = "yourdomain.com" },
  { pattern = "*.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

And uncomment the staging routes if using a staging subdomain:

```toml
routes = [
  { pattern = "stg.yourdomain.com/*", zone_name = "yourdomain.com" },
  { pattern = "*.stg.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

---

## Phase 4: Secrets with Doppler (20 min)

### 4.1 Set up Doppler

```bash
doppler login           # Browser auth
doppler projects create ourwkrp
doppler setup           # Select ourwkrp project, dev config
```

### 4.2 Configure secrets per environment

**Dev config:**

```bash
doppler secrets set \
  SPOTIFY_CLIENT_ID="your-spotify-client-id" \
  SPOTIFY_REDIRECT_URI="http://localhost:8787/auth/callback" \
  APP_URL="http://localhost:8787" \
  --config dev
```

**Staging config:**

```bash
doppler configs create stg
doppler secrets set \
  SPOTIFY_CLIENT_ID="your-spotify-client-id" \
  SPOTIFY_REDIRECT_URI="https://stg.yourdomain.com/auth/callback" \
  APP_URL="https://stg.yourdomain.com" \
  --config stg
```

**Production config:**

```bash
doppler configs create prd
doppler secrets set \
  SPOTIFY_CLIENT_ID="your-spotify-client-id" \
  SPOTIFY_REDIRECT_URI="https://yourdomain.com/auth/callback" \
  APP_URL="https://yourdomain.com" \
  --config prd
```

### 4.3 Last.fm API key (optional but recommended)

1. Go to [last.fm/api/account/create](https://www.last.fm/api/account/create)
2. Create an API account — you get an API key + shared secret
3. Add to all Doppler configs:

```bash
doppler secrets set LASTFM_API_KEY="your-key" LASTFM_SHARED_SECRET="your-secret" --config dev
doppler secrets set LASTFM_API_KEY="your-key" LASTFM_SHARED_SECRET="your-secret" --config stg
doppler secrets set LASTFM_API_KEY="your-key" LASTFM_SHARED_SECRET="your-secret" --config prd
```

### 4.4 Run local dev with secrets

```bash
npm run dev    # Uses doppler run -- wrangler dev
```

### 4.5 Deploy secrets: set up and rotate (OW-154)

The Cloudflare deploy token (`ourwkrp-ci-deploy`) lives only in the Doppler
project `ourwkrp-deploy` (configs `stg` and `prd`), apart from the runtime
project `ourwkrp` (ADR-012 §3; a separate project because Doppler's free plan
allows 4 environments per project).
GitHub holds only a read-only Doppler service token per config, as the
environment secrets `DOPPLER_TOKEN_STG` (`staging`) and `DOPPLER_TOKEN_PRD`
(`production`). One command sets all of it up, and re-running it rotates it.
Run it on your own computer, logged in to `gh` as a repo admin and to Doppler:

```bash
npm run deploy-keys -- --dry-run       # shows what it would change
npm run deploy-keys                    # asks for the token (hidden); paste it, Enter
npm run deploy-keys -- --env staging   # one environment only
Get-Clipboard | npm run deploy-keys    # or pipe it (Windows); pbpaste | ... on macOS
```

It reads the Cloudflare token from a hidden prompt (or a pipe). If you pipe the
clipboard, copy the token last: copying the command replaces it. It
never prints it or a service token, revokes older `github-actions-*` service
tokens only after GitHub has the new one, and deletes the old
repository-level secret of the same name. Every 90 days: make the new
Cloudflare token, run it again, then delete the old Cloudflare token.

---

## Phase 5: Spotify App (15 min)

> **Note:** Spotify has a 5-user limit in development mode. This is fine for
> initial setup and founder testing. The platform is pivoting to CSV import
> + Last.fm + Apple Music for scale. Spotify auth remains for the first
> 5 contributors to bootstrap the catalog.

### 5.1 Create a Spotify app

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Click **Create App**
3. App name: `ourWKRP - [Your Community]`
4. App description: `Music catalog for [your community name]`
5. Redirect URIs — add all three:
   - `http://localhost:8787/auth/callback`
   - `https://stg.yourdomain.com/auth/callback`
   - `https://yourdomain.com/auth/callback`
6. Check **Web API** under APIs used
7. Save — copy the **Client ID**

### 5.2 Update Doppler

```bash
doppler secrets set SPOTIFY_CLIENT_ID="your-new-client-id" --config dev
doppler secrets set SPOTIFY_CLIENT_ID="your-new-client-id" --config stg
doppler secrets set SPOTIFY_CLIENT_ID="your-new-client-id" --config prd
```

### 5.3 Update wrangler.toml fallback

In `wrangler.toml`, update the `[vars]` block:

```toml
SPOTIFY_CLIENT_ID = "your-new-client-id"
```

---

## Phase 6: Deploy (10 min)

### 6.1 Deploy to staging

```bash
npm run deploy:staging
# Equivalent to: doppler run -p ourwkrp-deploy -c stg -- bash scripts/ci/wrangler-ci.sh stg deploy
```

### 6.2 Smoke test staging

```bash
curl https://stg.yourdomain.com/health
# Expected: {"ok":true,"service":"ourwkrp","version":"0.1.0","timestamp":"..."}

# Visit in browser
open https://stg.yourdomain.com
```

### 6.3 Deploy to production

```bash
npm run deploy:prod
# Equivalent to: doppler run -p ourwkrp-deploy -c prd -- bash scripts/ci/wrangler-ci.sh prd deploy --env production
```

### 6.4 Smoke test production

```bash
curl https://yourdomain.com/health

# Full test
open https://yourdomain.com
# Should see the connect page — enter a name, select generation, click Connect
```

---

## Phase 7: Add Your Brand (5 min)

Each community gets its own brand entry in D1. The default brand `wkrp` is seeded by the migration.

### 7.1 Add your brand

```bash
npx wrangler d1 execute ourwkrp-production --command="
  INSERT INTO brands (id, name, subdomain, primary_color, accent_color)
  VALUES ('bronzeville', 'Bronzeville', 'bronzeville', '#D4AF37', '#1a1a2e');
"
```

Now `bronzeville.yourdomain.com` serves the same catalog with Bronzeville-branded colors.

### 7.2 Brand color reference

| Property | CSS Variable | Description |
|----------|-------------|-------------|
| `primary_color` | `--brand-primary` | Buttons, active states, accent highlights |
| `accent_color` | `--brand-accent` | Background, secondary surfaces |

### 7.3 Add more brands

Repeat for each community/venue:

```bash
npx wrangler d1 execute ourwkrp-production --command="
  INSERT INTO brands (id, name, subdomain, primary_color, accent_color)
  VALUES ('reckless', 'Reckless Records', 'reckless', '#FF4136', '#111111');
"
```

---

## Phase 8: Import Music (first content)

The catalog uses CSV import as the primary ingestion method. Contributors export their Spotify library via [Exportify](https://exportify.net/) and upload the CSV.

### 8.1 Create a founder contributor

```bash
npx wrangler d1 execute ourwkrp-production --command="
  INSERT INTO contributors (id, name, generation, brand_id, role, status, created_at)
  VALUES (
    '$(uuidgen | tr '[:upper:]' '[:lower:]')',
    'Your Name',
    'founder',
    'wkrp',
    'founder',
    'active',
    datetime('now')
  );
"
```

Or use the web UI: visit `https://yourdomain.com`, enter your name, select "Founder".

### 8.2 Export from Spotify

1. Go to [exportify.net](https://exportify.net/)
2. Log in with your Spotify account
3. Click **Export All** — downloads a CSV per playlist
4. Each CSV includes: track name, artist, album, ISRC, genres, etc.

### 8.3 Import CSV

```bash
# Replace CONTRIBUTOR_ID with the UUID from step 8.1
curl -X POST https://yourdomain.com/import/CONTRIBUTOR_ID \
  -H "Content-Type: text/csv" \
  --data-binary @exported_playlist.csv
```

---

## Phase 9: Apple Developer (Phase 2 — parallel)

> This enables pushing curated playlists to Apple Music.
> Can be done in parallel with everything above.
> Takes 1-2 weeks due to D-U-N-S number verification.

### 9.1 Get a D-U-N-S number

1. Go to [dnb.com/duns-number](https://www.dnb.com/duns-number.html)
2. Apply for a free D-U-N-S number for your organization
3. Processing time: 1-2 weeks

### 9.2 Enroll in Apple Developer Program

1. Go to [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/)
2. Enroll as **Organization** (requires D-U-N-S)
3. Cost: $99/year
4. Approval: 1-2 business days after D-U-N-S verification

### 9.3 Create MusicKit key

1. Go to [developer.apple.com/account/resources/authkeys](https://developer.apple.com/account/resources/authkeys/list)
2. Click **+** to create a new key
3. Name: `ourWKRP MusicKit`
4. Enable **MusicKit**
5. Download the `.p8` private key file (you can only download it once!)
6. Note the **Key ID** and your **Team ID**

### 9.4 Store in Doppler

```bash
# Read the key file content
MUSICKIT_KEY=$(cat AuthKey_XXXXXXXXXX.p8)

doppler secrets set \
  APPLE_TEAM_ID="your-team-id" \
  APPLE_KEY_ID="your-key-id" \
  APPLE_MUSICKIT_PRIVATE_KEY="$MUSICKIT_KEY" \
  --config prd
```

---

## Ongoing Operations

### Deploy updates

```bash
git pull origin main
npm test                    # Verify tests pass
npm run deploy:staging      # Deploy to staging first
# Test on staging...
npm run deploy:prod         # Deploy to production
```

### Add a new contributor

Contributors can self-register via the web UI or be added via D1:

```bash
npx wrangler d1 execute ourwkrp-production --command="
  INSERT INTO contributors (id, name, generation, brand_id, role, status, created_at)
  VALUES ('UUID-HERE', 'Name', 'gen2', 'wkrp', 'contributor', 'active', datetime('now'));
"
```

### Promote a contributor to curator

```bash
npx wrangler d1 execute ourwkrp-production --command="
  UPDATE contributors SET role = 'curator' WHERE name = 'Their Name';
"

# Also add to multi-role table
npx wrangler d1 execute ourwkrp-production --command="
  INSERT INTO contributor_roles (contributor_id, role, granted_at)
  VALUES ('their-uuid', 'curator', datetime('now'));
"
```

### Check catalog stats

```bash
curl https://yourdomain.com/api/stats | python -m json.tool
```

### View all brands

```bash
curl https://yourdomain.com/api/brands | python -m json.tool
```

### Run migrations after updates

When the repo adds new migration files:

```bash
npx wrangler d1 execute ourwkrp-staging --file=migrations/XXXX_new_migration.sql
npx wrangler d1 execute ourwkrp-production --file=migrations/XXXX_new_migration.sql
```

---

## Architecture Reference

```
Request → Cloudflare Edge → Worker
                              ├── Brand extraction (subdomain → brand_id)
                              ├── Route dispatch (router.ts)
                              ├── HTML pages (with injected brand CSS)
                              ├── Catalog API (/api/tracks, /api/contributors, etc.)
                              ├── Playlist Builder (/api/playlists)
                              ├── CSV Import (/import/:contributorId)
                              ├── Spotify OAuth (/auth/start, /auth/callback)
                              ├── Last.fm integration (/auth/lastfm/*, /lastfm/*)
                              ├── D1 (SQLite) — tracks, contributors, playlists, brands
                              └── KV — sessions, auth state, tokens
```

### Monthly cost estimate

| Resource | Free Tier | Paid Estimate |
|----------|-----------|---------------|
| Cloudflare Worker | 100K req/day | $5/mo (10M req) |
| D1 database | 5M rows read/day | $0.75/mo per 1B rows |
| KV storage | 100K reads/day | $0.50/mo per 10M reads |
| Domain | — | $12/year |
| Apple Developer | — | $99/year |
| **Total** | **~$0/mo** | **~$14/mo at scale** |

---

## Troubleshooting

### "Worker not found" after deploy

DNS propagation hasn't completed. Wait 15 minutes, then check:
```bash
dig yourdomain.com +short
```

### D1 migration fails with "table already exists"

The migration was partially applied. This is safe — the script handles it.
To verify, check the tables:
```bash
npx wrangler d1 execute ourwkrp-staging --command="SELECT name FROM sqlite_master WHERE type='table'"
```

### Spotify auth fails

1. Verify redirect URI matches exactly (including trailing slash)
2. Check Spotify app is not in "development mode" rate limit
3. Verify `SPOTIFY_CLIENT_ID` in Doppler matches the app dashboard

### Brand subdomain returns default theme

1. Check the `brands` table has an entry for that subdomain
2. Check DNS wildcard record exists (`*.yourdomain.com`)
3. Check wrangler.toml has the wildcard route pattern

### KV session errors

KV namespace IDs in wrangler.toml must match the actual provisioned IDs:
```bash
npx wrangler kv:namespace list
```
Compare with values in `wrangler.toml`.
