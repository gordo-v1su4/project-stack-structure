# Retired local Trigger.dev fallback

This document is retained only as incident-recovery history. The VM100 repair
and remote cutover completed on 2026-07-13. The local containers were removed,
Docker Desktop was stopped, and the active control plane is
`https://trigger.v1su4.dev`. Do not start this stack during normal development
or testing. Re-create it only for an explicitly approved VM100 recovery event.

## Pinned local installation

- Official source: `https://github.com/triggerdotdev/trigger.dev`
- Release: `v4.5.2`
- Commit: `a3dca98d43347a0d1d5c3b8f48b93c3e4b24677e`
- Checkout: `C:\Users\Gordo\Documents\Github\trigger-dev-local`
- Dashboard/API: `http://127.0.0.1:8030`
- Local project ref: `proj_jgeclohuxwwdjwlctdnf`
- CLI profile: `stack-structure-local`
- Compose project: `stack-structure-trigger-local`

The official webapp and worker Compose files run Postgres, Redis, Electric,
ClickHouse, MinIO/S2, the registry, supervisor, and the Docker proxy. Volumes
are namespaced under the local Compose project so they cannot collide with the
existing media stack.

## Start, status, and stop

Run these from the repository root:

```powershell
.\scripts\start-local-trigger.ps1 -Action up
docker compose -p stack-structure-trigger-local -f C:\Users\Gordo\Documents\Github\trigger-dev-local\hosting\docker\webapp\docker-compose.yml -f C:\Users\Gordo\Documents\Github\trigger-dev-local\hosting\docker\worker\docker-compose.yml ps
.\scripts\start-local-trigger.ps1 -Action down
```

The launcher keeps the generated Docker secrets in the external Trigger
checkout only. It never writes them to this repository. The local development
key is supplied at process launch through
`STACK_STRUCTURE_LOCAL_TRIGGER_SECRET_KEY`; do not commit or print it.

## Start the application and worker

The staging loader reads provider credentials from BWS and overrides the local
Trigger URL/project without changing `.env.local`:

```powershell
$env:STACK_STRUCTURE_LOCAL_TRIGGER_SECRET_KEY = '<local development key>'
$env:STACK_STRUCTURE_LOCAL_CAPTION_API_TOKEN = ''

Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  '.\scripts\load-trigger-staging-env.ps1', '-LocalTrigger', '-Start', 'trigger'
)

Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  '.\scripts\load-trigger-staging-env.ps1', '-LocalTrigger', '-Start', 'next'
)
```

For the worker, the loader creates an external env file at
`C:\Users\Gordo\Documents\Github\trigger-dev-local\stack-structure-local-trigger.env`.
That explicit `--env-file` is important: it prevents the repository's normal
`.env.local` from silently sending tasks to the VM100/production caption URL.
The local worker uses Bun and the local project ref; production keeps its
existing Trigger project and credentials. Local mode also routes Essentia
through `https://essentia.v1su4.dev` because the BWS URL currently targets
VM100's unavailable private address; the API key remains BWS-backed.

## Local provider topology

```text
Next.js :3000
  -> local Trigger.dev :8030
     -> Bun task worker
        -> SwarmUI/ComfyUI :7861 on the Windows RTX 5090
        -> Qwen FastAPI gateway :18091
           -> llama.cpp server :18092
              -> official Qwen3-VL GGUF Q4_K_M + Q8_0 projector
        -> media worker :18090
        -> RustFS media gateway from BWS
```

The local caption gateway is intentionally unauthenticated on loopback. The
Trigger caption task suppresses inherited auth only for the explicit local
mode or loopback caption URL; non-loopback/production gateways still use their
configured bearer token. Ollama and FP16 are not part of this path.

Higgsfield uses the official `@higgsfield/cli` `1.1.13` in local mode because
web access tokens are short-lived. The expired BWS bearer is not injected into
the local worker. The loader points `HIGGSFIELD_CREDENTIALS_PATH` at the isolated
Gordo credential file under `C:\Users\Gordo\Documents\Github\trigger-dev-local`;
authenticate and select the billing workspace in that file before a paid-provider
rehearsal. This keeps Trigger/API authentication separate from browser-only
provider accounts. The eventual Linux deployment should use stable Higgsfield
Cloud credentials stored in BWS rather than persisting a short-lived bearer token.

## Verification

```powershell
$env:STACK_STRUCTURE_LOCAL_TRIGGER_SECRET_KEY = '<local development key>'
$env:STACK_STRUCTURE_LOCAL_CAPTION_API_TOKEN = ''

.\scripts\verify-trigger-staging.ps1 -LocalTrigger
.\scripts\verify-trigger-staging.ps1 -LocalTrigger -RunLocalGeneration -RunTimeoutSeconds 900
```

The successful rehearsal on 2026-07-11 proved both durable paths:

- `local-ai-generation`: Next -> local Trigger -> Bun -> SwarmUI/ComfyUI ->
  RustFS generated asset.
- `qwen-smart-scene-caption`: Next -> local Trigger -> Bun -> FastAPI ->
  llama.cpp Q4 GGUF -> RustFS caption JSON sidecar.

The caption result reported model
`Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M` and completed with a durable
`qwen-caption` JSON object. Run IDs are intentionally not treated as durable
configuration; use the run-status route or local dashboard for current runs.

## Migration back to Linux

Completed on 2026-07-13. VM100 passed public Trigger health, GitHub OAuth login,
remote Qwen readiness, and a production service-health run. The local worker
and Compose containers were removed after verification. Keep the queue limits,
idempotency keys, retry caps, model manifest, RustFS object contract, and
authenticated non-loopback callbacks unchanged.
