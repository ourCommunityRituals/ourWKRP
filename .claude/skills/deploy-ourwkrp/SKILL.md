---
name: deploy-ourwkrp
description: Deploy ourWKRP to staging or production with pre-flight checks, Doppler secrets, and post-deploy verification
disable-model-invocation: true
argument-hint: "[staging|prod]"
allowed-tools: Bash Read Grep
---

# Deploy ourWKRP

Deploy to **$ARGUMENTS** environment.

## Pre-flight checks (all must pass)

1. Verify clean git state: `git status --porcelain` should be empty
2. Run full test suite: `npm test` — all 65+ tests must pass
3. Run typecheck: `npm run typecheck`
4. Run lint: `npm run lint`
5. Verify current branch: should be `main` for production, feature branch OK for staging

## Map environment

- `staging` or `stg` → Doppler config `stg`, wrangler default env
- `prod` or `production` or `prd` → Doppler config `prd`, wrangler `--env production`

## Deploy

```bash
# Staging
doppler run -c stg -- wrangler deploy

# Production
doppler run -c prd -- wrangler deploy --env production
```

## Post-deploy verification

1. Health check: `curl -s https://<domain>/health` (stg.ourwkrp.com or ourwkrp.com)
2. Auth start: `curl -s -o /dev/null -w "%{http_code}" https://<domain>/auth/start` — should redirect (302)
3. Home page: `curl -s -o /dev/null -w "%{http_code}" https://<domain>/` — should return 200

## If anything fails

Stop immediately. Report the failure. Do NOT attempt rollback without user confirmation.
