[CmdletBinding()]
param(
  [string]$ManifestPath,
  [string]$TriggerApiUrl = "https://trigger.v1su4.dev",
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $PSScriptRoot "..\config\secrets.manifest.json"
}

if (-not (Get-Command bws -ErrorAction SilentlyContinue)) {
  throw "BWS CLI is required."
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$parsedRecords = bws secret list $manifest.bwsProjectId --output json 2>$null | ConvertFrom-Json
$records = @()
foreach ($record in $parsedRecords) { $records += $record }
if ($LASTEXITCODE -ne 0 -or -not $records.Count) {
  throw "Unable to list the BWS project."
}

$byName = @{}
foreach ($record in $records) {
  $name = [string]$record.key
  if ($name -and $record.id) { $byName[$name] = [string]$record.id }
}

function Read-BwsValue([string]$name) {
  if (-not $byName.ContainsKey($name)) { throw "Required BWS secret is missing: $name" }
  $record = bws secret get $byName[$name] --output json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $record.value) { throw "Unable to read BWS secret: $name" }
  return [string]$record.value
}

$variableNames = @($manifest.triggerProduction | ForEach-Object { [string]$_.env })
if ($DryRun) {
  Write-Host "Project: $($manifest.triggerProjectRef)"
  Write-Host "Production variables: $($variableNames -join ', ')"
  Write-Host "Dry run completed; no values were read or changed."
  exit 0
}

$variables = @{}
foreach ($mapping in $manifest.triggerProduction) {
  $variables[[string]$mapping.env] = Read-BwsValue ([string]$mapping.bws)
}
$apiToken = Read-BwsValue "STACK_STRUCTURE_TRIGGER_PROD_SECRET_KEY"
$body = @{ variables = $variables; override = $true } | ConvertTo-Json -Depth 5 -Compress
$uri = "$($TriggerApiUrl.TrimEnd('/'))/api/v1/projects/$($manifest.triggerProjectRef)/envvars/prod/import"
try {
  $response = Invoke-RestMethod -Method Post -Uri $uri -Headers @{ Authorization = "Bearer $apiToken" } -ContentType "application/json" -Body $body -TimeoutSec 60
} catch {
  $message = "Trigger production environment import failed."
  $failureText = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { [string]$_.ErrorDetails.Message } else { "" }
  if (-not $failureText -and $_.Exception.Response.PSObject.Properties["Content"] -and $_.Exception.Response.Content) {
    $failureText = $_.Exception.Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  }
  if (-not $failureText -and $_.Exception.Response) {
    $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    try { $failureText = $reader.ReadToEnd() } finally { $reader.Dispose() }
  }
  if ($failureText) {
    try {
      $failure = $failureText | ConvertFrom-Json
      $invalid = @($failure.variableErrors | ForEach-Object { [string]$_.name }) | Where-Object { $_ }
      $message = "$message $([string]$failure.error)"
      if ($invalid.Count) { $message = "$message Invalid names: $($invalid -join ', ')" }
    } catch { }
  }
  throw $message
}
if (-not $response.success) { throw "Trigger production environment import did not report success." }

Write-Host "Synced $($variables.Count) BWS-backed variable pointers to Project Stack Structure Trigger production."
Write-Host "Secret values were not printed."
