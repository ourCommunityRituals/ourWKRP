#!/usr/bin/env bash
# Why did a Claude step fail? Runs only after a failed Claude step.
#
# Tries the workload identity federation sign-in once by hand: GitHub OIDC
# token -> Claude API token (POST /v1/oauth/token), then one 1-token request
# with the same model. Prints only HTTP status codes and the API's error type
# and message. Tokens stay in shell variables, are masked, and are never
# printed or written outside a temp file that is removed on exit.
#
# Needs: `id-token: write` on the job, and RULE_ID, ORG_ID, MODEL in the env.
# Locked by tests/security/claude-workflow-hardening.invariant.spec.ts.
set -uo pipefail

say() {
  echo "::warning title=Claude did not run::$1"
  { echo '### Claude did not run'; echo; echo "$1"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
}

if [ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] || [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
  say "This job cannot ask GitHub for an OIDC token. It needs \`id-token: write\`."
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

jwt=$(curl -sS -H "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=https://api.anthropic.com" | jq -r '.value // empty' 2>/dev/null)
if [ -z "$jwt" ]; then
  say "GitHub did not hand out an OIDC token."
  exit 0
fi
echo "::add-mask::${jwt}"

jq -n --arg a "$jwt" --arg r "${RULE_ID}" --arg o "${ORG_ID}" \
  '{grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer", assertion:$a, federation_rule_id:$r, organization_id:$o}' \
  > "$tmp/req.json"
code=$(curl -sS -o "$tmp/tok.json" -w '%{http_code}' https://api.anthropic.com/v1/oauth/token \
  -H 'content-type: application/json' --data @"$tmp/req.json") || code=000
rm -f "$tmp/req.json"
if [ "$code" != 200 ]; then
  why=$(jq -r '.error | "\(.type): \(.message)"' "$tmp/tok.json" 2>/dev/null || echo 'no error body')
  say "Federation sign-in answered HTTP ${code} ${why}. The Console's Workload identity > History tab shows the reason."
  exit 0
fi
access=$(jq -r '.access_token // empty' "$tmp/tok.json")
rm -f "$tmp/tok.json"
echo "::add-mask::${access}"

code=$(curl -sS -o "$tmp/probe.json" -w '%{http_code}' https://api.anthropic.com/v1/messages \
  -H "authorization: Bearer ${access}" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
  -d "{\"model\":\"${MODEL}\",\"max_tokens\":1,\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}]}") || code=000
why=$(jq -r '.error | "\(.type): \(.message)"' "$tmp/probe.json" 2>/dev/null || echo 'no error body')
[ "$code" = 200 ] && why='sign-in and model work; the failure is elsewhere'
say "Sign-in worked. The API answered HTTP ${code}: ${why}"
exit 0
