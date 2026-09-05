[CmdletBinding()]
param(
  [string]$NextBaseUrl = "http://127.0.0.1:3000",
  [switch]$LocalOnly,
  [switch]$Production,
  [switch]$RunLocalGeneration,
  [switch]$RunCoreMatrix,
  [switch]$SkipAnalysisStages,
  [switch]$RunFailureProbe,
  [string]$ContactSheetPath,
  [string]$FixtureRoot,
  [int]$RunTimeoutSeconds = 1800
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
  $FixtureRoot = Join-Path (Split-Path $PSScriptRoot -Parent) ".local-fixtures\media"
}

function Assert-HttpOk([string]$name, [string]$url, [hashtable]$request = @{}) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 20 @request
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      throw "$name returned HTTP $($response.StatusCode)."
    }
    Write-Host "PASS $name HTTP $($response.StatusCode)"
    return $response
  } catch {
    throw "$name failed: $($_.Exception.Message)"
  }
}

function Read-Json([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return @{} }
  return $text | ConvertFrom-Json
}

function Wait-TriggerRun([string]$runId, [int]$timeoutSeconds, [switch]$ExpectFailure) {
  $deadline = (Get-Date).ToUniversalTime().AddSeconds($timeoutSeconds)
  do {
    $run = Invoke-RestMethod -Uri "$NextBaseUrl/api/orchestration/runs/$([uri]::EscapeDataString($runId))" -TimeoutSec 20
    if ($run.isFailed -or $run.isCancelled) {
      if ($ExpectFailure) { return $run }
      throw "Trigger run $runId ended terminally: $($run.error)"
    }
    if ($run.isCompleted) {
      if ($ExpectFailure) { throw "Trigger run $runId completed successfully; expected a terminal failure." }
      if (-not $run.isSuccess) { throw "Trigger run $runId failed: $($run.error)" }
      return $run
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date).ToUniversalTime() -lt $deadline)

  throw "Trigger run $runId timed out after $timeoutSeconds seconds."
}

function Get-RunOutput([string]$runId, [int]$timeoutSeconds) {
  return (Wait-TriggerRun $runId $timeoutSeconds).output
}

function Get-DurableUrls($value) {
  if ($null -eq $value) { return }
  $json = $value | ConvertTo-Json -Depth 20 -Compress
  foreach ($match in [regex]::Matches($json, 'https?://[^"\\\s]+')) {
    $url = [string]$match.Value
    if ($url -match '(media|s3)\.v1su4\.dev') { $url }
  }
}

function Assert-DurableOutput([string]$name, $output) {
  $urls = @(Get-DurableUrls $output | Sort-Object -Unique | Select-Object -First 20)
  if (-not $urls.Count) { throw "$name returned no durable media.v1su4.dev or s3.v1su4.dev URL." }
  foreach ($url in $urls) { Assert-HttpOk "$name durable output" $url | Out-Null }
  Write-Host "PASS $name exposed $($urls.Count) reachable durable URL(s)"
}

function Assert-Fixture([string]$name) {
  $path = Join-Path $FixtureRoot $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required fixture is missing: $path" }
  return (Get-Item -LiteralPath $path)
}

function Wait-QueuedOutput([string]$name, $queued) {
  $runId = [string]$queued.runId
  if ([string]::IsNullOrWhiteSpace($runId)) { throw "$name returned no Trigger run ID." }
  Write-Host "QUEUED $name run=$runId"
  $output = Get-RunOutput $runId $RunTimeoutSeconds
  Assert-DurableOutput $name $output
  return $output
}

if (-not $LocalOnly) {
  if ($Production) {
    . (Join-Path $PSScriptRoot "load-production-app-env.ps1")
  } else {
    . (Join-Path $PSScriptRoot "load-trigger-staging-env.ps1")
  }
  Assert-HttpOk "Trigger control plane" "$env:TRIGGER_API_URL/healthcheck" | Out-Null
}

if (-not $Production) {
  $session = Assert-HttpOk "SwarmUI" "http://127.0.0.1:7861/API/GetNewSession" @{
    Method = "Post"
    ContentType = "application/json"
    Body = "{}"
  }
  $sessionPayload = Read-Json $session.Content
  if ([string]::IsNullOrWhiteSpace([string]$sessionPayload.session_id)) { throw "SwarmUI returned no session_id." }

  foreach ($port in @(18090, 18091, 18092)) {
    Assert-HttpOk "local service $port" "http://127.0.0.1:$port/health" | Out-Null
  }
}

if (-not $LocalOnly -and -not $Production) {
  Assert-HttpOk "FFmpeg gateway" "$($env:FFMPEG_GATEWAY_URL.TrimEnd('/'))/health" | Out-Null
}

$providers = Assert-HttpOk "Next local-provider route" "$NextBaseUrl/api/generate/local" | ForEach-Object { Read-Json $_.Content }
if (-not $providers.providers) { throw "Next local-provider route returned no providers." }
Write-Host "PASS Next returned $(@($providers.providers).Count) local provider records"

