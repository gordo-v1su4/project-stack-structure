[CmdletBinding()]
param(
  [ValidateSet("production", "preview")]
  [string]$Environment = "production",
  [string]$GitBranch,
  [string]$ManifestPath,
  [string]$VercelCliVersion = "56.1.0"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if ($Environment -eq "preview" -and [string]::IsNullOrWhiteSpace($GitBranch)) {
  throw "Preview synchronization requires -GitBranch so production credentials are not shared with every preview."
}
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $PSScriptRoot "..\config\secrets.manifest.json"
}
if (-not (Get-Command bws -ErrorAction SilentlyContinue)) { throw "BWS CLI is required." }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw "npx is required." }

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$parsedRecords = bws secret list $manifest.bwsProjectId --output json 2>$null | ConvertFrom-Json
$records = @()
foreach ($record in $parsedRecords) { $records += $record }
$byName = @{}
foreach ($record in $records) {
  if ($record.key -and $record.id) { $byName[[string]$record.key] = [string]$record.id }
}

function Read-BwsValue([string]$name) {
  if (-not $byName.ContainsKey($name)) { throw "Required BWS secret is missing: $name" }
  $record = bws secret get $byName[$name] --output json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $record.value) { throw "Unable to read BWS secret: $name" }
  return [string]$record.value
}

function Set-VercelValue([string]$name, [string]$value, [switch]$Sensitive) {
  $arguments = @("vercel@$VercelCliVersion", "env", "add", $name, $Environment)
  if ($Environment -eq "preview") { $arguments += $GitBranch }
  $arguments += @("--force", "--yes", "--no-color")
  $arguments += $(if ($Sensitive) { "--sensitive" } else { "--no-sensitive" })
  $arguments += @("--value", $value)

  $npx = (Get-Command npx.cmd -ErrorAction Stop).Source
  $argumentText = ($arguments | ForEach-Object { '"' + ([string]$_).Replace('"', '\"') + '"' }) -join " "
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $npx
  $startInfo.Arguments = $argumentText
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = [System.Diagnostics.Process]::Start($startInfo)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    $detail = ($stderr + "`n" + $stdout).Trim()
    throw "Vercel environment update failed for $name. $detail"
  }
  Write-Host "Synced Vercel $Environment variable: $name"
}

$secretMappings = @{}
foreach ($entry in $manifest.required) { $secretMappings[[string]$entry.env] = [string]$entry.bws }
foreach ($entry in $manifest.applicationProduction) { $secretMappings[[string]$entry.env] = [string]$entry.bws }
foreach ($entry in ($secretMappings.GetEnumerator() | Sort-Object Key)) {
  Set-VercelValue $entry.Key (Read-BwsValue $entry.Value) -Sensitive
}

$constants = [ordered]@{
  AUTH_TRUST_HOST = "true"
  TRIGGER_API_URL = "https://trigger.v1su4.dev"
  TRIGGER_PROJECT_REF = [string]$manifest.triggerProjectRef
  MEDIA_GATEWAY_BUCKET = "stack-structure"
  MEDIA_GATEWAY_USER_ID = "stack-structure"
  MEDIA_GATEWAY_UPLOAD_PREFIX = "media-uploads"
}
foreach ($entry in $constants.GetEnumerator()) {
  Set-VercelValue $entry.Key ([string]$entry.Value)
}

Write-Host "Vercel $Environment environment synchronized from BWS-backed pointers. Secret values were not printed."
