<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Stack Structure — agent notes

Smart auto music-video editor: upload a song + footage, get a musically aligned rough cut, optionally fill gaps with AI shots. Web-first (Next.js 16 + React 19 + Bun), heavy work dispatched through Trigger.dev to GPU workers.

## Commands

```bash
bun install
bun run dev        # http://localhost:3000
bun run check      # lint + typecheck + tests (run before every PR)
bun run build      # production build
bun run e2e:media  # full pipeline e2e — see "E2E harness" below
```

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
- Full history + rationale: `docs/security/api-hardening.md`.

## E2E harness

`scripts/run-full-media-e2e.ts` drives the real pipeline (upload → scene detect → captions → Essentia → Deepgram → match → preview → final export) against a running server. Requirements:

1. Server on `:3000` (`bun run build && bun run start`) with full env incl. `TRIGGER_*` and `AUTH_*`.
2. Fixtures in `.local-fixtures/media/`: `trigger-verification-speech.wav` (<45s speech), `trigger-verification-video.mp4`, `trigger-verification-ffglitch.avi`, `trigger-verification-shader.webm` (synthetic; regenerate with ffmpeg + `say`).
3. Session cookie: mint with `@auth/core/jwt` `encode()` using the server's `AUTH_SECRET`, salt `authjs.session-token`, then export `STACK_STRUCTURE_E2E_COOKIE="authjs.session-token=<jwe>"`. The harness sends it on every request; dispatch and polling identities must match for Trigger user-tag authorization.

## Deployment layers

- **Web app:** push to `main` → Vercel auto-deploys (`project-stack-structure.vercel.app`). Env sync from BWS via `scripts/sync-vercel-production-env.ps1` on the Windows master. `AUTH_*` must be present or sign-in fails closed (Auth.js `Configuration` error).
- **Workers:** Trigger.dev control plane at `trigger.v1su4.dev`, tasks run on VM100 — see `docs/operations/trigger-production.md`.
- **Gateways:** Essentia / FFmpeg / media / caption at `*.v1su4.dev` (self-hosted; reachable over Tailscale).

## Cursor Cloud

- Cursor automatically loads the repository-root `.cursor/environment.json`.
- Cloud startup is `scripts/cloud-agent-start.sh`; do not create `.env` files in the agent VM.
- The installer pins Node 24.18.1 LTS. Startup enforces Node 24.5+, launches Next.js explicitly with Node for environment-proxy-aware server `fetch()`, and isolates the app in a process group for reliable cleanup.
- Private desktop generation goes through SwarmUI at `SWARMUI_URL=http://100.73.126.36:7861` over Tailscale. Do not call ComfyUI port `7821` directly.
- `TS_AUTHKEY` belongs only in Cursor environment-scoped Runtime Secrets.
- Secret mode is explicit: either provide both `BWS_ACCESS_TOKEN` and `BWS_PROJECT_ID`, or provide app variables as Cursor environment-scoped secrets. Never give Cursor the broad Hermes Bitwarden token.
- `BWS_SERVER_URL` is optional and only for a real self-hosted Bitwarden deployment; omit it for Bitwarden Cloud.
- Never print, paste, or commit real credentials. Verify variable names as `SET`/`MISSING` only.
- Setup and recovery runbook: `cursor-cloud-setup/README.md`.
