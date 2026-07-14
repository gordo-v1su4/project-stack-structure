[CmdletBinding()]
param(
  [string]$ManifestPath,
  [string]$SshTarget = "gordo@192.168.8.222",
  [string]$RemotePath = "/home/gordo/.config/project-stack-structure/trigger-deploy.env"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $PSScriptRoot "..\config\secrets.manifest.json"
}
if (-not (Get-Command bws -ErrorAction SilentlyContinue)) { throw "BWS CLI is required." }
if (-not (Get-Command scp -ErrorAction SilentlyContinue)) { throw "scp is required." }
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { throw "ssh is required." }

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$parsedRecords = bws secret list $manifest.bwsProjectId --output json 2>$null | ConvertFrom-Json
$byName = @{}
foreach ($record in $parsedRecords) {
  if ($record.key -and $record.id) { $byName[[string]$record.key] = [string]$record.id }
}

function Read-BwsValue([string]$name) {
  if (-not $byName.ContainsKey($name)) { throw "Required BWS secret is missing: $name" }
  $record = bws secret get $byName[$name] --output json 2>$null | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $record.value) { throw "Unable to read BWS secret: $name" }
  return ([string]$record.value).Replace("`r", "").Replace("`n", "")
}

function ConvertTo-ShellLiteral([string]$value) {
  return "'" + $value.Replace("'", "'\''") + "'"
}

$lines = foreach ($mapping in $manifest.triggerDeployment) {
  $name = [string]$mapping.env
  $value = Read-BwsValue ([string]$mapping.bws)
  "$name=$(ConvertTo-ShellLiteral $value)"
}

$temporaryPath = Join-Path ([System.IO.Path]::GetTempPath()) "stack-structure-trigger-deploy-$([guid]::NewGuid().ToString('N')).env"
$remoteTemporaryPath = "$RemotePath.tmp"
try {
  [System.IO.File]::WriteAllLines($temporaryPath, [string[]]$lines, [System.Text.UTF8Encoding]::new($false))
  $remoteDirectory = $RemotePath.Substring(0, $RemotePath.LastIndexOf('/'))
  & ssh $SshTarget "mkdir -p '$remoteDirectory' && chmod 700 '$remoteDirectory'"
  if ($LASTEXITCODE -ne 0) { throw "Unable to prepare the VM100 deployment directory." }
  & scp -q $temporaryPath "${SshTarget}:$remoteTemporaryPath"
  if ($LASTEXITCODE -ne 0) { throw "Unable to copy the VM100 deployment environment." }
  & ssh $SshTarget "chmod 600 '$remoteTemporaryPath' && mv '$remoteTemporaryPath' '$RemotePath'"
  if ($LASTEXITCODE -ne 0) { throw "Unable to activate the VM100 deployment environment." }
} finally {
  if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
}

Write-Host "Synced the BWS-backed Trigger deployment pointers to VM100 with mode 600."
Write-Host "Secret values were not printed."
