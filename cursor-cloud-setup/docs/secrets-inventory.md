# Secrets inventory — project-stack-structure

These names match the variables read by the application. Values are operator-specific and must not be committed.

For direct Cursor mode, sensitive values are environment-scoped **Runtime Secrets**. For Bitwarden mode, the same names live in the dedicated BWS project.

## Bootstrap

| Name | Type in Cursor | Required |
| --- | --- | --- |
| `TS_AUTHKEY` | Runtime Secret | Private Tailnet access |
| `BWS_ACCESS_TOKEN` | Runtime Secret | BWS mode only |
| `BWS_PROJECT_ID` | Environment variable | BWS mode only |
| `BWS_SERVER_URL` | Environment variable | Self-hosted BWS only; omit for Bitwarden Cloud |

## Audio analysis

| Name | Aliases | Source |
| --- | --- | --- |
| `ESSENTIA_API_KEY` | `VITE_ESSENTIA_API_KEY` | `src/app/api/essentia/full/route.ts` |
| `ESSENTIA_API_URL` | `ESSENTIA_API_BASE_URL`, `VITE_ESSENTIA_API_*` | same |

Default URL if unset: `https://essentia.v1su4.dev`.

## Preview and export

| Name | Source |
| --- | --- |
| `FFMPEG_GATEWAY_URL` | `src/app/api/preview/section/route.ts`, `src/app/api/preview/gateway/route.ts`, `src/app/api/ffglitch/route.ts` |
| `FFMPEG_GATEWAY_API_KEY` | same |

## Media storage and scene detection

| Name | Aliases | Source |
| --- | --- | --- |
| `MEDIA_GATEWAY_URL` | `RUSTFS_MEDIA_API_URL` | `src/lib/mediaGateway.ts` |
| `MEDIA_GATEWAY_TOKEN` | `MEDIA_API_TOKEN` | same |
| `MEDIA_GATEWAY_USER_ID` | `STACK_STRUCTURE_MEDIA_USER_ID` | same; default `stack-structure` |
| `MEDIA_GATEWAY_BUCKET` | — | same; default `stack-structure` |
| `MEDIA_GATEWAY_UPLOAD_PREFIX` | — | same; default `media-uploads` |

## Lyrics

| Name | Aliases | Source |
| --- | --- | --- |
| `DEEPGRAM_API_KEY` | `DEEPGRAM_TOKEN` | `src/app/api/deepgram/transcribe/route.ts` |
| `DEEPGRAM_MODEL` | — | optional; default `nova-3` |
| `DEEPGRAM_LANGUAGE` | — | optional; default `en` |

## Vision captions

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

Source: `src/app/api/caption/scene/route.ts`.

## Local generation

| Name | Notes |
| --- | --- |
| `SWARMUI_URL` | Use `http://100.73.126.36:7861` for the Cursor VM; MagicDNS hostname is optional |
| `LOCAL_SWARMUI_URL` | Optional alias used by generation routes |

Sources: `src/app/api/generate/local/route.ts`, `src/app/api/generate/local/view/route.ts`, and `docs/local-generation.md`.

Do not point the app at ComfyUI port `7821`; SwarmUI owns the API and backend lifecycle.

## Safe verification

Never print `env` or `bws run ... env` in CI logs. Check names only:

```bash
python3 - <<'PY'
import os
required = [
    "ESSENTIA_API_KEY",
    "FFMPEG_GATEWAY_URL",
    "FFMPEG_GATEWAY_API_KEY",
    "MEDIA_GATEWAY_URL",
    "MEDIA_GATEWAY_TOKEN",
    "DEEPGRAM_API_KEY",
    "SCENE_CAPTION_FAST_GATEWAY_URL",
    "SCENE_CAPTION_SMART_GATEWAY_URL",
    "SWARMUI_URL",
]
for name in required:
    print(f"{name}={'SET' if os.environ.get(name) else 'MISSING'}")
PY
```
