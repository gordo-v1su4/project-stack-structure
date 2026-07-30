# Cursor Cloud Agent offload setup

This repository can run in a Cursor-hosted Ubuntu VM while offloading private generation work to the Windows desktop over Tailscale.

## Verified topology

```text
Cursor Cloud Agent VM
  ├─ checks out project-stack-structure
  ├─ installs Bun, Tailscale, and optional bws
  ├─ receives environment-scoped Runtime Secrets from Cursor
  └─ Tailscale userspace proxy
       └─ desktop-q20uuvd / 100.73.126.36
            ├─ SwarmUI  :7861  (the app-facing generation API)
            └─ ComfyUI  :7821  (Swarm-managed backend; do not call directly)
```

Public services such as Essentia, FFmpeg, media, and caption gateways use their normal HTTPS URLs. Only private Tailnet services need Tailscale.

SwarmUI is intentionally the only generation endpoint exposed to this app. The desktop startup and recovery procedure is documented in [`docs/local-generation.md`](../docs/local-generation.md).

## What this PR installs

Cursor auto-detects the repository-root files:

- [`.cursor/environment.json`](../.cursor/environment.json)
- [`.cursor/install-cloud-tools.sh`](../.cursor/install-cloud-tools.sh)
- [`scripts/cloud-agent-start.sh`](../scripts/cloud-agent-start.sh)
- the `Cursor Cloud` section in [`AGENTS.md`](../AGENTS.md)

The environment installs dependencies, starts Tailscale in userspace mode when `TS_AUTHKEY` is present, then starts Next.js on port 3000.

## Secret modes

The startup script supports two explicit modes.

### Mode 1 — Cursor environment-scoped secrets (usable now)

Add the app variables listed in [`docs/secrets-inventory.md`](docs/secrets-inventory.md) directly to the repository's Cursor Cloud environment. Sensitive values should be **Runtime Secrets**; non-sensitive URLs and IDs can be environment variables.

This is the safe fallback while a dedicated Bitwarden project is unavailable. It does not write a `.env` file.

### Mode 2 — scoped Bitwarden Secrets Manager project (preferred when available)

Set both:

- `BWS_ACCESS_TOKEN` — Runtime Secret
- `BWS_PROJECT_ID` — environment variable

The startup script validates access with `bws project get` and launches the app through `bws run`. `BWS_SERVER_URL` is optional:

- omit it for Bitwarden US Cloud (the current installation)
- set it only for a real self-hosted Bitwarden deployment

Never use the broad `hermes_keys` machine token in Cursor. A Cursor token should only see a dedicated project such as `stack-structure-dev`.

### Current Bitwarden limitation

The Bitwarden organization currently reports its three-project plan limit is reached, so Hermes could not create `stack-structure-dev`. Until an operator frees a project slot or upgrades the plan, use Mode 1. Creating/deleting Bitwarden projects and issuing a new machine-account token remains an operator-controlled Secrets Manager action.

## Cursor dashboard values

Open [Cursor → Cloud Agents → Environments](https://cursor.com/dashboard/cloud-agents#environments), select the environment for this repository, and add:

| Name | Type | Required |
| --- | --- | --- |
| `TS_AUTHKEY` | Runtime Secret | For private SwarmUI access |
| App variables from `docs/secrets-inventory.md` | Runtime Secret or environment variable | Mode 1 |
| `BWS_ACCESS_TOKEN` | Runtime Secret | Mode 2 only |
| `BWS_PROJECT_ID` | Environment variable | Mode 2 only |
| `BWS_SERVER_URL` | Environment variable | Self-hosted Bitwarden only |

Do not add a Tailscale API-management key. Use a reusable, tagged auth key restricted to `tag:cursor-agent`.

## Tailscale policy

1. Add `tag:cursor-agent` to the tailnet policy.
2. Permit that tag to reach `desktop-q20uuvd:7861` only.
3. Create a reusable auth key carrying `tag:cursor-agent`.
4. Save the auth key as Cursor Runtime Secret `TS_AUTHKEY`.

Start from [`docs/tailscale-acl.example.json`](docs/tailscale-acl.example.json), merging it into the existing tailnet policy rather than replacing the policy.

## Verification

### Repository checks

```bash
python3 -m json.tool .cursor/environment.json >/dev/null
bash -n .cursor/install-cloud-tools.sh
bash -n scripts/cloud-agent-start.sh
shellcheck .cursor/install-cloud-tools.sh scripts/cloud-agent-start.sh
bun run check
bun run build
```

The test runner skips fixture-dependent media tests when `.local-fixtures/media` is unavailable and reports those skips explicitly; mount real fixtures before running the full media E2E lane.

### Cursor Cloud setup run

Start a setup run from the Cursor dashboard and confirm:

1. `.cursor/install-cloud-tools.sh` completes.
2. Tailscale reports userspace networking ready.
3. The startup script selects the intended secret mode.
4. Next.js listens on port 3000.
5. `GET /api/generate/local` reaches SwarmUI at `http://100.73.126.36:7861`.

### Desktop prerequisite

SwarmUI must be running on the desktop. The standard persistent task is `SwarmUI Persistent`, configured for `0.0.0.0:7861`; Swarm starts ComfyUI on its assigned backend port, currently `7821`.

## Security rules

- Never commit `.env` files or real credentials.
- Never paste access tokens into GitHub comments or agent prompts.
- Do not give Cursor the existing broad Hermes Bitwarden token.
- Keep Tailscale access limited to the exact private services required.
- Public service URLs do not need Tailnet ACL entries.
- Cloud tool downloads are pinned to exact versions and verified against repository-pinned official SHA-256 digests before extraction or execution.
