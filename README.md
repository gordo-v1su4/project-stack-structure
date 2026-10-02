# Project Stack Structure

Web studio for music videos: upload a song and your clips, get a beat-aligned rough cut, optionally fill gaps with AI shots, then preview and export.

**Live app:** https://project-stack-structure.vercel.app (GitHub sign-in) · **Status:** [docs/roadmap.md](docs/roadmap.md)

## Stack

- **UI:** Next.js 16, React 19, Bun (deployed on Vercel)
- **Jobs:** [Trigger.dev](https://trigger.dev) orchestration to GPU workers
- **Audio:** Essentia API (beats, sections, waveform)
- **Video:** media gateway (storage, scene detect), FFmpeg gateway (previews, export)
- **Captions:** LFM-2.5-VL (fast) and Qwen3-VL (smart scene captions)
- **Cloud generation:** Higgsfield (Nano Banana Pro stills, Seedance with audio reference)
- **Local generation:** SwarmUI and ComfyUI (MiniMax H3 image-to-video for gap fill)

## What it does

1. **Analyze** the master track (beats, sections, waveform).
2. **Ingest** clips (scene detection and vision captions).
3. **Match** uploaded moments to story sections and lyrics, with motion continuity.
4. **Generate** filler shots only where coverage is missing (optional).
5. **Join** approved clips into section previews and export.

Upload-first: real footage drives the edit. AI generation is a gap-fill lane, not a replacement.

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
- Background/model implementation: [Trigger execution contract](docs/protocols/trigger-execution-contract.md) — required request, progress, result, retry, and production verification rules
- Captions and prompts: [visible writing and output rules](docs/protocols/higgsfield-nano-banana-reference-continuity.md#visible-writing-and-output-rules) — describe what is visible; keep internal checks out of prose
- Media pipeline: [docs/architecture/media-pipeline.md](docs/architecture/media-pipeline.md)
- Roadmap: [docs/roadmap.md](docs/roadmap.md)
- Agent guidance: [AGENTS.md](AGENTS.md)

## Design rules

- **Musical alignment first** — beats and sections drive cuts.
- **Motion continuity** as the default visual mode.
- **Prepared previews** — explicit recompute states, no laggy pseudo-live playback.
- **Human approval** — Match and Join gate what enters the timeline.

Music-video story and matching behavior: [editing contract](docs/protocols/music-video-editing.md). Read this before changing semantic gates, cut ranking, or reuse behavior.
