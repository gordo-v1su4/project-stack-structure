# Trigger.dev production operations

Project Stack Structure uses its own Trigger.dev project at
`https://trigger.v1su4.dev`.

- Project ref: `proj_wlrcsfnmovzmdwzojzfe`
- Production dashboard: `https://trigger.v1su4.dev/orgs/v1su4-91d9/projects/project-stack-structure-C5T7/env/prod`
- Platform, CLI, SDK, build, and React hooks: `4.5.12`
- Production deployment host: VM100 Linux
- Authoritative application data: RustFS project JSON, analysis manifests, and generated objects

Pindeck is a separate Trigger project. Never reuse its task IDs, queues, keys,
environment, or deployment history here.

## Production task inventory

| Task | Queue | Durable result |
| --- | --- | --- |
| `stack-structure-service-health` | `service-health` (2) | health result |
| `media-video-pipeline` | default orchestration | child run correlation and final manifest |
| `media-video-scene-detect` | `scene-detection` (3) | scene manifest in RustFS |
| `qwen-scene-caption-batch` | `vm100-heavy` (1) | caption batch in RustFS |
| `media-video-finalize` | `media-finalization` (2) | final analysis manifest in RustFS |
| `essentia-analyze-stored-audio` | `vm100-heavy` (1) | analysis JSON in RustFS |
| `qwen-smart-scene-caption` | `vm100-heavy` (1) | caption JSON in RustFS |
| `qwen-story-treatment` | `vm100-heavy` (1) | story treatments JSON |
| `local-ai-generation` | `vm100-heavy` (1) | generated objects in RustFS |
| `ffmpeg-preview-or-concat` | `vm100-heavy` (1) | preview MP4 in RustFS |
| `ffmpeg-final-music-video-export` | `vm100-heavy` (1) | final MP4 in RustFS |
| `ffmpeg-shader-capture-export` | `vm100-heavy` (1) | muxed MP4 in RustFS |
| `ffglitch-transform` | `vm100-heavy` (1) | transformed MP4 in RustFS |
| `higgsfield-nano-banana-pro-grid` | `paid-generation` (1) | provider asset and RustFS panels |
| `deepgram-transcribe-stored-audio` | `external-provider` (2) | transcript JSON in RustFS |
| `image-split-grid` | `external-provider` (2) | split panels in RustFS |

All Qwen, Essentia, local generation, FFmpeg/NVENC, and FFglitch work shares
one `vm100-heavy` queue. Separate queues with the same limit do not provide a
global GPU lock. Paid Higgsfield work is independently serialized and uses one
attempt so automatic retries cannot duplicate spend.

The media parent awaits scene detection, then launches and awaits one Qwen
batch at a time, then awaits finalization. Every child receives the authenticated
user tag, parent run ID, item index, safe stage metadata, and a stable
idempotency key. Durable filenames are derived from source identity, so replay
does not create a second logical manifest.

## Realtime activity

Authenticated dispatches have exactly one `user:<githubOwnerId>` tag. The
server-only `/api/orchestration/realtime-token` route issues a 15-minute public
read token scoped only to that tag. The Studio Work Activity surface subscribes
to the self-hosted base URL, omits payload and output bodies, refreshes before
expiry, and remounts the subscription after credential rotation. It groups
media children under their parent and shows queue wait, runtime, total duration,
exact item counts where available, provider state, and terminal errors.

Anonymous runs use the isolated `user:anonymous` tag and are not exposed by an
authenticated user's realtime token. The management polling route also checks
the current application user tag before returning a run.

## BWS-backed production variables

`config/secrets.manifest.json` is the machine-readable mapping. Values remain
in BWS project `hermes_keys`; tracked files contain names only.

```powershell
bun run trigger:env:check
bun run trigger:env:sync -- -DryRun
bun run trigger:env:sync
```

