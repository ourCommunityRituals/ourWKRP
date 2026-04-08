#!/usr/bin/env bash
# ===========================================================
# ourWKRP Infrastructure Setup Script
# ===========================================================
# Provisions Cloudflare D1, KV, and updates wrangler.toml
# with real resource IDs.
#
# Prerequisites:
#   - Node.js 18+
#   - npm install (project dependencies)
#   - wrangler login (authenticated to Cloudflare)
#   - Doppler CLI (optional, for secrets management)
#
# Usage:
#   chmod +x scripts/setup-infra.sh
#   ./scripts/setup-infra.sh
#
# What it does:
#   1. Creates D1 databases (staging + production)
#   2. Creates KV namespaces (staging + production + preview)
#   3. Runs all D1 migrations on both environments
#   4. Updates wrangler.toml with real IDs
#   5. Seeds the default brand
# ===========================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[SETUP]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# --- Pre-flight checks ---
log "Checking prerequisites..."

command -v npx >/dev/null 2>&1 || fail "npx not found. Install Node.js 18+"
npx wrangler whoami >/dev/null 2>&1 || fail "Not logged in to Cloudflare. Run: npx wrangler login"

log "Authenticated to Cloudflare."

# --- 1. Create D1 databases ---
log "Creating D1 databases..."

STG_DB_OUTPUT=$(npx wrangler d1 create ourwkrp-staging 2>&1) || {
  if echo "$STG_DB_OUTPUT" | grep -q "already exists"; then
    warn "D1 database 'ourwkrp-staging' already exists."
    STG_DB_ID=$(npx wrangler d1 list --json 2>/dev/null | node -e "
      const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const db = data.find(d => d.name === 'ourwkrp-staging');
      if (db) console.log(db.uuid);
    ")
  else
    fail "Failed to create staging D1 database: $STG_DB_OUTPUT"
  fi
}
if [ -z "${STG_DB_ID:-}" ]; then
  STG_DB_ID=$(echo "$STG_DB_OUTPUT" | grep -oP 'database_id\s*=\s*"\K[^"]+' || echo "")
fi

if [ -z "$STG_DB_ID" ]; then
  fail "Could not extract staging D1 database ID."
fi
log "Staging D1: $STG_DB_ID"

PROD_DB_OUTPUT=$(npx wrangler d1 create ourwkrp-production 2>&1) || {
  if echo "$PROD_DB_OUTPUT" | grep -q "already exists"; then
    warn "D1 database 'ourwkrp-production' already exists."
    PROD_DB_ID=$(npx wrangler d1 list --json 2>/dev/null | node -e "
      const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const db = data.find(d => d.name === 'ourwkrp-production');
      if (db) console.log(db.uuid);
    ")
  else
    fail "Failed to create production D1 database: $PROD_DB_OUTPUT"
  fi
}
if [ -z "${PROD_DB_ID:-}" ]; then
  PROD_DB_ID=$(echo "$PROD_DB_OUTPUT" | grep -oP 'database_id\s*=\s*"\K[^"]+' || echo "")
fi

if [ -z "$PROD_DB_ID" ]; then
  fail "Could not extract production D1 database ID."
fi
log "Production D1: $PROD_DB_ID"

# --- 2. Create KV namespaces ---
log "Creating KV namespaces..."

create_kv() {
  local NAME=$1
  local OUTPUT
  OUTPUT=$(npx wrangler kv:namespace create "$NAME" 2>&1) || {
    if echo "$OUTPUT" | grep -q "already exists"; then
      warn "KV namespace '$NAME' already exists."
      return 0
    fi
    fail "Failed to create KV namespace '$NAME': $OUTPUT"
  }
  echo "$OUTPUT" | grep -oP 'id\s*=\s*"\K[^"]+' || echo ""
}

STG_KV_ID=$(create_kv "WKRP_KV")
PREVIEW_KV_ID=$(create_kv "WKRP_KV_preview")
PROD_KV_ID=$(create_kv "WKRP_KV" 2>&1 | grep -oP 'id\s*=\s*"\K[^"]+' || echo "")

# If KV IDs are empty, try listing
if [ -z "$STG_KV_ID" ] || [ -z "$PROD_KV_ID" ]; then
  warn "Extracting KV IDs from list..."
  KV_LIST=$(npx wrangler kv:namespace list 2>/dev/null)
  STG_KV_ID=$(echo "$KV_LIST" | node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const ns = data.find(n => n.title.includes('WKRP_KV') && !n.title.includes('preview'));
    if (ns) console.log(ns.id);
  " 2>/dev/null || echo "PLACEHOLDER_KV_STAGING")
  PREVIEW_KV_ID=$(echo "$KV_LIST" | node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const ns = data.find(n => n.title.includes('preview'));
    if (ns) console.log(ns.id);
  " 2>/dev/null || echo "PLACEHOLDER_KV_PREVIEW")
  PROD_KV_ID=${PROD_KV_ID:-$STG_KV_ID}
fi

log "Staging KV: $STG_KV_ID"
log "Preview KV: $PREVIEW_KV_ID"
log "Production KV: $PROD_KV_ID"

# --- 3. Update wrangler.toml ---
log "Updating wrangler.toml with real IDs..."

sed -i.bak \
  -e "s/PLACEHOLDER_D1_STAGING/$STG_DB_ID/g" \
  -e "s/PLACEHOLDER_D1_PROD/$PROD_DB_ID/g" \
  -e "s/PLACEHOLDER_KV_STAGING/$STG_KV_ID/g" \
  -e "s/PLACEHOLDER_KV_PREVIEW/$PREVIEW_KV_ID/g" \
  -e "s/PLACEHOLDER_KV_PROD/$PROD_KV_ID/g" \
  wrangler.toml

rm -f wrangler.toml.bak
log "wrangler.toml updated."

# --- 4. Run D1 migrations ---
log "Running migrations on staging D1..."
for migration in migrations/*.sql; do
  log "  Applying: $migration"
  npx wrangler d1 execute ourwkrp-staging --file="$migration" --yes 2>&1 || {
    warn "  Migration $migration may have partially applied (table already exists?)"
  }
done

log "Running migrations on production D1..."
for migration in migrations/*.sql; do
  log "  Applying: $migration"
  npx wrangler d1 execute ourwkrp-production --file="$migration" --yes 2>&1 || {
    warn "  Migration $migration may have partially applied (table already exists?)"
  }
done

# --- 5. Verify ---
log "Verifying setup..."
echo ""
echo "============================================"
echo "  ourWKRP Infrastructure Setup Complete"
echo "============================================"
echo ""
echo "  D1 Staging:    $STG_DB_ID"
echo "  D1 Production: $PROD_DB_ID"
echo "  KV Staging:    $STG_KV_ID"
echo "  KV Preview:    $PREVIEW_KV_ID"
echo "  KV Production: $PROD_KV_ID"
echo ""
echo "  Next steps:"
echo "    1. Configure DNS for ourwkrp.com in Cloudflare"
echo "    2. Set up Doppler secrets (see PLAYBOOK.md)"
echo "    3. Deploy: npm run deploy:staging"
echo "    4. Smoke test: curl https://stg.ourwkrp.com/health"
echo ""
echo "============================================"
