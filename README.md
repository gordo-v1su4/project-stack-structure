# Project Stack Structure

Upload a song and your footage → get a **musically aligned rough cut**, then optionally fill gaps with AI-generated shots.

**Live app:** https://project-stack-structure.vercel.app · **Status:** [docs/roadmap.md](docs/roadmap.md)

## What it does

1. **Analyze** your master track — beats, sections, waveform (Essentia on server GPU).
2. **Ingest** your clips — scene detection + vision captions (LFM / Qwen3-VL).
3. **Match** real footage to song sections and lyrics with motion continuity.
4. **Generate** filler shots only where coverage is missing (optional).
5. **Join** approved clips into section previews and export.

Upload-first: most of the edit comes from footage you already shot. AI generation is a gap-fill lane, not a replacement.

## Quick start

Requirements: [Bun](https://bun.sh) ≥ 1.3, Node ≥ 24.5, ffmpeg/ffprobe on PATH.

```bash
bun install
cp .env.example .env        # fill in values — see Configuration
bun run dev                 # http://localhost:3000
```

Sign in with GitHub when prompted — every API route requires a session.

## Configuration

All settings come from environment variables. `.env.example` documents every name; real values live in **Bitwarden Secrets Manager** (project `hermes_keys`) and are pulled per machine — never commit `.env`.

Key groups: `AUTH_*` (GitHub OAuth + session signing), `TRIGGER_*` (background orchestration), `MEDIA_GATEWAY_*` (RustFS storage), `ESSENTIA_API_*`, `FFMPEG_GATEWAY_*`, `DEEPGRAM_API_KEY`, `SCENE_CAPTION_SMART_*`.

## Commands

```bash
bun run dev        # dev server
bun run build      # production build
bun run check      # lint + typecheck + tests
bun run test       # test suite
bun run e2e:media  # full pipeline e2e (needs running server + fixtures)
```

Tests use synthetic fixtures in `.local-fixtures/media/` (gitignored). The e2e run authenticates with `STACK_STRUCTURE_E2E_COOKIE` — see [tests/README.md](tests/README.md).

## How it fits together

| Layer | Runs on |
| --- | --- |
| Studio UI | Browser (Next.js on Vercel) |
| Song analysis | Essentia API — `essentia.v1su4.dev` |
| Clip storage / scene detect | Media gateway — `media.v1su4.dev` |
| Scene captions | Qwen gateway — `caption.v1su4.dev` |
| Preview / export | FFmpeg gateway — `ffmpeg.v1su4.dev` |
| Background jobs | Trigger.dev control plane on VM100 |

Every heavy step dispatches through [Trigger.dev](https://trigger.v1su4.dev) to GPU workers; the Next.js routes only authenticate, validate, and queue.

## Deployment

- **Web app:** push to `main` → auto-deploys to Vercel. Env vars sync from BWS (`scripts/sync-vercel-production-env.ps1` from the ops machine).
- **Workers:** Trigger.dev tasks on VM100 — see `docs/operations/trigger-production.md`.
- **Security posture + hardening history:** [docs/security/api-hardening.md](docs/security/api-hardening.md).

## Documentation

- Architecture: [docs/architecture/product-infrastructure.md](docs/architecture/product-infrastructure.md) (start here)
- Media pipeline: [docs/architecture/media-pipeline.md](docs/architecture/media-pipeline.md)
- Roadmap: [docs/roadmap.md](docs/roadmap.md)
- Agent guidance: [AGENTS.md](AGENTS.md)

## Design rules

- **Musical alignment first** — beats and sections drive cuts.
- **Motion continuity** as the default visual mode.
- **Prepared previews** — explicit recompute states, no laggy pseudo-live playback.
- **Human approval** — Match and Join gate what enters the timeline.
