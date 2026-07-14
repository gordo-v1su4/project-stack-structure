[CmdletBinding()]
param(
  [string]$ManifestPath,
  [string]$ModelDirectory = "D:\models\LLM\GGUF\Qwen\Qwen3-VL-4B-Instruct-GGUF"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $PSScriptRoot "..\infra\staging\stack-structure-staging\model-manifest.json"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if (-not ([string]$manifest.source).StartsWith("https://huggingface.co/")) {
  throw "Model manifest source is not a Hugging Face HTTPS repository."
}

foreach ($entry in @($manifest.files)) {
  $name = [string]$entry.name
  if ($name -match "(?i)(fp16|bf16|f16|f32|fp32)") {
    throw "Manifest contains a forbidden non-Q4 artifact: $name"
  }

  $path = Join-Path $ModelDirectory $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Model file is missing: $path"
  }

  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  $expected = ([string]$entry.sha256).ToLowerInvariant()
  if ($actual -ne $expected) {
    throw "SHA256 mismatch for $name. Expected $expected, got $actual."
  }

  Write-Host "PASS $name sha256=$actual"
}

$language = @($manifest.files | Where-Object { $_.role -eq "language-model" })
$projector = @($manifest.files | Where-Object { $_.role -eq "vision-projector" })
if ($language.Count -ne 1 -or $projector.Count -ne 1) {
  throw "Manifest must contain exactly one language model and one vision projector."
}

Write-Host "PASS source=$($manifest.source)"
Write-Host "PASS runtime=$($manifest.runtime) language=$($language[0].name) projector=$($projector[0].name)"
