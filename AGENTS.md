<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
