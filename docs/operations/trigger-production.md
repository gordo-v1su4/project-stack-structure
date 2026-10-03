# Trigger.dev production operations

Project Stack Structure uses its own Trigger.dev project. Configure `TRIGGER_API_URL` and `TRIGGER_PROJECT_REF` in `.env.local` (git-ignored).

Before implementing a task or consumer, read the [Trigger execution contract](../protocols/trigger-execution-contract.md). This runbook covers deployment and operations; that contract covers dispatch, progress, validation, return shapes, and acceptance.

- Project ref: `proj_wlrcsfnmovzmdwzojzfe`
- Production dashboard: Trigger.dev UI for the configured project ref
- Platform, CLI, SDK, build, and React hooks: `4.5.16` (production worker host Docker image must match)
- Production deployment host: production worker host Linux
- Authoritative application data: RustFS project JSON, analysis manifests, and generated objects

Pindeck is a separate Trigger project. Never reuse its task IDs, queues, keys,
environment, or deployment history here.

## Production task inventory

| Task | Queue | Durable result |
| --- | --- | --- |
| `stack-structure-service-health` | `service-health` (2) | health result |
| `media-video-pipeline` | `media-pipeline` (3) | child run correlation and final manifest |
| `media-video-scene-detect` | `scene-detection` (3) | scene manifest in RustFS |
| `qwen-scene-caption-batch` | `vm100-heavy` (1) | caption batch in RustFS |
| `media-video-finalize` | `media-finalization` (2) | final analysis manifest in RustFS |
| `essentia-analyze-stored-audio` | `vm100-heavy` (1) | analysis JSON in RustFS |
| `qwen-smart-scene-caption` | `vm100-heavy` (1) | caption JSON in RustFS |
| `qwen-story-treatment` | `vm100-heavy` (1) | story treatments JSON |
| `local-ai-generation` | `vm100-heavy` (1) | generated objects in RustFS |
| `ffmpeg-preview-or-concat` | `media-assembly` (2) | preview MP4 in RustFS |
| `ffmpeg-final-music-video-export` | `media-assembly` (2) | final MP4 in RustFS |
| `ffmpeg-shader-capture-export` | `media-assembly` (2) | muxed MP4 in RustFS |
| `ffmpeg-seedance-audio-reference` | `media-assembly` (2) | section audio reference in RustFS |
| `ffglitch-transform` | `vm100-heavy` (1) | transformed MP4 in RustFS |
| `higgsfield-nano-banana-pro-grid` | `paid-generation` (1) | provider asset and RustFS panels |
| `deepgram-transcribe-stored-audio` | `external-provider` (2) | transcript JSON in RustFS |
| `image-split-grid` | `external-provider` (2) | split panels in RustFS |

Qwen, Essentia, local generation, and FFglitch share one `vm100-heavy`
queue. FFmpeg preview, export, and audio-reference tasks use `media-assembly`
with concurrency 2. Separate queues do not provide a global GPU lock; worker
GPU locking still protects shared hardware. Paid Higgsfield work is independently
serialized and uses one attempt so automatic retries cannot duplicate spend.

Verified through the production worker API on 2026-09-07: worker
`20260907.2` (`worker_cmtqvhk7x00me3is05myhu6b6`) uses SDK/CLI `4.5.16`
and exposes exactly the 17 local task IDs above. Deployment `pqu9v2i8` was built
on Linux from detached source commit `a07cd1ea24f30ad856db0e00cfae651ea2684ddc`
and published to the production worker host registry with image digest
`sha256:c2fd98ff0c3cb044f7a60ace5a019f9603d76e6d84377dcb9f8aad30c92b941c`.
The canonical VM checkout remains clean on `fix/caption-gateway-three-references`
at `50a62f82`; deployment used `paths on the worker host`.
Inventory and build provenance are verified; real story authoring/revision and
persisted caption evidence require their separate browser acceptance checks.

The media parent awaits scene detection, then launches and awaits one Qwen
batch at a time, then awaits finalization. Every child receives the authenticated
user tag, parent run ID, item index, safe stage metadata, and a stable
idempotency key. Durable filenames are derived from source identity, so replay
does not create a second logical manifest.

## Realtime activity

