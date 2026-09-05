[CmdletBinding()]
param(
  [ValidateSet("trigger", "next")]
  [string]$Start,
  [string]$BwsProjectId = "47ec1504-ac10-4577-89fe-b46c00772ec4",
  [switch]$LocalTrigger,
  [switch]$Production,
  [string]$LocalTriggerApiUrl = "http://127.0.0.1:8030",
  [string]$LocalTriggerProjectRef = "proj_jgeclohuxwwdjwlctdnf",
  [string]$LocalEssentiaApiUrl = "https://essentia.v1su4.dev",
  [string]$MediaGatewayInternalUrl = "http://100.99.110.105:4545",
  [string]$LocalAppUrl = "http://192.168.8.175:3000",
  [string]$LocalHiggsfieldCredentialsPath = (Join-Path $env:USERPROFILE "Documents\Github\trigger-dev-local\higgsfield-gordo-credentials.json"),
  [string]$LocalTriggerEnvFile = (Join-Path $env:USERPROFILE "Documents\Github\trigger-dev-local\stack-structure-local-trigger.env")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($LocalTrigger -and $Production) {
  throw "LocalTrigger and Production are mutually exclusive."
}

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
$localTriggerKey = [Environment]::GetEnvironmentVariable("STACK_STRUCTURE_LOCAL_TRIGGER_SECRET_KEY", "Process")
if ($LocalTrigger -and [string]::IsNullOrWhiteSpace($localTriggerKey)) {
  throw "Local Trigger mode requires STACK_STRUCTURE_LOCAL_TRIGGER_SECRET_KEY in the current process environment."
}
$localCaptionToken = [Environment]::GetEnvironmentVariable("STACK_STRUCTURE_LOCAL_CAPTION_API_TOKEN", "Process")
$remoteCaptionUrl = if ($LocalTrigger) { "" } else { Get-BwsSecretValue "SCENE_CAPTION_GATEWAY_URL" $byName }
$remoteCaptionToken = if ($LocalTrigger) { "" } else { Get-BwsSecretValue "SCENE_CAPTION_GATEWAY_TOKEN" $byName }

$envValues = @{
  AUTH_GITHUB_ID = Get-BwsSecretValue "STACK_STRUCTURE_AUTH_GITHUB_ID" $byName
  AUTH_GITHUB_SECRET = Get-BwsSecretValue "STACK_STRUCTURE_AUTH_GITHUB_SECRET" $byName
  AUTH_SECRET = Get-BwsSecretValue "STACK_STRUCTURE_AUTH_SECRET" $byName
  AUTH_URL = $LocalAppUrl
  AUTH_TRUST_HOST = "true"
  TRIGGER_API_URL = if ($LocalTrigger) { $LocalTriggerApiUrl } else { "https://trigger.v1su4.dev" }
  TRIGGER_SECRET_KEY = if ($LocalTrigger) {
    $localTriggerKey
  } elseif ($Production) {
    Get-BwsSecretValue "STACK_STRUCTURE_TRIGGER_PROD_SECRET_KEY" $byName
  } else {
    Get-BwsSecretValue "STACK_STRUCTURE_TRIGGER_DEV_SECRET_KEY" $byName
  }
  TRIGGER_PROJECT_REF = if ($LocalTrigger) { $LocalTriggerProjectRef } else { "proj_wlrcsfnmovzmdwzojzfe" }
  STACK_STRUCTURE_LOCAL_TRIGGER = if ($LocalTrigger) { "1" } else { "" }
  MEDIA_GATEWAY_URL = Get-BwsSecretValue "MEDIA_GATEWAY_URL" $byName
  # Large preview/final uploads must bypass Cloudflare's request-body limit.
  # VM114's tailnet origin is reachable from both the Windows rehearsal host
  # and the VM100 Trigger worker.
  MEDIA_GATEWAY_INTERNAL_URL = $MediaGatewayInternalUrl
  MEDIA_GATEWAY_TOKEN = Get-BwsSecretValue "MEDIA_GATEWAY_TOKEN" $byName
  MEDIA_API_TOKEN = Get-BwsSecretValue "MEDIA_API_TOKEN" $byName
  FFMPEG_GATEWAY_URL = Get-BwsSecretValue "FFMPEG_GATEWAY_URL" $byName
  FFMPEG_GATEWAY_API_KEY = Get-BwsSecretValue "FFMPEG_GATEWAY_API_KEY" $byName
  SWARMUI_URL = if ($LocalTrigger) { Get-BwsSecretValue "SWARMUI_URL" $byName } else { "" }
  SCENE_CAPTION_SMART_GATEWAY_URL = if ($LocalTrigger) { "http://127.0.0.1:18091" } else { $remoteCaptionUrl }
  SCENE_CAPTION_SMART_GATEWAY_TOKEN = if ($LocalTrigger) { $localCaptionToken } else { $remoteCaptionToken }
  QWEN_CAPTION_GATEWAY_TOKEN = if ($LocalTrigger) { $localCaptionToken } else { $remoteCaptionToken }
  MEDIA_WORKER_URL = if ($LocalTrigger) { "http://127.0.0.1:18090" } else { "" }
  DEEPGRAM_API_KEY = Get-BwsSecretValue "DEEPGRAM_API_KEY" $byName
  # The historical BWS bearer is expired. Local Higgsfield uses the isolated
  # official CLI credential file; do not inject the stale bearer elsewhere.
  HIGGSFIELD_ACCESS_TOKEN = ""
  HIGGSFIELD_CREDENTIALS_PATH = if ($LocalTrigger) { $LocalHiggsfieldCredentialsPath } else { "" }
  HIGGSFIELD_CLI_PATH = if ($LocalTrigger) { Join-Path $env:APPDATA "npm\node_modules\@higgsfield\cli\vendor\hf.exe" } else { "" }
  ESSENTIA_API_URL = if ($LocalTrigger) { $LocalEssentiaApiUrl } else { Get-BwsSecretValue "ESSENTIA_API_URL" $byName }
  ESSENTIA_API_KEY = Get-BwsSecretValue "ESSENTIA_API_KEY" $byName
}

foreach ($entry in $envValues.GetEnumerator()) {
  Set-Item -Path "Env:$($entry.Key)" -Value ([string]$entry.Value)
}

Write-Host "Loaded BWS-backed Project Stack Structure $(if ($Production) { 'production' } else { 'staging' }) environment."
Write-Host "Trigger control plane: $env:TRIGGER_API_URL"
Write-Host "Generation provider: $(if ($env:SWARMUI_URL) { $env:SWARMUI_URL } else { '(local generation disabled)' })"
Write-Host "Caption gateway: $env:SCENE_CAPTION_SMART_GATEWAY_URL"
Write-Host "Media processing: $(if ($env:MEDIA_WORKER_URL) { $env:MEDIA_WORKER_URL } else { "queued through $env:MEDIA_GATEWAY_URL" })"
Write-Host "Secret values were not printed."

if ($Start -eq "trigger") {
  if ($LocalTrigger) {
    $envLines = foreach ($entry in ($envValues.GetEnumerator() | Sort-Object Key)) {
      $value = ([string]$entry.Value).Replace("`r", "").Replace("`n", "")
      "$($entry.Key)=$value"
    }
    [System.IO.File]::WriteAllLines(
      $LocalTriggerEnvFile,
      [string[]]$envLines,
      [System.Text.UTF8Encoding]::new($false)
    )
    Write-Host "Local Trigger env file refreshed outside the repository."
    & bunx "trigger.dev@$triggerCliVersion" dev start --profile stack-structure-local --env-file $LocalTriggerEnvFile
  } else {
    & bunx "trigger.dev@$triggerCliVersion" dev
  }
  exit $LASTEXITCODE
}

if ($Start -eq "next") {
  & bun run start
  exit $LASTEXITCODE
}
