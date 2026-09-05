# Trigger.dev staging checklist

> Historical staging record. The Windows/local control planes are retired.
> Current production operations are documented in
> [Trigger.dev production operations](../operations/trigger-production.md).

This is the temporary Windows RTX 5090 staging path for Project Stack Structure.
The physical apps/VM100 server remains read-only until its replacement RAM is
installed and stable. This document is the handoff for the Windows workstation
and the eventual Linux move.

## Verified topology

```text
Next.js/Vercel API
        |
        v
Trigger.dev queues, retries, idempotency, terminal state
        |
        +--> native Windows SwarmUI API :7861
        |       \-> managed ComfyUI / RTX 5090
        |
        +--> native Windows ComfyUI API :8188 (fallback only)
        |
                +--> Docker Desktop / WSL2
                +--> llama.cpp Qwen3-VL GGUF :18092
                \--> FastAPI caption gateway :18091
                \--> optional RustFS video worker :18090

FFmpeg preview/export and FFglitch use the separate authenticated
`https://ffmpeg.v1su4.dev` gateway from BWS. That service is not hosted on the
unhealthy VM100 Trigger control plane; its `/health` endpoint was HTTP 200 on
the latest staging check.

All generated media and image-split panels -> RustFS media gateway
```

The local provider is an API adapter from the task worker's point of view. It
does not call a browser UI, shell out to a batch file, or rely on provider-local
queue state. `local-generation` is concurrency 1 because SwarmUI/ComfyUI,
llama.cpp, and NVENC share the workstation GPU.

## Completed implementation

- Trigger runtime is explicitly Bun.
- Trigger build includes the FFmpeg 7 extension.
- Long-running media, generation, caption, external-provider, FFglitch, and
  image-split paths use Trigger tasks.
- Essentia, Deepgram, and standalone smart-caption runs persist JSON result
  sidecars under RustFS (`media-uploads/analysis/...`) in addition to the
  Trigger run output; sidecar names include a short source-identity hash to
  avoid collisions.
- Queues are explicit: `local-generation` (1), `external-provider` (2),
  `media-pipeline` (1), and the existing `vm100-heavy` (1).
- Side-effecting provider tasks use bounded or single-attempt retries and stable
  idempotency keys. Terminal failures remain visible through the run-status API.
- Local generation supports SwarmUI by default and direct ComfyUI only when a
  workflow is supplied.
- The caption service is standalone FastAPI calling standalone `llama.cpp`.
  Ollama is not part of the design.
- The model provenance is pinned to the official Qwen Hugging Face repository:
  Q4_K_M language model plus Q8_0 vision projector. No FP16 artifacts are used.
- `scripts/verify-model-manifest.ps1` verifies both local model hashes and the
  Hugging Face source before a Windows staging run is accepted.
- Docker Compose pins the verified upstream `ggml-org/llama.cpp` CUDA server
  image digest and mounts the existing `D:\models` model directory read-only.
- The external FFmpeg gateway is a separate dependency from VM100; its health
  check and BWS API-key injection are part of the pending Trigger E2E gate.
- The caption gateway has a bearer-token hook and the GPU lock is shared with
  future local media workers.
- The temporary media profile uses the existing Proxmox Home video-worker
  source with CPU-safe FFmpeg defaults (`REQUIRE_GPU=false`,
  `FFMPEG_HWACCEL=none`) because VM100's host runtime is not a valid staging
  dependency while its RAM repair is pending. Enable GPU mode only after the
  worker `/health` proves CUDA/NVENC capability.
- Route-boundary tests cover all nine Trigger-backed Next endpoints and verify
  that durable input upload happens before a Trigger run ID is returned.

## Runtime evidence

- Docker Desktop Linux engine: healthy.
- WSL2 distributions: Docker Desktop available; Ubuntu and Ubuntu-AI-Toolkit
  installed but stopped until explicitly needed.
- SwarmUI: listening on `127.0.0.1:7861` from the supplied launcher.
- Qwen: RTX 5090 detected, Q4 model and Q8 projector loaded, `/health` 200.
- FastAPI caption gateway: `/health` 200 and real image caption request passed.
- Repository typecheck, lint, and focused Trigger/FFglitch tests passed.
- Fixture-backed media integration tests require the repository's optional
  `.local-fixtures/media` files; when that directory is absent, the default
  check reports those tests as skipped rather than falsely failing. The
  Trigger/provider E2E matrix below remains a separate runtime gate.

## Route and evidence matrix

| Server path | Trigger task | Durable result | Current evidence |
| --- | --- | --- | --- |
| `/api/generate/local` | `local-ai-generation` | RustFS generated asset | Passed through SwarmUI on the Windows RTX 5090 |
| `/api/generate/higgsfield` | `higgsfield-nano-banana-pro-grid` | Provider asset plus RustFS split panels | Waiting for Trigger control-plane recovery |
| `/api/caption/scene` smart mode | `qwen-smart-scene-caption` | Caption response and optional RustFS sidecar | Passed through local Trigger -> FastAPI + llama.cpp Q4 GGUF -> RustFS |
| `/api/essentia/full` | `essentia-analyze-stored-audio` | Stored audio plus normalized analysis output | Waiting for Trigger control-plane recovery |
| `/api/deepgram/transcribe` | `deepgram-transcribe-stored-audio` | Stored audio plus transcript output | Waiting for Trigger control-plane recovery |
| `/api/media/video/jobs` | `media-video-scene-detect` | RustFS scene manifest, thumbnails, and clips | Direct local media-worker E2E passed; remote Trigger queue pending |
| `/api/preview/section` and `/api/preview/gateway` | `ffmpeg-preview-or-concat` | RustFS MP4 | Waiting for Trigger control-plane recovery and current BWS FFmpeg key injection |
| `/api/export/final` | `ffmpeg-final-music-video-export` | RustFS final MP4 | Waiting for Trigger control-plane recovery |
| `/api/export/shader-capture` | `ffmpeg-shader-capture-export` | RustFS muxed MP4 | Waiting for Trigger control-plane recovery |
| `/api/ffglitch` POST | `ffglitch-transform` | Gateway result | Waiting for Trigger control-plane recovery |
| `/api/splitter/image` | `image-split-grid` | RustFS source and split panels | Waiting for Trigger control-plane recovery |

The browser-only WebGPU preview and provider health probes are intentionally
not Trigger jobs; they do not create server-side long-running work. Every
server-side operation in the table returns a Trigger run ID and is polled
through `/api/orchestration/runs/[runId]`, which converts failed, cancelled,
and timed-out runs into visible terminal errors.

## Required BWS handoff before Trigger E2E

The repo's current `.env.local` contains a production Trigger key. A local
Trigger worker requires the project's default Development key (`tr_dev_...`),
not a production key and not a `tr_uat_...` user token.

Create/store the development value in BWS under a project-specific key such as
`STACK_STRUCTURE_TRIGGER_DEV_SECRET_KEY`, then inject it only into the local
Next.js and Trigger-dev worker processes. Do not commit it, print it, or put it
under a `NEXT_PUBLIC_` name. The production worker keeps
`TRIGGER_API_URL=https://trigger.v1su4.dev`; `-LocalTrigger` overrides that URL
for the temporary local project.

