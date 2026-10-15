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
# The pin must also be a MERGED hub commit (reachable from hub main): `git
# fetch <sha>` serves unmerged branch and PR commits too (OSE-1394).
#
# AUTH (OW-150): the org secret OCR_HUB_READ is passed ONLY to the
# staging step (step-scoped env, never workflow-level) and used as a transient
# `-c http.extraheader=...` — never embedded in the remote URL, so it is never
# written to $WS_CACHE/.git/config. Same posture as ourSharedEvents'
# scripts/ci-stage-ocr-workspace.sh.
#
# If the fetch fails, the cache is used ONLY when it already holds the pinned
# commit — a stale cache at some other commit is never staged.
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
WS_CACHE="$ROOT/../_ocr-workspace-cache"
TARGET_PARENT="$ROOT/../packages"
SOURCE_REPO="${OCR_WORKSPACE_REPO:-https://github.com/ourCommunityRituals/ourCommunityRituals.git}"
REF_FILE="$ROOT/.ocr-hub-ref"
HUB_MAIN="${OCR_HUB_MAIN_BRANCH:-main}"

fail() {
  # $1 = short title, $2 = detail. Annotation + non-zero exit: @ocr/ui is required.
  echo "::error title=@ocr/ui staging failed (ADR-008 pin)::$2"
  echo "[stage] FATAL: $1" >&2
  exit 1
}

[ -f "$REF_FILE" ] || fail "no pin file" "$REF_FILE is missing — WKRP must pin the hub commit it builds against."
REF="$(tr -d '[:space:]' < "$REF_FILE")"
[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || fail "bad pin" ".ocr-hub-ref must hold one full 40-char commit SHA (got '$REF')."
echo "[stage] @ocr/ui pinned to ourCommunityRituals@$REF"

AUTH_ARGS=()
if [ -n "${OCR_HUB_READ:-}" ]; then
  AUTH_HEADER="AUTHORIZATION: basic $(printf '%s' "x-access-token:${OCR_HUB_READ}" | base64 | tr -d '\n')"
  AUTH_ARGS=(-c "http.extraheader=${AUTH_HEADER}")
fi

if [ ! -d "$WS_CACHE/.git" ]; then
  echo "[stage] initialising hub cache at $WS_CACHE"
  rm -rf "$WS_CACHE"
  git init -q "$WS_CACHE"
  git -C "$WS_CACHE" remote add origin "$SOURCE_REPO"
else
  git -C "$WS_CACHE" remote set-url origin "$SOURCE_REPO"
fi

if git -C "$WS_CACHE" ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} fetch -q --depth 1 origin "$REF" && \
   git -C "$WS_CACHE" -c advice.detachedHead=false checkout -q --force --detach FETCH_HEAD; then
  echo "[stage] fetched pinned hub commit"
elif git -C "$WS_CACHE" cat-file -e "${REF}^{commit}" 2>/dev/null && \
     git -C "$WS_CACHE" -c advice.detachedHead=false checkout -q --force --detach "$REF"; then
  echo "::warning title=hub fetch failed — using cached pinned commit::fetch of $REF failed, but the local cache already holds that exact commit, so it was used."
else
  if [ -z "${OCR_HUB_READ:-}" ]; then
    CAUSE="OCR_HUB_READ is not available in this run context (e.g. dependabot or a step without the step-scoped env), so the fetch from the private hub was unauthenticated"
  else
    CAUSE="the token is present but the fetch still failed (revoked/expired token, network error, or the pinned commit does not exist on the hub)"
  fi
  fail "could not fetch pinned hub commit" "could not fetch hub commit $REF (.ocr-hub-ref): $CAUSE."
fi

HEAD_SHA="$(git -C "$WS_CACHE" rev-parse HEAD)"
[ "$HEAD_SHA" = "$REF" ] || fail "pin mismatch" "hub cache HEAD is $HEAD_SHA, expected pinned $REF."

# MERGED-ONLY (OSE-1394): the pin must be an ancestor of hub main.
if git -C "$WS_CACHE" ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} fetch -q --filter=blob:none origin \
     "+refs/heads/$HUB_MAIN:refs/remotes/origin/$HUB_MAIN"; then
  git -C "$WS_CACHE" merge-base --is-ancestor "$REF" "refs/remotes/origin/$HUB_MAIN" || \
    fail "pin not on hub $HUB_MAIN" "hub commit $REF (.ocr-hub-ref) is not reachable from hub $HUB_MAIN — pin only merged hub commits."
  echo "[stage] pin is on hub $HUB_MAIN"
elif [ -z "${GITHUB_ACTIONS:-}" ]; then
  echo "::warning title=pin ancestry unverified::could not fetch hub $HUB_MAIN (local run) — ancestry of $REF not checked."
else
  fail "could not fetch hub $HUB_MAIN" "could not fetch hub $HUB_MAIN to verify $REF is merged."
fi

[ -d "$WS_CACHE/packages/ui" ] || fail "pinned hub has no @ocr/ui" "hub commit $REF has no packages/ui."

mkdir -p "$TARGET_PARENT"
rm -rf "$TARGET_PARENT/ui"
cp -r "$WS_CACHE/packages/ui" "$TARGET_PARENT/ui"
echo "[stage] @ocr/ui (hub $REF) available at $TARGET_PARENT/ui"
