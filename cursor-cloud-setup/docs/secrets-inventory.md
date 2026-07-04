# Secrets inventory — project-stack-structure

All secret **names** must match what the Next.js app reads from `process.env`. Values are operator-specific.

## Bootstrap (Cursor dashboard only)

These are **not** stored in the BWS app project. Operator pastes them into Cursor Cloud Agent Secrets.

| Name | Type in Cursor |
| --- | --- |
| `BWS_ACCESS_TOKEN` | Runtime Secret |
| `BWS_SERVER_URL` | Runtime Secret |
| `BWS_PROJECT_ID` | Environment Variable |
| `TS_AUTHKEY` | Runtime Secret (Cloud Agent VM path) |

## App secrets (BWS project `stack-structure-dev`)

### Audio analysis

| Name | Aliases | Source in repo |
| --- | --- | --- |
| `ESSENTIA_API_KEY` | `VITE_ESSENTIA_API_KEY` | `src/app/api/essentia/full/route.ts` |
| `ESSENTIA_API_URL` | `ESSENTIA_API_BASE_URL`, `VITE_ESSENTIA_API_*` | same |

Default URL if unset: `https://essentia.v1su4.dev`

### Preview / export

| Name | Source |
| --- | --- |
| `FFMPEG_GATEWAY_URL` | `src/app/api/preview/section/route.ts`, `ffglitch/route.ts` |
| `FFMPEG_GATEWAY_API_KEY` | same |

### Media storage + scene detect

| Name | Aliases | Source |
| --- | --- | --- |
| `MEDIA_GATEWAY_URL` | `RUSTFS_MEDIA_API_URL` | `src/lib/mediaGateway.ts` |
| `MEDIA_GATEWAY_TOKEN` | `MEDIA_API_TOKEN` | same |
| `MEDIA_GATEWAY_USER_ID` | `STACK_STRUCTURE_MEDIA_USER_ID` | same (default `stack-structure`) |
| `MEDIA_GATEWAY_BUCKET` | — | same (default `stack-structure`) |
| `MEDIA_GATEWAY_UPLOAD_PREFIX` | — | same (default `media-uploads`) |

### Lyrics

| Name | Aliases | Source |
| --- | --- | --- |
| `DEEPGRAM_API_KEY` | `DEEPGRAM_TOKEN` | `src/app/api/deepgram/transcribe/route.ts` |
| `DEEPGRAM_MODEL` | — | optional, default `nova-3` |
| `DEEPGRAM_LANGUAGE` | — | optional, default `en` |

### Vision captions (server GPU)

Fast mode:

| Name | Aliases |
| --- | --- |
| `SCENE_CAPTION_FAST_GATEWAY_URL` | `LFM_CAPTION_GATEWAY_URL`, `SCENE_CAPTION_GATEWAY_URL`, `VISION_CAPTION_GATEWAY_URL` |
| `SCENE_CAPTION_FAST_GATEWAY_TOKEN` | `LFM_CAPTION_GATEWAY_TOKEN`, `SCENE_CAPTION_GATEWAY_TOKEN`, `VISION_CAPTION_GATEWAY_TOKEN` |
| `SCENE_CAPTION_FAST_MODEL_ID` | `LFM_CAPTION_MODEL_ID`, `SCENE_CAPTION_MODEL_ID` |

Smart mode:

| Name | Aliases |
| --- | --- |
| `SCENE_CAPTION_SMART_GATEWAY_URL` | `QWEN_CAPTION_GATEWAY_URL` |
| `SCENE_CAPTION_SMART_GATEWAY_TOKEN` | `QWEN_CAPTION_GATEWAY_TOKEN` |
| `SCENE_CAPTION_SMART_MODEL_ID` | `QWEN_CAPTION_MODEL_ID` |

Source: `src/app/api/caption/scene/route.ts`

### Local generation (SwarmUI on Windows desktop)

| Name | Notes |
| --- | --- |
| `SWARMUI_URL` | Tailnet: `http://desktop-q20uuvd:7861` or `http://100.73.126.36:7861` |
| `LOCAL_SWARMUI_URL` | Alias used by generate routes |

Source: `src/app/api/generate/local/route.ts`, `docs/local-generation.md`

Do **not** point at Comfy raw port `:7821` — SwarmUI owns the API surface.

## Optional / dev-only

| Name | Purpose |
| --- | --- |
| `ESSENTIA_ENV_FILES` | Comma-separated paths to `.env` files (local dev fallback) |
| `STUDIO_DEV_SERVER_URL` | Fixture seed scripts, default `http://127.0.0.1:3000` |
| `TEST_MEDIA_DIR` | Integration tests |

## Verification command

```bash
bws run --project-id "$BWS_PROJECT_ID" -- env | sort | grep -E \
  '^(ESSENTIA|FFMPEG|MEDIA|DEEPGRAM|SCENE_CAPTION|SWARMUI|LOCAL_SWARMUI)='
```

Expected: all required names present; values must not be printed in logs or tickets.
