[CmdletBinding()]
param(
  [ValidateSet("none", "next")]
  [string]$Start = "none",
  [string]$ManifestPath,
  [string]$AppUrl = "http://192.168.8.175:3000"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $PSScriptRoot "..\config\secrets.manifest.json"
}
if (-not (Get-Command bws -ErrorAction SilentlyContinue)) { throw "BWS CLI is required." }
if ($Start -eq "next" -and -not (Get-Command bun -ErrorAction SilentlyContinue)) { throw "Bun is required." }

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$parsedRecords = bws secret list $manifest.bwsProjectId --output json 2>$null | ConvertFrom-Json
$byName = @{}
foreach ($record in $parsedRecords) {
  if ($record.key -and $record.id) {
    $name = [string]$record.key
    if ($byName.ContainsKey($name)) { throw "Duplicate BWS secret name is ambiguous: $name" }
    $byName[$name] = [string]$record.id
  }
}

function Read-BwsValue([string]$name, [bool]$AllowEmpty = $false) {
  if (-not $byName.ContainsKey($name)) { throw "Required BWS secret is missing: $name" }
  $record = bws secret get $byName[$name] --output json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or !$record.id -or (!$record.value -and !$AllowEmpty)) { throw "Unable to read BWS secret: $name" }
  return [string]$record.value
}

$mapping = @{}
foreach ($entry in $manifest.required) { $mapping[[string]$entry.env] = [string]$entry.bws }
foreach ($entry in $manifest.applicationProduction) { $mapping[[string]$entry.env] = [string]$entry.bws }

foreach ($entry in $mapping.GetEnumerator()) {
  Set-Item -Path "Env:$($entry.Key)" -Value (Read-BwsValue $entry.Value -AllowEmpty ($entry.Key -eq 'RUSTFS_S3_ORIGIN_ADDRESS'))
}
$originAddress = $env:RUSTFS_S3_ORIGIN_ADDRESS
if ($originAddress -and ![System.Net.IPAddress]::TryParse($originAddress, [ref]([System.Net.IPAddress]$null))) {
  throw 'The canonical storage origin must be a literal IP address or empty to disable routing.'
}
$env:AUTH_URL = $AppUrl
$env:AUTH_TRUST_HOST = "true"
$env:TRIGGER_API_URL = "https://trigger.v1su4.dev"
$env:TRIGGER_PROJECT_REF = [string]$manifest.triggerProjectRef

Write-Host "Loaded the BWS-backed production application environment."
Write-Host "Application URL: $AppUrl"
Write-Host "Trigger control plane: $env:TRIGGER_API_URL"
Write-Host "Secret values were not printed."

if ($Start -eq "next") {
  & bun run start
  exit $LASTEXITCODE
}
