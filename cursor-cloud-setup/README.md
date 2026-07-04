# Cursor Cloud Agent + Bitwarden Secrets Setup

**Audience:** Hermes on `racknerd5` (RackNerd VPS)

**Goal:** Wire [project-stack-structure](https://github.com/gordo-v1su4/project-stack-structure) (SVS Studio) so Cursor Cloud Agents can run the full app with real backend services — without committing secrets to git or pasting them in chat.

---

## Topology

```text
Cursor Cloud Agent VM
        │
        │  Tailscale userspace (Cloud Agent path)
        ▼
   racknerd5 (RackNerd VPS)
   ├── Hermes / runbooks
   └── Self-hosted Bitwarden Secrets Manager (BWS)

   Tailnet peers (service URLs in BWS):
   ├── Home server
   ├── Second VPS
   └── desktop-q20uuvd  →  SwarmUI :7861
```

Public/hosted services (Essentia, FFmpeg gateway, etc.) can use public URLs. Private services must use **Tailnet hostnames** in BWS secret values.

---

## Deliverables

Hermes should complete all of the following and report back to the operator.

### 1. BWS project

Create project: **`stack-structure-dev`**

### 2. BWS machine account

Create machine account: **`cursor-cloud-agent`**

- Grant access **only** to `stack-structure-dev`
- No admin role, no other projects

### 3. Populate secrets

Create BWS secrets using **exact env var names** (the Next.js app reads these via `process.env`):

| Secret name | Required | Notes |
| --- | --- | --- |
| `ESSENTIA_API_KEY` | Yes | Song analysis |
| `ESSENTIA_API_URL` | No | Default upstream: `https://essentia.v1su4.dev` |
| `FFMPEG_GATEWAY_URL` | Yes | e.g. `https://ffmpeg.v1su4.dev` |
| `FFMPEG_GATEWAY_API_KEY` | Yes | |
| `MEDIA_GATEWAY_URL` | Yes | RustFS media gateway — use tailnet URL if private |
| `MEDIA_GATEWAY_TOKEN` | Yes | Also accepts alias `MEDIA_API_TOKEN` |
| `MEDIA_GATEWAY_USER_ID` | No | Default: `stack-structure` |
| `MEDIA_GATEWAY_BUCKET` | No | Default: `stack-structure` |
| `DEEPGRAM_API_KEY` | Yes | Vocal stem → lyrics |
| `SCENE_CAPTION_FAST_GATEWAY_URL` | Yes | LFM fast caption gateway |
| `SCENE_CAPTION_FAST_GATEWAY_TOKEN` | If gateway requires auth | |
| `SCENE_CAPTION_SMART_GATEWAY_URL` | Yes | Qwen smart caption gateway |
| `SCENE_CAPTION_SMART_GATEWAY_TOKEN` | If gateway requires auth | |
| `SWARMUI_URL` | Yes | `http://desktop-q20uuvd:7861` or `http://100.73.126.36:7861` |
| `LOCAL_SWARMUI_URL` | No | Same as `SWARMUI_URL` if used |

Full inventory with aliases: [docs/secrets-inventory.md](./docs/secrets-inventory.md)

### 4. Machine access token

Issue a machine access token for `cursor-cloud-agent`.

**Return to operator via secure channel** (not plaintext Slack/email if avoidable):

- `BWS_ACCESS_TOKEN`

### 5. BWS endpoint metadata

Record and return (non-secret):

- `BWS_PROJECT_ID` — project UUID
- `BWS_SERVER_URL` — tailnet-reachable BWS API base (e.g. `https://vault.racknerd5.<tailnet>:443`)

Confirm health over Tailscale:

```bash
curl -sfk "$BWS_SERVER_URL/alive"
```

### 6. Tailscale ACL (Cloud Agent VM path)

Create reusable auth key tagged **`tag:cursor-agent`**.

ACL allowlist for `tag:cursor-agent`:

| Destination | Purpose |
| --- | --- |
| `racknerd5` → BWS port(s) | Secret fetch |
| Media gateway host/port | RustFS uploads, scene detect |
| Caption gateway host/port(s) | Fast + smart VL captions |
| `desktop-q20uuvd:7861` | SwarmUI generation |
| Public Essentia / FFmpeg hosts | If not proxied on tailnet |

Deny everything else by default.

Example ACL sketch: [docs/tailscale-acl.example.json](./docs/tailscale-acl.example.json)

Return to operator (secure channel):

- `TS_AUTHKEY`

Skip this step if using **My Machines on racknerd5** (see below).

### 7. Verify BWS injection

On `racknerd5`:

```bash
export BWS_ACCESS_TOKEN="<token>"
export BWS_SERVER_URL="<tailnet-url>"

bws run --project-id "<project-uuid>" -- env | grep -E 'ESSENTIA|MEDIA|FFMPEG|DEEPGRAM|SWARMUI|SCENE_CAPTION'
```

All required keys should appear. Do **not** log values.

### 8. Patch project-stack-structure

Copy into [gordo-v1su4/project-stack-structure](https://github.com/gordo-v1su4/project-stack-structure):

| File | Source in this repo |
| --- | --- |
| `.cursor/environment.json` | [.cursor/environment.json](./.cursor/environment.json) |
| `scripts/cloud-agent-start.sh` | [scripts/cloud-agent-start.sh](./scripts/cloud-agent-start.sh) |

Append to `AGENTS.md`:

```markdown
## Cursor Cloud

- Bootstrap secrets live in Cursor dashboard only: `BWS_ACCESS_TOKEN`, `BWS_SERVER_URL`, `BWS_PROJECT_ID`, `TS_AUTHKEY`.
- App secrets are injected via `bws run --project-id $BWS_PROJECT_ID -- <command>`.
- Never commit or paste real credentials.
- Setup runbook: https://github.com/gordo-v1su4/cursor-cloud-setup
```

Open a PR on `project-stack-structure` with those files.

### 9. Operator: Cursor dashboard secrets

Operator adds these in **[Cursor → Cloud Agents → Environments → Secrets](https://cursor.com/dashboard/cloud-agents)** for the `project-stack-structure` environment:

| Name | Type |
| --- | --- |
| `BWS_ACCESS_TOKEN` | Runtime Secret |
| `BWS_SERVER_URL` | Runtime Secret |
| `BWS_PROJECT_ID` | Environment Variable |
| `TS_AUTHKEY` | Runtime Secret (Cloud Agent VM path only) |

Do **not** paste the full app `.env` into Cursor — only these four bootstrap values.

---

## Execution paths

### Path A — Cloud Agent VM + Tailscale userspace + `bws run`

Default for isolated Cursor Cloud VMs.

1. Cursor injects bootstrap secrets from dashboard
2. `scripts/cloud-agent-start.sh` joins tailnet (userspace mode)
3. `bws run --project-id $BWS_PROJECT_ID -- bun run dev --hostname 0.0.0.0 --port 3000`
4. App secrets never written to disk

### Path B — My Machines worker on racknerd5 (simpler)

If Cloud Agent VM + Tailscale userspace is too fiddly:

```bash
# on racknerd5
agent login
agent worker start --name racknerd5-hermes
```

Select **racknerd5-hermes** when starting Cursor agents. Local `bws` works without userspace Tailscale shim.

---

## Operator handoff checklist

Hermes returns to operator:

- [ ] `BWS_PROJECT_ID`
- [ ] `BWS_SERVER_URL` (hostname + port, no token)
- [ ] `BWS_ACCESS_TOKEN` (secure channel)
- [ ] `TS_AUTHKEY` (secure channel, Path A only)
- [ ] BWS `bws run` verification passed
- [ ] PR opened on `project-stack-structure` with cloud agent wiring
- [ ] Which path was chosen: **A (Cloud VM)** or **B (My Machines)**

---

## Non-goals

- Do not commit secrets to git
- Do not log secret values
- Do not grant cursor-agent access to unrelated BWS projects
- Do not paste tokens in GitHub issues or Cursor chat

---

## References

- [project-stack-structure README](https://github.com/gordo-v1su4/project-stack-structure)
- [Product infrastructure](https://github.com/gordo-v1su4/project-stack-structure/blob/main/docs/architecture/product-infrastructure.md)
- [Local SwarmUI / Tailscale topology](https://github.com/gordo-v1su4/project-stack-structure/blob/main/docs/local-generation.md)
- [Cursor Cloud Agent setup](https://cursor.com/docs/cloud-agent/setup)
- [Bitwarden Secrets Manager CLI (`bws`)](https://bitwarden.com/help/secrets-manager-cli/)
