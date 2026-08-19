[CmdletBinding()]
param(
  [string]$ManifestPath,
  [switch]$RequireRuntimeEnv
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $PSScriptRoot "..\config\secrets.manifest.json"
}

if (-not (Get-Command bws -ErrorAction SilentlyContinue)) {
  throw "BWS CLI is required for the secrets preflight."
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$secrets = bws secret list $manifest.bwsProjectId -o json | ConvertFrom-Json
$available = @{}
foreach ($secret in $secrets) {
  $name = [string]$secret.key
  if ($available.ContainsKey($name)) { throw "Duplicate BWS secret name is ambiguous: $name" }
  $available[$name] = $true
}

$runtimeValues = @{}
if (Test-Path -LiteralPath $manifest.runtimeEnv) {
  Get-Content -LiteralPath $manifest.runtimeEnv | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $runtimeValues[$matches[1].Trim()] = $matches[2] }
  }
} elseif ($RequireRuntimeEnv) {
  throw "Runtime env file is missing: $($manifest.runtimeEnv)"
}

$allMappings = @($manifest.required) + @($manifest.applicationProduction) + @($manifest.triggerProduction) + @($manifest.triggerDeployment)
$missingBws = @()
$missingRuntime = @()
foreach ($mapping in $allMappings) {
  if (-not $available.ContainsKey([string]$mapping.bws)) { $missingBws += [string]$mapping.bws }
}
foreach ($mapping in $manifest.required) {
  if ($RequireRuntimeEnv -and -not $runtimeValues.ContainsKey([string]$mapping.env)) { $missingRuntime += [string]$mapping.env }
}

if ($missingBws.Count -gt 0) { throw "Missing required BWS secret names: $($missingBws -join ', ')" }
if ($missingRuntime.Count -gt 0) { throw "Missing required runtime env names: $($missingRuntime -join ', ')" }

[pscustomobject]@{
  BwsProject = $manifest.bwsProjectName
  RequiredSecrets = $allMappings.Count
  ApplicationProductionSecrets = $manifest.applicationProduction.Count
  TriggerProductionSecrets = $manifest.triggerProduction.Count
  TriggerDeploymentSecrets = $manifest.triggerDeployment.Count
  BwsNamesPresent = $true
  RuntimeEnvChecked = [bool]$RequireRuntimeEnv
  RuntimeNamesPresent = if ($RequireRuntimeEnv) { $true } else { $null }
}