if ($RunLocalGeneration) {
  if ($LocalOnly) { throw "-RunLocalGeneration requires Trigger/BWS mode; remove -LocalOnly." }

  $body = @{
    provider = "swarmui"
    kind = "image"
    prompt = "a small blue ceramic sphere on a neutral studio background"
    width = 512
    height = 512
    steps = 4
    cfg = 2
    seed = 20260712
    batchSize = 1
  } | ConvertTo-Json -Compress

  $queued = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/generate/local" -ContentType "application/json" -Body $body -TimeoutSec 30
  if ([string]::IsNullOrWhiteSpace([string]$queued.runId)) { throw "Next local-generation route returned no Trigger run ID." }
  $duplicate = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/generate/local" -ContentType "application/json" -Body $body -TimeoutSec 30
  if ([string]$duplicate.runId -ne [string]$queued.runId) {
    throw "Local generation idempotency failed: $($queued.runId) != $($duplicate.runId)"
  }
  Write-Host "PASS local generation idempotency returned run=$($queued.runId) twice"
  Write-Host "QUEUED local generation run=$($queued.runId)"

  $output = Get-RunOutput ([string]$queued.runId) $RunTimeoutSeconds
  $assets = @($output.assets)
  if ($assets.Count -lt 1) { throw "Local generation completed without assets." }
  foreach ($asset in $assets) {
    $url = [string]$asset.storage.mediaUrl
    if ([string]::IsNullOrWhiteSpace($url)) { $url = [string]$asset.storage.publicUrl }
    if ([string]::IsNullOrWhiteSpace($url)) { throw "Generated asset has no durable media URL." }
    Assert-HttpOk "durable generated asset" $url | Out-Null
  }
  Write-Host "PASS local generation completed with $($assets.Count) durable asset(s)"
}

