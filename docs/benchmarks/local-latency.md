# Local Latency Checkpoint

## Date
2026-04-06T07:05:24.964Z

## Hardware lane
- `local-macos`

## Input
- `/Users/robertspaniolo/Documents/Github/project-stack-structure/.local-fixtures/media/A_mermaid_discovery_202601202346_ttgv4.mp4`
- section window: `0`s -> `1`s

## Result
- success: `true`
- probe duration: `112.98` ms
- preview generation duration: `165.71` ms
- ready-to-play duration: `165.71` ms
- output duration: `1` s
- output path: `/var/folders/9b/9kknzgm501n2695fv1_vj1hm0000gn/T/project-stack-structure-previews/benchmark-1775459124851.mp4`

## Notes
- platform=darwin
- hostname=M3.local

## Interpretation
- The local macOS path can successfully probe fixture media and generate a prepared preview asset.
- This is evidence that the web-first/tooling-first development path is still viable for the current prototype stage.
- This is **not yet** a final platform decision because remote heavy-compute comparison has not been recorded.

## Remaining checkpoint work
- compare this local lane against a remote heavy-compute lane when available
- decide whether preview generation remains acceptable under broader load and richer motion extraction
