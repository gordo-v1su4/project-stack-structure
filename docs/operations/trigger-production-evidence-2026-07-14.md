# Trigger.dev production acceptance evidence — 2026-07-14

This record captures the acceptance run for Project Stack Structure's isolated
Trigger.dev production project. It contains identifiers and safe metadata only;
all credential values remain in BWS.

## Deployment and inventory

- Control plane: `https://trigger.v1su4.dev`
- Project ref: `proj_wlrcsfnmovzmdwzojzfe`
- Worker version: `20260714.2`
- Deployment code: `c9t444ze`
- SDK, build package, React hooks, and CLI: `4.5.3`
- Local definitions: 15
- Active remote definitions: 15
- Inventory comparison: exact match

The active worker exposes:

`deepgram-transcribe-stored-audio`, `essentia-analyze-stored-audio`,
`ffglitch-transform`, `ffmpeg-final-music-video-export`,
`ffmpeg-preview-or-concat`, `ffmpeg-shader-capture-export`,
`higgsfield-nano-banana-pro-grid`, `image-split-grid`, `local-ai-generation`,
`media-video-finalize`, `media-video-pipeline`, `media-video-scene-detect`,
`qwen-scene-caption-batch`, `qwen-smart-scene-caption`, and
`stack-structure-service-health`.

The production health run `run_cmrjztyux00243fn154kkjts5` completed with HTTP
200 responses from Trigger, Essentia 4.0.2, the media/RustFS gateway, and the
CUDA-backed Qwen caption gateway on VM100.

## Correlated successful journey

- Validation key and application record ID:
  `full-media-e2e-2026-07-14-production-replay3`
- Media parent runs: `run_cmrk065vv004b3fn1346uw3x5`,
  `run_cmrk065vv004a3fn1tn8jymdz`, `run_cmrk065vw004c3fn13p5hntfj`
- Scene children: `run_cmrk0689n004o3fn10tz04i1i`,
  `run_cmrk0687x004m3fn17o2y188l`, `run_cmrk06834004k3fn16vo3akvr`
- Serialized Qwen children: `run_cmrk06fda004t3fn1xbkc1p3g`,
  `run_cmrk06k6h004y3fn1uquk5woj`, `run_cmrk06hoq004w3fn1er1yv3ep`
- Finalizers: `run_cmrk06mom00503fn1qe4vwztc`,
  `run_cmrk06rz900543fn1dmm0fwmf`, `run_cmrk06xtp00583fn1ms89xeyd`
- Essentia: `run_cmrk065yg004d3fn1272md2uz`
- Deepgram: `run_cmrk0660m004e3fn1lru3ryj7`
- FFmpeg preview: `run_cmrk07055005b3fn17fzzmkmb`
- FFmpeg final export: `run_cmrk07576005d3fn1fdx8hko9`

All runs above completed. The three Qwen children shared the `vm100-heavy`
queue and started at `01:59:18.889Z`, `01:59:26.136Z`, and `01:59:33.005Z`;
their execution windows did not overlap. Essentia completed in 14.003 seconds,
Deepgram in 3.452 seconds, preview generation in 5.397 seconds, and final export
in 8.304 seconds.

The application normalized three detected scenes with three Qwen3-VL Q4
captions, 17 beats, 47 onsets, 18 transcribed words, and four matched edit
segments. The final source duration was 9.802789 seconds and the downloaded
final output measured 9.802993 seconds with H.264 video and AAC audio.

## Durable storage reads

- Preview object:
  `media-uploads/generated/previews/full-media-e2e-2026-07-14-production-replay3-joined-preview/1783994389134-full-media-e2e-2026-07-14-production-replay3-joined-preview.mp4`
- Final object:
  `media-uploads/generated/exports/full-media-e2e-2026-07-14-production-replay3-final/1783994398303-full-media-e2e-2026-07-14-production-replay3-final.mp4`

Fresh HTTP range reads returned `206` and 1,024 real bytes from both objects.
Their full content lengths were 1,102,327 and 1,230,671 bytes respectively.

## Browser and persistence

The production build was opened while authenticated as GitHub owner
`github-179914528`. The saved project appeared in Project Library with three
clips, three scenes, and `3/3` captions. A full browser reload returned the same
application record and visible counts. The authenticated Work Activity panel
opened with a 15-minute user-tag-scoped realtime token; its empty recent list
was expected because this acceptance dispatch used the isolated anonymous tag.
The browser console contained no warnings or errors.

## Controlled failure and replay

`run_cmrk0ed07005f3fn1v6e1ukxa` exercised an unreachable FFglitch input and
reached terminal `FAILED` in 2.474 seconds. Repeating the identical request
returned the same run ID, proving the dispatcher did not create a duplicate.

## Static verification

The final branch gate passed: lint reported zero errors and two pre-existing
unused-variable warnings, TypeScript typecheck passed, all 244 tests passed,
and the Next 16.2.1 production build completed successfully. The build retains
the known Turbopack whole-project trace warning from dynamic Higgsfield CLI
configuration and Node's experimental localStorage warnings.