The sync script imports only the `triggerProduction` mappings into the Project
Stack Structure `prod` environment and never prints values. The Next production
deployment uses `STACK_STRUCTURE_TRIGGER_PROD_SECRET_KEY`; local development
uses the separate development key.

Vercel production variables, or one explicitly named preview branch, can be
converged from the same pointers without printing values:

```powershell
bun run vercel:env:sync
bun run vercel:env:sync -- -Environment preview -GitBranch codex/example
```

Preview synchronization requires a branch name so production credentials are
never granted to every preview deployment.

## Deployment

Production task images must be built on VM100 Linux so the worker supervisor
can pull them from its loopback registry. Do not deploy from Docker Desktop.

The production checkout is `/home/gordo/project-stack-structure`. Deploy as
`gordo`; non-login shells can call Bun explicitly as `/home/gordo/.bun/bin/bun`.
The deploy environment is already materialized at
`/home/gordo/.config/project-stack-structure/trigger-deploy.env` with mode
`600`. BWS remains the canonical secret source; the VM file is the deployment
runtime copy, and `proxmox-home/secrets/credentials.private.md` is only the
gitignored bootstrap/recovery fallback. Never print either file.

1. Fetch the intended branch in `/home/gordo/project-stack-structure` and
   verify its commit.
2. Materialize the BWS deployment pointers into mode-`600`
   `~/.config/project-stack-structure/trigger-deploy.env` with
   `bun run trigger:deploy:env` from the trusted workstation.
3. Run `bun run trigger:deploy -- --dry-run`.
4. Run `bun run trigger:deploy`.
5. Confirm the emitted image was pushed to `localhost:5000`.
6. Query the current production worker and compare all 16 task IDs with the
   table above before triggering acceptance runs.

The deploy script refuses non-Linux hosts, verifies that SDK, build, and React
hooks use one exact version, derives the CLI version from that shared pin, uses
`--local-build`, identifies the deployed version/code, and pushes that exact
image to VM100's Trigger registry.

### VM100 access and failure triage

Use the first working path; they all reach the same VM and are not independent
service replicas:

1. `tailscale ssh root@app-vm` (`100.118.78.13`)
2. LAN SSH `gordo@192.168.8.222` (private credential fallback until the
   workstation key is installed)
3. `tailscale ssh root@pve-node0`, then `qm guest exec 100 -- ...`
4. Hostinger Dockhand environment `3` (`app-vm`) for container inventory

If SSH resets or times out while `qm guest exec 100 -- /bin/true` returns
`Input/output error`, stop retrying credentials. That combination means the
guest execution/filesystem layer is unhealthy even though Proxmox, Tailscale,
and stored credentials may all be correct. Follow
`proxmox-home/docs/app-vm-boot-recovery.md`: capture diagnostics, take a
protective snapshot, attempt a normal reboot, then use the documented forced
stop/start or offline filesystem repair only as required. Recheck Trigger,
Essentia, NocoDB, SSH, and `systemctl is-system-running` before deploying.

Pindeck shares the Trigger control plane but not this checkout, project,
credentials, task inventory, queues, or deployment. A Stack Structure recovery
or deploy must not modify `/opt/pindeck`.

## Acceptance gate

Static checks are prerequisites, not completion. Record separately:

- focused and full tests, lint, typecheck, and production build;
- current worker version, deployment code, and exact 16-task inventory;
- one authenticated browser input and its application user/project ID;
- parent and child run IDs with queue/start/end timing;
- VM100 service responses for the exercised path;
- RustFS object IDs/URLs and successful byte reads;
- saved project JSON containing the resulting analysis/generated asset;
- Work Activity and visible Studio result after a hard refresh;
- one controlled terminal failure;
- one identical replay returning the same run/object without a duplicate.

Follow `proxmox-home/docs/triggerdev-vm100-runbook.md` for platform health and
registry recovery. Do not start the retired local Trigger or staging Compose
stacks.

The latest correlated acceptance record is
[`trigger-production-evidence-2026-07-14.md`](trigger-production-evidence-2026-07-14.md).
