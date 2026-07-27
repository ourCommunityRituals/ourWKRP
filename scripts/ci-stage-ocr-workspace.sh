#!/usr/bin/env bash
# Stage the adjacent @ocr/ui package at the path WKRP's package.json
# expects (`file:../packages/ui`). On the self-hosted runner
# GITHUB_WORKSPACE lands at _work/ourWKRP/ourWKRP/, so
# `../packages/ui` resolves to _work/ourWKRP/packages/ui/ —
# the destination populated below.
#
# Idempotent: clones on first run, fast-forwards on subsequent runs.
# Cache directory (_ocr-workspace-cache) is one level above the WKRP
# checkout; survives `clean: false` checkouts within the same runner.
#
# If the runner's git credential cache is broken, the fetch step fails.
# When a local cache exists, the script falls back to the existing cache
# with a loud warning. New runners require valid credentials to clone.
set -euo pipefail

WS_CACHE="${GITHUB_WORKSPACE:-$(pwd)}/../_ocr-workspace-cache"
TARGET_PARENT="${GITHUB_WORKSPACE:-$(pwd)}/../packages"
SOURCE_REPO="${OCR_WORKSPACE_REPO:-https://github.com/ourCommunityRituals/ourCommunityRituals.git}"

if [ ! -d "$WS_CACHE/.git" ]; then
  echo "[stage] cloning $SOURCE_REPO into $WS_CACHE"
  if ! git clone --depth 1 "$SOURCE_REPO" "$WS_CACHE"; then
    echo "[stage] ============================================================" >&2
    echo "[stage] ERROR: initial clone failed and no cache to fall back to" >&2
    echo "[stage] ============================================================" >&2
    echo "[stage] likely cause: runner lacks credentials for $SOURCE_REPO" >&2
    exit 1
  fi
else
  echo "[stage] updating existing clone at $WS_CACHE"
  if git -C "$WS_CACHE" fetch --depth 1 origin main && \
     git -C "$WS_CACHE" reset --hard origin/main; then
    echo "[stage] cache updated from origin main"
  else
    echo "[stage] ============================================================"
    echo "[stage] WARNING: fetch from origin failed — using existing cache as-is"
    echo "[stage] ============================================================"
    echo "[stage] cache's most recent commit:"
    git -C "$WS_CACHE" log --oneline -1 2>&1 || echo "[stage] (could not read cache log)"
    echo "[stage] ============================================================"
  fi
fi

if [ ! -d "$WS_CACHE/packages/ui" ]; then
  echo "[stage] ERROR: $WS_CACHE/packages/ui missing — even fallback cache lacks the package" >&2
  exit 1
fi

mkdir -p "$TARGET_PARENT"
rm -rf "$TARGET_PARENT/ui"
cp -r "$WS_CACHE/packages/ui" "$TARGET_PARENT/ui"
echo "[stage] @ocr/ui available at $TARGET_PARENT/ui"
