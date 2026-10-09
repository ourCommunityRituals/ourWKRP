#!/usr/bin/env bash
# Run wrangler in CI with the deploy token, under `doppler run --`.
#
#   doppler run -- bash scripts/ci/wrangler-ci.sh <stg|prd> check
#   doppler run -- bash scripts/ci/wrangler-ci.sh <stg|prd> <wrangler args...>
#
# ADR-012 §3: a deploy key never sits where the Worker's runtime keys are. OW's
# deploy keys live in their own Doppler project, ourwkrp-deploy (configs stg
# and prd), apart from the runtime project ourwkrp. A separate project because
# Doppler's free plan allows 4 environments per project and ourwkrp already
# holds dev, stg and prd. So before anything runs, the service token must read
# ourwkrp-deploy/<config> and that config must hold CLOUDFLARE_API_TOKEN_OW.
# Doppler adds DOPPLER_PROJECT and DOPPLER_CONFIG to every `doppler run`.
#
# The stored name is OW's own (the Cloudflare token is named
# ourwkrp-ci-deploy). Wrangler only reads CLOUDFLARE_API_TOKEN, so it is set
# for the wrangler process alone and the stored name is unset.
set -euo pipefail

project=ourwkrp-deploy
want="${1:-}"
case "$want" in
  stg | prd) shift ;;
  *)
    echo "usage: wrangler-ci.sh <stg|prd> check | <wrangler args...>" >&2
    exit 2
    ;;
esac
[ "$#" -gt 0 ] || { echo "usage: wrangler-ci.sh $want check | <wrangler args...>" >&2; exit 2; }

got="${DOPPLER_PROJECT:-?}/${DOPPLER_CONFIG:-?}"
if [ "$got" != "$project/$want" ]; then
  echo "::error title=Wrong Doppler config::The Doppler service token reads $got. Deploys need $project/$want: run npm run deploy-keys, which saves a service token for that config as this job's DOPPLER_TOKEN secret."
  exit 1
fi

if [ -z "${CLOUDFLARE_API_TOKEN_OW:-}" ]; then
  echo "::error title=Deploy token missing::CLOUDFLARE_API_TOKEN_OW is not set in the Doppler $want config (project $project)."
  exit 1
fi

if [ "$1" = check ]; then
  echo "Doppler $project/$want provides CLOUDFLARE_API_TOKEN_OW."
  exit 0
fi

export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN_OW"
unset CLOUDFLARE_API_TOKEN_OW
exec npx wrangler "$@"