Inject `FFMPEG_GATEWAY_API_KEY`, `MEDIA_GATEWAY_TOKEN`, and the other provider
keys from BWS into the Trigger worker environment as well. Do not allow an
older local `.env` value to override those BWS values.

The checked-in helper `scripts/load-trigger-staging-env.ps1` performs this
injection without printing secret values and always targets the VM100 production
control plane at `https://trigger.v1su4.dev`.

After VM100's Trigger control plane is healthy, start a local Trigger dev worker
with:

```powershell
.\scripts\load-trigger-staging-env.ps1 -Start trigger
```

It reads the BWS project by secret name, so the local `.env` cannot override
the development Trigger key or provider credentials.

Use `scripts/verify-trigger-staging.ps1 -LocalOnly` for the local service
health pass. After starting Next and the Trigger worker with the BWS loader,
run `scripts/verify-trigger-staging.ps1 -RunLocalGeneration` for a local
generation smoke test, or add `-Production` for the production control plane.
recovered VM100 control plane.

For the Windows rehearsal, the worker environment should also resolve:

```text
SWARMUI_URL=http://100.73.126.36:7861
SCENE_CAPTION_SMART_GATEWAY_URL=http://127.0.0.1:18091
MEDIA_GATEWAY_URL=<BWS media gateway URL>
MEDIA_GATEWAY_TOKEN=<BWS media gateway token>
TRIGGER_API_URL=https://trigger.v1su4.dev
TRIGGER_SECRET_KEY=<BWS development key>
```

The current production key remains appropriate only for a deployed production
version. No deployment was performed during this staging pass.

## Final E2E checklist

1. Inject the BWS development key without changing the committed files.
2. Start the Trigger dev worker against `https://trigger.v1su4.dev`.
3. Start Next.js with the same development key and local caption URL.
4. POST one small image request to `/api/generate/local` with provider
   `swarmui`.
5. Poll `/api/orchestration/runs/<runId>` until `COMPLETED` or a terminal
   failure; verify the output contains a RustFS object URL.
6. POST a real scene image to `/api/caption/scene` and verify the caption task
   uses the local FastAPI/Qwen gateway.
7. Enable the local `media` profile, exercise one scene-detection request and
   one preview/export request, confirming both are Trigger runs and outputs are
   durable.
   Set `MEDIA_WORKER_URL=http://127.0.0.1:18090` during the Windows rehearsal
   so the Trigger task uses the local worker instead of racing the remote queue.
8. Exercise the failure path with an unreachable provider and confirm the run
   reaches a terminal failure without an unbounded retry loop.
9. Record the exact BWS names, model manifest hashes, service ports, and
   provider concurrency in the Linux migration notebook.

## Migration to Linux

Move the Compose project and Trigger worker to the stable Linux GPU host after
the RAM repair. Preserve the model manifest, queue limits, idempotency scopes,
RustFS object contract, and callback/auth contract. Change only the provider
URLs, model mount, Docker GPU image/runtime, and BWS-injected environment.

This repository has no Convex dependency or Convex callback endpoint today, so
it does not claim that pattern is implemented. The current authoritative state
is the Trigger run plus the durable RustFS result. When Stack Structure gains a
Convex backend, add an authenticated callback consumer there rather than
silently treating a browser poll as a Convex write.

## Current remote staging status

The VM100 RAM repair and remote cutover were completed on 2026-07-13. Trigger,
Essentia, the RustFS media gateway, and the caption/Qwen gateway are healthy.
The Trigger dashboard uses GitHub OAuth at `https://trigger.v1su4.dev`, and the
production worker completed a real `stack-structure-service-health` run with
all four services ready.

The temporary Windows Trigger/media/Qwen Compose containers were deleted and
Docker Desktop was stopped. No local Next.js server or Trigger dev worker is
part of the active topology. The user-facing app is the Vercel `main`
deployment at `https://project-stack-structure.vercel.app`.

The current Trigger Production deployment still contains the earlier four-task
release. The new parent pipeline, caption batches, finalization task, Studio
GitHub project persistence, and related UI remain on the feature branch until
that branch is committed, reviewed, merged to `main`, and deployed. Do not use
the retired local fallback to bypass that release boundary.
