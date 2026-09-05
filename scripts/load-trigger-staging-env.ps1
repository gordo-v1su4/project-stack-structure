[CmdletBinding()]
param(
  [ValidateSet("trigger", "next")]
  [string]$Start,
  [string]$BwsProjectId = "47ec1504-ac10-4577-89fe-b46c00772ec4",
  [switch]$Production,
  [string]$MediaGatewayInternalUrl = "http://100.99.110.105:4545",
  [string]$LocalAppUrl = "http://192.168.8.175:3000"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Get-Command bws -ErrorAction SilentlyContinue)) {
  throw "Bitwarden Secrets Manager CLI (bws) is required."
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  throw "Bun is required."
}

$packageJsonPath = Join-Path $PSScriptRoot "..\package.json"
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$triggerVersions = @(@(
  [string]$packageJson.dependencies.'@trigger.dev/sdk'
  [string]$packageJson.dependencies.'@trigger.dev/react-hooks'
  [string]$packageJson.devDependencies.'@trigger.dev/build'
) | Select-Object -Unique)
if ($triggerVersions.Count -ne 1 -or [string]::IsNullOrWhiteSpace($triggerVersions[0])) {
  throw "Trigger.dev package pins must use one exact version before starting the CLI."
}
$triggerCliVersion = $triggerVersions[0]

function Get-BwsSecretId([string]$name, [hashtable]$byName) {
  $name = $name.Trim()
  if (-not $byName.ContainsKey($name)) {
    throw "Required BWS secret is missing: $name"
  }
  return [string]$byName[$name]
}

function Get-BwsSecretValue([string]$name, [hashtable]$byName) {
  $id = Get-BwsSecretId $name $byName
  $json = bws secret get $id --output json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $json.value) {
    throw "Unable to read BWS secret: $name"
  }
  return [string]$json.value
}

$parsedRecords = bws secret list $BwsProjectId --output json 2>$null | ConvertFrom-Json
$records = @()
foreach ($record in $parsedRecords) {
  $records += $record
}
if ($LASTEXITCODE -ne 0 -or -not $records.Count) {
  throw "Unable to list BWS project secrets."
}

$byName = @{}
foreach ($record in $records) {
  $name = [string]$record.key
  if ([string]::IsNullOrWhiteSpace($name)) {
    $name = [string]$record.name
  }
  $name = $name.Trim()
  if ($name -and $record.id) {
    if ($byName.ContainsKey($name)) {
      throw "Duplicate BWS secret name is ambiguous: $name"
    }
    $byName[$name] = [string]$record.id
  }
}

$envValues = @{
  AUTH_GITHUB_ID = Get-BwsSecretValue "STACK_STRUCTURE_AUTH_GITHUB_ID" $byName
  AUTH_GITHUB_SECRET = Get-BwsSecretValue "STACK_STRUCTURE_AUTH_GITHUB_SECRET" $byName
  AUTH_SECRET = Get-BwsSecretValue "STACK_STRUCTURE_AUTH_SECRET" $byName
  AUTH_URL = $LocalAppUrl
  AUTH_TRUST_HOST = "true"
  TRIGGER_API_URL = "https://trigger.v1su4.dev"
  TRIGGER_SECRET_KEY = if ($Production) {
    Get-BwsSecretValue "STACK_STRUCTURE_TRIGGER_PROD_SECRET_KEY" $byName
  } else {
    Get-BwsSecretValue "STACK_STRUCTURE_TRIGGER_DEV_SECRET_KEY" $byName
  }
  TRIGGER_PROJECT_REF = "proj_wlrcsfnmovzmdwzojzfe"
  MEDIA_GATEWAY_URL = Get-BwsSecretValue "MEDIA_GATEWAY_URL" $byName
  # Large preview/final uploads must bypass Cloudflare's request-body limit.
  MEDIA_GATEWAY_INTERNAL_URL = $MediaGatewayInternalUrl
  MEDIA_GATEWAY_TOKEN = Get-BwsSecretValue "MEDIA_GATEWAY_TOKEN" $byName
  MEDIA_API_TOKEN = Get-BwsSecretValue "MEDIA_API_TOKEN" $byName
  FFMPEG_GATEWAY_URL = Get-BwsSecretValue "FFMPEG_GATEWAY_URL" $byName
  FFMPEG_GATEWAY_API_KEY = Get-BwsSecretValue "FFMPEG_GATEWAY_API_KEY" $byName
  SCENE_CAPTION_SMART_GATEWAY_URL = Get-BwsSecretValue "SCENE_CAPTION_GATEWAY_URL" $byName
  SCENE_CAPTION_SMART_GATEWAY_TOKEN = Get-BwsSecretValue "SCENE_CAPTION_GATEWAY_TOKEN" $byName
  QWEN_CAPTION_GATEWAY_TOKEN = Get-BwsSecretValue "SCENE_CAPTION_GATEWAY_TOKEN" $byName
  DEEPGRAM_API_KEY = Get-BwsSecretValue "DEEPGRAM_API_KEY" $byName
  ESSENTIA_API_URL = Get-BwsSecretValue "ESSENTIA_API_URL" $byName
  ESSENTIA_API_KEY = Get-BwsSecretValue "ESSENTIA_API_KEY" $byName
}

foreach ($entry in $envValues.GetEnumerator()) {
  Set-Item -Path "Env:$($entry.Key)" -Value ([string]$entry.Value)
}

Write-Host "Loaded BWS-backed Project Stack Structure $(if ($Production) { 'production' } else { 'development' }) environment."
Write-Host "Trigger control plane: $env:TRIGGER_API_URL"
Write-Host "Caption gateway: $env:SCENE_CAPTION_SMART_GATEWAY_URL"
Write-Host "Media processing: queued through $env:MEDIA_GATEWAY_URL"
Write-Host "Secret values were not printed."

if ($Start -eq "trigger") {
  & bunx "trigger.dev@$triggerCliVersion" dev
  exit $LASTEXITCODE
}

if ($Start -eq "next") {
  & bun run start
  exit $LASTEXITCODE
}
