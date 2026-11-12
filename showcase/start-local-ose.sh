#!/usr/bin/env bash
# Start a throwaway local OurSharedEvents worker for the creator showcase (CI
# and Linux/macOS). Local only: in-process miniflare, its own data folder and
# port. Keys are random per run, written to showcase/local-ose.env.json (git
# ignores it) and masked in CI logs. The worker runs in the background; its log
# goes to $DATA/wrangler.log and its pid to $DATA/wrangler.pid.
#   bash showcase/start-local-ose.sh <ourSharedEvents>/workers/oursharedevents [data-dir] [port]
set -euo pipefail

WORKER="${1:?usage: start-local-ose.sh <ose-worker-dir> [data-dir] [port]}"
DATA="${2:-${RUNNER_TEMP:-/tmp}/creator-showcase-ose}"
PORT="${3:-8917}"
HERE="$(cd "$(dirname "$0")" && pwd)"

randhex() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }
ADMIN_KEY="showcase-local-$(randhex | cut -c1-16)"
if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$ADMIN_KEY"; fi
printf '{ "base": "http://127.0.0.1:%s", "adminKey": "%s" }\n' "$PORT" "$ADMIN_KEY" > "$HERE/local-ose.env.json"

mkdir -p "$DATA"
cd "$WORKER"
npx wrangler d1 migrations apply DB --local --persist-to "$DATA" >/dev/null
npx wrangler d1 migrations apply FORMS_DB --local --persist-to "$DATA" >/dev/null

nohup npx wrangler dev --local --port "$PORT" --ip 127.0.0.1 --persist-to "$DATA" --test-scheduled \
  --var "ADMIN_KEY:$ADMIN_KEY" \
  --var ALLOW_ADMIN_KEY_FALLBACK:true \
  --var ADMIN_SCOPE_ALL:true \
  --var "SHARED_REPORT_SIGNING_SECRET:$(randhex)" \
  --var "FORMS_ENCRYPTION_KEY:$(randhex)" \
  --var "FORMS_HASH_PEPPER:$(randhex)" \
  --var "ANON_ID_HASH_PEPPER:$(randhex)" \
  --var PUBLISH_GRACE_MINUTES:0 > "$DATA/wrangler.log" 2>&1 &
echo $! > "$DATA/wrangler.pid"

for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "local OSE worker up on 127.0.0.1:$PORT"
    exit 0
  fi
  sleep 2
done
echo "::error::local OSE worker did not answer /health within 180 s"
tail -n 60 "$DATA/wrangler.log" || true
exit 1
