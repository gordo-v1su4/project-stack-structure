[CmdletBinding()]
param(
  [ValidateSet("up", "down", "status", "logs")]
  [string]$Action = "up",
  [switch]$Pull,
  [switch]$ShowMagicLink
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$sourceRoot = "C:\Users\Gordo\Documents\Github\trigger-dev-local"
$dockerRoot = Join-Path $sourceRoot "hosting\docker"
$webCompose = Join-Path $dockerRoot "webapp\docker-compose.yml"
$workerCompose = Join-Path $dockerRoot "worker\docker-compose.yml"
$clickhouseOverride = Join-Path $dockerRoot "clickhouse-25.8.override.yml"
$envFile = Join-Path $dockerRoot ".env.local"
$projectName = "stack-structure-trigger-local"
$pinnedCommit = "a3dca98d43347a0d1d5c3b8f48b93c3e4b24677e"

if (-not (Test-Path $webCompose) -or -not (Test-Path $workerCompose)) {
  throw "Pinned Trigger.dev source is missing at $sourceRoot. Clone tag v4.5.2 before starting the local control plane."
}

$actualCommit = (git -C $sourceRoot rev-parse HEAD).Trim()
if ($actualCommit -ne $pinnedCommit) {
  throw "Trigger.dev source is not the pinned v4.5.2 commit. Expected $pinnedCommit, found $actualCommit."
}

function New-RandomHex([int]$bytes = 16) {
  $buffer = New-Object byte[] $bytes
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($buffer)
  } finally {
    $generator.Dispose()
  }
  return [BitConverter]::ToString($buffer).Replace("-", "").ToLowerInvariant()
}

function Ensure-EnvFile {
  if (Test-Path $envFile) {
    return
  }

  $postgresPassword = New-RandomHex
  $clickhousePassword = New-RandomHex
  $lines = @(
    "# Generated locally by project-stack-structure/scripts/start-local-trigger.ps1",
    "TRIGGER_IMAGE_TAG=v4.5.2",
    "WEBAPP_PUBLISH_IP=127.0.0.1",
    "APP_ORIGIN=http://127.0.0.1:8030",
    "LOGIN_ORIGIN=http://127.0.0.1:8030",
    "API_ORIGIN=http://127.0.0.1:8030",
    "DEV_OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:8030/otel",
    "POSTGRES_DB=main",
    "POSTGRES_PASSWORD=$postgresPassword",
    "DATABASE_URL=postgresql://postgres:$postgresPassword@postgres:5432/main?schema=public&sslmode=disable",
    "DIRECT_URL=postgresql://postgres:$postgresPassword@postgres:5432/main?schema=public&sslmode=disable",
    "SESSION_SECRET=$(New-RandomHex)",
    "MAGIC_LINK_SECRET=$(New-RandomHex)",
    "ENCRYPTION_KEY=$(New-RandomHex)",
    "MANAGED_WORKER_SECRET=$(New-RandomHex)",
    "CLICKHOUSE_USER=default",
    "CLICKHOUSE_PASSWORD=$clickhousePassword",
    "CLICKHOUSE_URL=http://default:$clickhousePassword@clickhouse:8123?secure=false",
    "RUN_REPLICATION_CLICKHOUSE_URL=http://default:$clickhousePassword@clickhouse:8123",
    "DOCKER_REGISTRY_URL=registry:5000",
    "DOCKER_REGISTRY_USERNAME=registry-user",
    "DOCKER_REGISTRY_PASSWORD=very-secure-indeed",
    "DOCKER_REGISTRY_NAMESPACE=trigger",
    "OBJECT_STORE_ACCESS_KEY_ID=admin",
    "OBJECT_STORE_SECRET_ACCESS_KEY=$(New-RandomHex)",
    "MINIO_ROOT_USER=admin",
    "MINIO_ROOT_PASSWORD=$(New-RandomHex)",
    "REALTIME_STREAMS_S2_BASIN=trigger-realtime",
    "NODE_MAX_OLD_SPACE_SIZE=3072",
    "RESTART_POLICY=unless-stopped"
  )

  [System.IO.File]::WriteAllLines($envFile, $lines, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Created local Trigger.dev environment at $envFile"
}

Ensure-EnvFile

$composeArgs = @(
  "--project-name", $projectName,
  "--env-file", $envFile,
  "-f", $webCompose,
  "-f", $workerCompose
)

if (Test-Path $clickhouseOverride) {
  $composeArgs += @("-f", $clickhouseOverride)
}

Push-Location $dockerRoot
try {
  if ($Pull) {
    & docker compose @composeArgs pull
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  switch ($Action) {
    "up" {
      & docker compose @composeArgs up -d
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

      $health = $null
      $deadline = (Get-Date).AddMinutes(5)
      do {
        try {
          $health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8030/healthcheck" -TimeoutSec 5
          if ($health.StatusCode -eq 200) { break }
        } catch { }
        Start-Sleep -Seconds 5
      } while ((Get-Date) -lt $deadline)

      if (-not $health -or $health.StatusCode -ne 200) {
        Write-Host "Local Trigger.dev did not become healthy. Recent webapp logs:"
        & docker compose @composeArgs logs --tail 80 webapp
        exit 1
      }

      Write-Host "Local Trigger.dev is healthy at http://127.0.0.1:8030"
      Write-Host "Pinned release: v4.5.2 ($pinnedCommit)"
      Write-Host "Use the webapp magic link from: docker compose --project-name $projectName --env-file `"$envFile`" -f `"$webCompose`" -f `"$workerCompose`" logs webapp"
      if ($ShowMagicLink) {
        & docker compose @composeArgs logs --tail 120 webapp | Select-String -Pattern "magic|http://|https://"
      }
    }
    "down" {
      & docker compose @composeArgs down
      exit $LASTEXITCODE
    }
    "status" {
      & docker compose @composeArgs ps
      exit $LASTEXITCODE
    }
    "logs" {
      & docker compose @composeArgs logs --tail 120 webapp supervisor
      exit $LASTEXITCODE
    }
  }
} finally {
  Pop-Location
}