if ($RunCoreMatrix) {
  if ($LocalOnly) { throw "-RunCoreMatrix requires Trigger/BWS mode; remove -LocalOnly." }

  $audio = Assert-Fixture "trigger-verification-speech.wav"
  $video = Assert-Fixture "trigger-verification-video.mp4"
  $shader = Assert-Fixture "trigger-verification-shader.webm"
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

  if (-not $SkipAnalysisStages) {
    $grid = Assert-Fixture "trigger-verification-grid.png"
    $essentiaQueued = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/essentia/full?mode=full" -Form @{ file = $audio } -TimeoutSec 60
    $essentiaOutput = Wait-QueuedOutput "Essentia analysis" $essentiaQueued
    if (-not $essentiaOutput.bpm -or -not @($essentiaOutput.beats).Count) { throw "Essentia output omitted BPM or beats." }

    $deepgramQueued = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/deepgram/transcribe" -InFile $audio.FullName -ContentType "audio/wav" -Headers @{ "x-audio-filename" = $audio.Name } -TimeoutSec 60
    $deepgramOutput = Wait-QueuedOutput "Deepgram transcription" $deepgramQueued
    if ([string]::IsNullOrWhiteSpace([string]$deepgramOutput.results.summary.short)) { throw "Deepgram output omitted the transcript summary." }

    $splitQueued = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/splitter/image" -Form @{ file = $grid; rows = "2"; cols = "2"; gutter_px = "0" } -TimeoutSec 60
    $splitOutput = Wait-QueuedOutput "image splitter" $splitQueued
    if (@($splitOutput.manifest.panels).Count -ne 4) { throw "Image splitter did not return four 2x2 panels." }
  }

  if (-not [string]::IsNullOrWhiteSpace($ContactSheetPath)) {
    if (-not (Test-Path -LiteralPath $ContactSheetPath -PathType Leaf)) { throw "Contact sheet is missing: $ContactSheetPath" }
    $contactSheet = Get-Item -LiteralPath $ContactSheetPath
    $contactQueued = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/splitter/image" -Form @{ file = $contactSheet; rows = "3"; cols = "3"; gutter_px = "0" } -TimeoutSec 60
    $contactOutput = Wait-QueuedOutput "3x3 contact-sheet splitter" $contactQueued
    if (@($contactOutput.manifest.panels).Count -ne 9) { throw "Contact-sheet splitter did not return nine 3x3 panels." }
  }

  $segments = ConvertTo-Json -InputObject @(@{ sourceIndex = 0; startTime = 0; endTime = 2 }) -Compress
  $previewQueued = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/preview/gateway" -Form @{
    file = $video
    segments = $segments
    requestKey = "trigger-verifier-preview-$stamp"
  } -TimeoutSec 90
  $previewOutput = Wait-QueuedOutput "FFmpeg preview" $previewQueued
  if ([double]$previewOutput.duration -lt 1.9) { throw "FFmpeg preview duration was shorter than requested." }

  $uploadedVideo = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/storage/upload" -Form @{
    file = $video
    folder = "media-uploads/staging-verifier/$stamp"
  } -TimeoutSec 90
  $uploadedVideoUrl = [string]$uploadedVideo.mediaUrl
  if ([string]::IsNullOrWhiteSpace($uploadedVideoUrl)) { $uploadedVideoUrl = [string]$uploadedVideo.publicUrl }
  Assert-HttpOk "uploaded video fixture" $uploadedVideoUrl | Out-Null
  $mediaBody = @{
    bucket = [string]$uploadedVideo.bucket
    objectKey = [string]$uploadedVideo.objectKey
    mode = "adaptive"
    profile = "verification"
    metadata = @{ verifier = "trigger-staging"; stamp = $stamp }
  } | ConvertTo-Json -Depth 5 -Compress
  $mediaQueuedRaw = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/media/video/jobs" -ContentType "application/json" -Body $mediaBody -TimeoutSec 60
  $mediaQueued = [pscustomobject]@{ runId = [string]$mediaQueuedRaw.job.job_id }
  $mediaOutput = Wait-QueuedOutput "media scene detection and Qwen caption" $mediaQueued
  if ([string]$mediaOutput.result.segments[0].captionModel -notmatch 'Q4') { throw "Media caption did not report a Q4 model." }

  $exportSegments = ConvertTo-Json -InputObject @(@{ sourceIndex = 0; startTime = 0; endTime = 2; musicStart = 0; musicEnd = 2; label = "Verifier" }) -Compress
  $finalQueued = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/export/final" -Form @{
    audio = $audio
    "file:0" = $video
    segments = $exportSegments
    requestKey = "trigger-verifier-final-$stamp"
    beats = "[0,0.5,1,1.5]"
    lyricChunks = '[{"id":"line-1","start":0.1,"end":1.8,"text":"Trigger staging verifier"}]'
    shaderPresetId = "balanced-music-video"
  } -TimeoutSec 120
  $finalOutput = Wait-QueuedOutput "final export" $finalQueued
  if (-not $finalOutput.hasAudio -or -not $finalOutput.hasVideo) { throw "Final export omitted audio or video." }

  $shaderQueued = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/export/shader-capture" -Form @{
    audio = $audio
    shaderCapture = $shader
    requestKey = "trigger-verifier-shader-$stamp"
  } -TimeoutSec 120
  $shaderOutput = Wait-QueuedOutput "shader capture export" $shaderQueued
  if ([string]$shaderOutput.shaderRenderSource -ne "browser-webgpu-capture") { throw "Shader export reported the wrong render source." }

  $probeBody = @{ action = "probe"; inputPath = [string]$finalOutput.videoUrl } | ConvertTo-Json -Compress
  $probeQueued = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/ffglitch" -ContentType "application/json" -Body $probeBody -TimeoutSec 60
  $probeOutput = Get-RunOutput ([string]$probeQueued.runId) $RunTimeoutSeconds
  if (-not @($probeOutput.features).Count) { throw "FFglitch probe returned no features." }
  Write-Host "PASS FFglitch probe features=$(@($probeOutput.features) -join ',')"

  $glitchBody = @{
    action = "glitch"
    inputPath = [string]$finalOutput.videoUrl
    outputPath = "trigger-verifier-$stamp.mp4"
    glitchParams = @{ mode = "amplify"; intensity = 1.15; beatTimes = @(0, 0.5, 1, 1.5) }
  } | ConvertTo-Json -Depth 5 -Compress
  $glitchQueued = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/ffglitch" -ContentType "application/json" -Body $glitchBody -TimeoutSec 60
  $glitchOutput = Wait-QueuedOutput "FFglitch transform" $glitchQueued
  if (-not $glitchOutput.success) { throw "FFglitch transform did not report success." }
}

if ($RunFailureProbe) {
  if ($LocalOnly) { throw "-RunFailureProbe requires Trigger/BWS mode; remove -LocalOnly." }
  $nonce = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $failureBody = @{ action = "probe"; inputPath = "http://127.0.0.1:9/unreachable-$nonce.mp4" } | ConvertTo-Json -Compress
  $queuedFailure = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/ffglitch" -ContentType "application/json" -Body $failureBody -TimeoutSec 30
  if ([string]::IsNullOrWhiteSpace([string]$queuedFailure.runId)) { throw "Failure probe returned no Trigger run ID." }
  $replayedFailure = Invoke-RestMethod -Method Post -Uri "$NextBaseUrl/api/ffglitch" -ContentType "application/json" -Body $failureBody -TimeoutSec 30
  if ([string]$replayedFailure.runId -ne [string]$queuedFailure.runId) {
    throw "Failure replay idempotency failed: $($queuedFailure.runId) != $($replayedFailure.runId)"
  }
  $failedRun = Wait-TriggerRun ([string]$queuedFailure.runId) 120 -ExpectFailure
  if ([string]$failedRun.status -notmatch 'FAILED|CRASHED|CANCELED') { throw "Failure probe did not reach a terminal failure status." }
  Write-Host "PASS bounded failure and idempotent replay run=$($queuedFailure.runId) status=$($failedRun.status)"
}

Write-Host "Trigger verification completed."
