#!/usr/bin/env bash
# Stage the adjacent @ocr/ui package at the path WKRP's package.json
# expects (`file:../packages/ui`). GITHUB_WORKSPACE lands at
# <runner-work>/ourWKRP/ourWKRP, so `../packages/ui` resolves one level
# up to <runner-work>/ourWKRP/packages/ui — the destination populated
# below. (Runner-agnostic: self-hosted pool retired 2026-09-02, OSE-1194;
# CI now runs on GitHub-hosted ubuntu-latest.)
#
# PINNED, never floating (ADR-008). The hub commit comes from .ocr-hub-ref at
# the repo root — one full 40-char SHA of ourCommunityRituals. The same WKRP
# commit therefore always builds, tests and design-checks against the same
# @ocr/ui; a hub change reaches WKRP only through a PR that bumps the pin.
# (Previously this tracked origin/main, so a hub push could turn WKRP red — or
# green — with no WKRP change at all.)
#
# Idempotent: initialises the cache on first run, then fetches exactly the
# pinned commit. Cache directory (_ocr-workspace-cache) is one level above the
# WKRP checkout.
#
# Auth is unchanged: SOURCE_REPO (OCR_WORKSPACE_REPO) carries the
# x-access-token URL CI builds from OCR_PROPAGATE_TOKEN; GitHub masks it.
# If the fetch fails, the cache is used ONLY when it is already at the pinned
# commit — a stale cache at some other commit is never staged.
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
WS_CACHE="$ROOT/../_ocr-workspace-cache"
TARGET_PARENT="$ROOT/../packages"
SOURCE_REPO="${OCR_WORKSPACE_REPO:-https://github.com/ourCommunityRituals/ourCommunityRituals.git}"
REF_FILE="$ROOT/.ocr-hub-ref"

if [ ! -f "$REF_FILE" ]; then
  echo "[stage] ERROR: $REF_FILE missing — WKRP must pin the hub commit it builds against" >&2
  exit 1
fi
REF="$(tr -d '[:space:]' < "$REF_FILE")"
if ! printf '%s' "$REF" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "[stage] ERROR: .ocr-hub-ref must hold one full 40-char commit SHA, got '$REF'" >&2
  exit 1
fi
echo "[stage] @ocr/ui pinned to ourCommunityRituals@$REF"

if [ ! -d "$WS_CACHE/.git" ]; then
  echo "[stage] initialising hub cache at $WS_CACHE"
  git init -q "$WS_CACHE"
  git -C "$WS_CACHE" remote add origin "$SOURCE_REPO"
else
  git -C "$WS_CACHE" remote set-url origin "$SOURCE_REPO"
fi

if git -C "$WS_CACHE" fetch --depth 1 origin "$REF" && \
   git -C "$WS_CACHE" checkout -q --detach FETCH_HEAD; then
  echo "[stage] fetched pinned hub commit"
else
  echo "[stage] ============================================================"
  echo "[stage] WARNING: fetch of pinned hub commit failed"
  echo "[stage] ============================================================"
fi

HEAD_SHA="$(git -C "$WS_CACHE" rev-parse HEAD 2>/dev/null || echo none)"
if [ "$HEAD_SHA" != "$REF" ]; then
  echo "[stage] ERROR: hub cache is at $HEAD_SHA, not the pinned $REF" >&2
  echo "[stage] likely cause: runner lacks credentials for the hub repo, or the pinned commit was never pushed" >&2
  exit 1
fi
echo "[stage] hub cache at $HEAD_SHA"

if [ ! -d "$WS_CACHE/packages/ui" ]; then
  echo "[stage] ERROR: $WS_CACHE/packages/ui missing at $REF" >&2
  exit 1
fi

mkdir -p "$TARGET_PARENT"
rm -rf "$TARGET_PARENT/ui"
cp -r "$WS_CACHE/packages/ui" "$TARGET_PARENT/ui"
echo "[stage] @ocr/ui (hub $REF) available at $TARGET_PARENT/ui"
