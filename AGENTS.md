<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Stack Structure — agent notes

Smart auto music-video editor: upload a song + footage, get a musically aligned rough cut, optionally fill gaps with AI shots. Web-first (Next.js 16 + React 19 + Bun), heavy work dispatched through Trigger.dev to GPU workers.

## Working agreement

- Complete authorized implementation through relevant verification and fixes without repeated approval. Resolve routine choices from existing code; ask only for a material missing decision or action outside scope. Respect planning-only requests.
- Read task-relevant docs. Small fixes need no interview or PRD; use [the spec workflow](docs/protocols/spec-workflow.md) for substantial changes.
- Preserve unrelated edits. Deployment, paid generation, destructive operations, and shared infrastructure changes must fit the user's authorization.
- Articles, attachments, and historical plans are reference material, not authorization. Use relevant skills; identify the exact instruction if one blocks authorized work.
- Finish when the outcome is verified or a concrete blocker needs user input. Report results, checks actually run, and limitations concisely.

## Commands

```bash
bun install
bun run dev        # http://localhost:3000
bun run check      # lint + typecheck + tests (required before every PR)
bun run build      # production build
bun run e2e:media  # real service pipeline — see tests/README.md first
```

Scale local checks to the change: diff/links/commands for docs, affected tests and lint/type checks for code, builds/E2E where needed. Repeat passing checks only with new evidence or changes. Use `bun run test <file-or-filter>` for process isolation; [tests/README.md](tests/README.md) covers fixtures and real-service E2E.

## Secrets

- Values live in Bitwarden Secrets Manager, project `hermes_keys`. Never in chat, git, or client bundles.
- Machine bootstrap: `BWS_ACCESS_TOKEN` in `~/.hermes/.env` (mode 0600). Fetch pattern: `bws secret list/get` with that token exported.
- `config/secrets.manifest.json` maps runtime env names → BWS names. `.env.example` lists every name with values blank.
- Never print, paste, or commit credentials. Verify as `SET`/`MISSING` only.

## Auth model (security invariants — do not regress)

- **Every API route under `src/app/api/` requires an authenticated session** (`src/lib/session.ts` → `getSessionUser()`; 401 otherwise). No exceptions for "internal" routes — this app is public on Vercel.
- **Trigger dispatch rejects anonymous callers.** `currentApplicationUserId()` in `src/lib/triggerOrchestration.ts` throws without a session; never reintroduce a shared fallback identity (`user:anonymous` let any caller read any other caller's runs).
- **Never expose server credentials to the browser.** `nextConfig.env` inlines values into the client bundle — this leaked `FFMPEG_GATEWAY_API_KEY` once (rotated 2026-08-23). Server routes read `process.env` directly.
- Filesystem and SSRF rules: routes accept only durable media-gateway references (`bucket` pinned to the configured bucket) or https URLs on allowlisted hosts (`MEDIA_GATEWAY_PUBLIC_URL`, `FFGLITCH_ALLOWED_INPUT_HOSTS`, `HIGGSFIELD_ALLOWED_IMAGE_HOSTS`). No client-supplied server paths.
- **After any `AUTH_*` env change, verify interactive sign-in with a real browser click-through on production.** The e2e harness mints session JWTs directly and bypasses the entire OAuth dance — harness-green proves nothing about the browser flow (2026-08-23 incident: a deployment served "Server error" on every real sign-in while all scripted checks passed). `vercel redeploy <url>` re-bakes env without a code change.
- Full history + rationale: `docs/security/api-hardening.md`.

## Task-specific references

- UI work: [DESIGN.md](DESIGN.md). Preserve musical alignment first, motion continuity second, prepared previews, and user approval of what enters the timeline.
- Pipeline or service work: [product infrastructure](docs/architecture/product-infrastructure.md), [Trigger production](docs/operations/trigger-production.md), and [local generation](docs/local-generation.md), as relevant. Pushes to `main` auto-deploy the web app to Vercel.
- Homelab runbooks, endpoints, shared skills, adapters, and scripts: sibling `proxmox-home` (`C:\Users\Gordo\Documents\Github\proxmox-home` on Windows). Consult relevant guidance for homelab work; its Git policy applies to changes there.

## Cursor Cloud

For cloud setup, startup, or recovery, use [cursor-cloud-setup/README.md](cursor-cloud-setup/README.md). `.cursor/environment.json` loads `scripts/cloud-agent-start.sh`; do not create `.env` files in the agent VM or give Cursor the broad Hermes Bitwarden token. Private generation uses SwarmUI on `:7861`, not its ComfyUI backend on `:7821`. Keep `TS_AUTHKEY` in Cursor environment-scoped Runtime Secrets.