Story authoring and semantic review run as two traced stages inside the same
`qwen-story-treatment` job. The worker calls authenticated gateway endpoints
`/story/treatments/author` and `/story/treatments/review`, in that order. Both
perform model inference on the existing GPU backend. The author response has no
review approval marker; the worker only returns an accepted result after the
independent review endpoint passes. Trigger shows model preparation, authoring,
review, and the failed stage, while Studio metadata changes to `reviewing` during
review. Logs contain model/run identifiers and fixed diagnostics, not full prompts
or credentials. Deploy the gateway endpoints before the worker. The original
combined `/story/treatments` endpoint remains available for older workers.

Verification: exercise the app's Story action and inspect the resulting Trigger
trace, including a review rejection; confirm both GPU stages appear and that a
failed review produces no accepted proposal. A direct backend diagnostic alone
does not verify this production path.

Authenticated dispatches have exactly one `user:<githubOwnerId>` tag. The
server-only `/api/orchestration/realtime-token` route issues a 15-minute public
read token scoped only to that tag. The Studio Work Activity surface subscribes
to the self-hosted base URL, omits payload and output bodies, refreshes before
expiry, and remounts the subscription after credential rotation. It groups
media children under their parent and shows queue wait, runtime, total duration,
exact item counts where available, provider state, and terminal errors.

Anonymous dispatch is rejected. Never create a shared `user:anonymous` fallback.
The management polling route also checks the current application user tag before
returning a run.

## BWS-backed production variables

`config/secrets.manifest.json` is the machine-readable mapping. Values remain
in BWS project `hermes_keys`; tracked files contain names only.

``powershell
bun run trigger:env:check
bun run trigger:env:sync -- -DryRun
bun run trigger:env:sync
``

The sync script imports only the `triggerProduction` mappings into the Project
Stack Structure `prod` environment and never prints values. The Next production
deployment uses `STACK_STRUCTURE_TRIGGER_PROD_SECRET_KEY`; local development
uses the separate development key.

Vercel production variables, or one explicitly named preview branch, can be
converged from the same pointers without printing values:

``powershell
bun run vercel:env:sync
bun run vercel:env:sync -- -Environment preview -GitBranch codex/example
``

Preview synchronization requires a branch name so production credentials are
never granted to every preview deployment.

## Deployment

Production task images must be built on the Linux worker host so the worker supervisor can pull them from its loopback registry. Do not deploy from Docker Desktop.

Use the private ops runbook for checkout paths, SSH entry points, and registry URLs. BWS remains the canonical secret source; a mode-`600` deploy env file on the worker is the runtime copy. Never print secret files.

1. Fetch the intended branch on the worker checkout and verify its commit.
2. Materialize BWS deployment pointers into `~/.config/project-stack-structure/trigger-deploy.env` (mode `600`) with `bun run trigger:deploy:env` from a trusted workstation.
3. Run `bun run trigger:deploy -- --dry-run`.
4. Run `bun run trigger:deploy`.
5. Confirm the emitted image was pushed to the worker's local registry.
6. Query the current production worker and compare all 17 task IDs with the table above before triggering acceptance runs.

The deploy script refuses non-Linux hosts, verifies SDK/build/React hooks share one pin, runs the Trigger CLI through `bunx`, uses `--local-build`, and pushes the built image to the production registry.

### Worker host access and failure triage

Use the first working SSH path documented in the private ops runbook (VPN, LAN, or hypervisor guest exec). They reach the same worker; they are not independent service replicas.

If guest exec returns I/O errors while the hypervisor looks healthy, treat the VM filesystem layer as unhealthy: capture diagnostics, snapshot, reboot or repair per runbook, then recheck Trigger, Essentia, and SSH before deploying.

Pindeck shares the Trigger control plane but not this checkout, project,
credentials, task inventory, queues, or deployment. A Stack Structure recovery
or deploy must not modify `/opt/pindeck`.

## Acceptance gate

Static checks are prerequisites, not completion. Record separately:

- focused and full tests, lint, typecheck, and production build;
- current worker version, deployment code, and exact 17-task inventory;
- one authenticated browser input and its application user/project ID;
- parent and child run IDs with queue/start/end timing;
- production worker host service responses for the exercised path;
- RustFS object IDs/URLs and successful byte reads;
- saved project JSON containing the resulting analysis/generated asset;
- Work Activity and visible Studio result after a hard refresh;
- one controlled terminal failure;
- one identical replay returning the same run/object without a duplicate.

Follow the private ops runbook for platform health and
registry recovery. Do not start the retired local Trigger or staging Compose
stacks.

The latest correlated acceptance record is
[`trigger-production-evidence-2026-07-14.md`](trigger-production-evidence-2026-07-14.md).
