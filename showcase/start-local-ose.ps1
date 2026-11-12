# Starts a throwaway local OurSharedEvents worker for the creator showcase.
# Local only: in-process miniflare, its own data folder, its own port.
# Keys are random per run and exist only for this worker; they are written to
# showcase/local-ose.env.json, which git ignores.
#   ./showcase/start-local-ose.ps1 -Worker <ourSharedEvents>\workers\oursharedevents
param(
  [Parameter(Mandatory = $true)][string]$Worker,
  [string]$Data = (Join-Path ([IO.Path]::GetTempPath()) 'creator-showcase-ose'),
  [int]$Port = 8917
)
$ErrorActionPreference = 'Stop'
function RandHex { -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }) }
$adminKey = 'showcase-local-' + (RandHex).Substring(0, 16)
$envFile = Join-Path $PSScriptRoot 'local-ose.env.json'
@{ base = "http://127.0.0.1:$Port"; adminKey = $adminKey } | ConvertTo-Json | Set-Content -Encoding utf8 $envFile
Set-Location $Worker
New-Item -ItemType Directory -Force $Data | Out-Null
npx wrangler d1 migrations apply DB --local --persist-to $Data
npx wrangler d1 migrations apply FORMS_DB --local --persist-to $Data
npx wrangler dev --local --port $Port --ip 127.0.0.1 --persist-to $Data --test-scheduled `
  --var "ADMIN_KEY:$adminKey" `
  --var ALLOW_ADMIN_KEY_FALLBACK:true `
  --var ADMIN_SCOPE_ALL:true `
  --var "SHARED_REPORT_SIGNING_SECRET:$(RandHex)" `
  --var "FORMS_ENCRYPTION_KEY:$(RandHex)" `
  --var "FORMS_HASH_PEPPER:$(RandHex)" `
  --var "ANON_ID_HASH_PEPPER:$(RandHex)" `
  --var PUBLISH_GRACE_MINUTES:0
