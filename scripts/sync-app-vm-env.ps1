[CmdletBinding()]
param(
  [string]$HostName = 'gordo@192.168.8.222',
  [string]$StorageOriginAddress = $env:RUSTFS_S3_ORIGIN_ADDRESS
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# A normal BWS refresh must preserve the private server's routing setting.
# An explicitly supplied empty value disables routing for rollback.
if (!$PSBoundParameters.ContainsKey('StorageOriginAddress') -and !$StorageOriginAddress) {
  $existingOrigin = @(ssh $HostName "sed -n 's/^RUSTFS_S3_ORIGIN_ADDRESS=//p' /opt/project-stack-structure/private.env")
  if ($LASTEXITCODE -ne 0 -or $existingOrigin.Count -gt 1) { throw 'Unable to read the existing storage origin setting.' }
  if ($existingOrigin.Count -eq 1) { $StorageOriginAddress = [string]$existingOrigin[0] }
}
if ($StorageOriginAddress -and ![System.Net.IPAddress]::TryParse($StorageOriginAddress, [ref]([System.Net.IPAddress]$null))) {
  throw 'StorageOriginAddress must be a literal IP address or empty to disable origin routing.'
}
$root = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content (Join-Path $root 'config/secrets.manifest.json') -Raw | ConvertFrom-Json
$parsedRecords = bws secret list $manifest.bwsProjectId --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Live BWS lookup failed.' }
$records = @()
foreach ($record in $parsedRecords) { $records += $record }
$mapping = @{}
foreach ($item in $manifest.required) { $mapping[$item.env] = $item.bws }
foreach ($item in $manifest.triggerProduction) { $mapping[$item.env] = $item.bws }
$mapping.HIGGSFIELD_ALLOWED_IMAGE_HOSTS = 'STACK_STRUCTURE_HIGGSFIELD_ALLOWED_IMAGE_HOSTS'
$values = @{}
foreach ($key in $mapping.Keys) {
  $matches = @($records | Where-Object key -eq $mapping[$key])
  if ($matches.Count -ne 1 -or !$matches[0].value) { throw "BWS lookup is unavailable or ambiguous for $key" }
  $value = [string]$matches[0].value
  if ($key.EndsWith('_JSON')) { $value = $value | ConvertFrom-Json | ConvertTo-Json -Compress -Depth 50 }
  if ($value -match '[\r\n]') { throw "Unsupported multiline environment value for $key" }
  $values[$key] = $value
}
$values.AUTH_URL = 'https://stack.v1su4.dev'
$values.AUTH_TRUST_HOST = 'true'
$values.TRIGGER_API_URL = 'https://trigger.v1su4.dev'
$values.TRIGGER_PROJECT_REF = $manifest.triggerProjectRef
$values.MEDIA_GATEWAY_BUCKET = 'stack-structure'
$values.MEDIA_GATEWAY_USER_ID = 'stack-structure'
$values.MEDIA_GATEWAY_UPLOAD_PREFIX = 'media-uploads'
$values.RUSTFS_S3_ORIGIN_ADDRESS = $StorageOriginAddress
$scratch = Join-Path $root '.env.app-vm-sync'
try {
  $lines = $values.Keys | Sort-Object | ForEach-Object { "$_=$($values[$_])" }
  [IO.File]::WriteAllText($scratch, ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
  scp $scratch "${HostName}:/home/gordo/.stack-structure-env-sync"
  if ($LASTEXITCODE -ne 0) { throw 'Private environment transfer failed.' }
  ssh $HostName 'set -eu; chmod 600 /home/gordo/.stack-structure-env-sync; cp -p /opt/project-stack-structure/private.env /opt/project-stack-structure/private.env.previous; install -m 600 /home/gordo/.stack-structure-env-sync /opt/project-stack-structure/private.env; rm /home/gordo/.stack-structure-env-sync'
  if ($LASTEXITCODE -ne 0) { throw 'Private environment activation failed.' }
  $variables = @($values.Keys | ForEach-Object { @{ key = $_; value = $values[$_]; isSecret = $true } })
  $payload = @{ variables = $variables } | ConvertTo-Json -Compress -Depth 10
  try {
    $response = Invoke-RestMethod -Uri 'http://100.105.199.93:13000/api/stacks/project-stack-structure/env?env=3' -Method Put -ContentType 'application/json' -Headers @{ Origin = 'http://100.105.199.93:13000' } -Body $payload
    if (!$response.success) { throw 'Managed environment save failed.' }
  } catch { throw 'Dockhand runtime synchronization failed; private server copy was retained.' }
  Write-Host 'App VM environment synchronized from live BWS; values were not displayed. Redeploy the app through Dockhand to load it.'
} finally {
  if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch }
}
