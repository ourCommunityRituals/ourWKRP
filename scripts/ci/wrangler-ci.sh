#!/usr/bin/env bash
# Run wrangler in CI with the deploy token, under `doppler run --`.
#
#   doppler run -- bash scripts/ci/wrangler-ci.sh <stg_deploy|prd_deploy> check
#   doppler run -- bash scripts/ci/wrangler-ci.sh <stg_deploy|prd_deploy> <wrangler args...>
#
# ADR-012 §3: a deploy key lives in its own Doppler config (stg_deploy,
# prd_deploy), never in the runtime configs (stg, prd) that can reach the
# Worker. So before anything runs, the service token must read
# ourwkrp/<config> and that config must hold CLOUDFLARE_API_TOKEN_OW.
# Doppler adds DOPPLER_PROJECT and DOPPLER_CONFIG to every `doppler run`.
#
# The stored name is OW's own (the Cloudflare token is named
# ourwkrp-ci-deploy). Wrangler only reads CLOUDFLARE_API_TOKEN, so it is set
# for the wrangler process alone and the stored name is unset.
set -euo pipefail

want="${1:-}"
case "$want" in
  stg_deploy | prd_deploy) shift ;;
  *)
    echo "usage: wrangler-ci.sh <stg_deploy|prd_deploy> check | <wrangler args...>" >&2
    exit 2
    ;;
esac
[ "$#" -gt 0 ] || { echo "usage: wrangler-ci.sh $want check | <wrangler args...>" >&2; exit 2; }

got="${DOPPLER_PROJECT:-?}/${DOPPLER_CONFIG:-?}"
if [ "$got" != "ourwkrp/$want" ]; then
  echo "::error title=Wrong Doppler config::The Doppler service token reads $got. Deploys need ourwkrp/$want: make a service token for that config and save it as this job's DOPPLER_TOKEN secret."
  exit 1
fi

if [ -z "${CLOUDFLARE_API_TOKEN_OW:-}" ]; then
  echo "::error title=Deploy token missing::CLOUDFLARE_API_TOKEN_OW is not set in the Doppler $want config (project ourwkrp)."
  exit 1
fi

if [ "$1" = check ]; then
  echo "Doppler ourwkrp/$want provides CLOUDFLARE_API_TOKEN_OW."
  exit 0
fi

export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN_OW"
unset CLOUDFLARE_API_TOKEN_OW
exec npx wrangler "$@"
