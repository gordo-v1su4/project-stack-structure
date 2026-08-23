# API Security Hardening

Applied before public release. Every change was verified by the full quality gate
(lint, typecheck, 303 tests, production build) and a green full-media e2e run
against the hardened server, including anonymous-access negative tests.

## Threat model

The studio proxies paid and GPU-backed services (Deepgram, Higgsfield,
SwarmUI/ComfyUI, Qwen captioning, Essentia, FFmpeg gateway). Before hardening,
every one of those entrypoints accepted anonymous traffic on the public domain.

## Changes

### Authentication required on all API routes

`src/lib/session.ts` adds `getSessionUser()` / `unauthorizedResponse()`.
Session-gated (401 without a GitHub session):

- `/api/media/video/jobs` (POST), `[jobId]` (GET), `[jobId]/result` (GET)
- `/api/deepgram/transcribe`
- `/api/caption/scene` (POST; health GET stays public)
- `/api/splitter/image`, `/api/splitter/image/panel`
- `/api/generate/local` (GET+POST), `/api/generate/local/view`, `/api/generate/higgsfield`
- `/api/storage/upload`
- `/api/preview/section`, `/api/preview/gateway`, `/api/preview/asset`
- `/api/export/final`, `/api/export/shader-capture`
- `/api/ffglitch` (GET+POST)
- `/api/studio/draft` (GET+POST+PUT)

Already gated previously: `/api/essentia/full`, `/api/studio/projects*`,
`/api/orchestration/*`.

### Anonymous dispatch removed

`currentApplicationUserId()` in `src/lib/triggerOrchestration.ts` no longer falls
back to the shared `anonymous` identity; it throws. Anonymous jobs shared one
Trigger `user:` tag, letting any caller read any other caller's runs. Dispatch
and polling now always happen under an authenticated user id.

### Arbitrary file read eliminated

`/api/preview/section` read client-supplied `inputPath` values from the server
filesystem. It now accepts only gateway storage references
(`{ bucket, objectKey }`) with `bucket` pinned to the configured media gateway
bucket. `/api/ffglitch` local-path reads were removed for the same reason;
inputs must be durable https URLs on allowlisted media hosts.

### SSRF contained

- `/api/generate/local/view` resolves asset references strictly against the
  configured SwarmUI origin; absolute URLs from clients are rejected.
- `/api/ffglitch` remote inputs: host allowlist derived from `MEDIA_GATEWAY_URL`
  + optional `MEDIA_GATEWAY_PUBLIC_URL` + `FFGLITCH_ALLOWED_INPUT_HOSTS`.
- `/api/generate/higgsfield` input images: same scheme with
  `HIGGSFIELD_ALLOWED_IMAGE_HOSTS`; responses expose capability booleans only.
- `/api/splitter/image/panel` validates `splitId`/`assetPath` segments against
  traversal patterns and returns generic upstream errors.
- `/api/media/video/jobs` pins `bucket` to the configured gateway bucket.

### Secrets removed from the browser bundle

`next.config.ts` no longer declares `env.FFMPEG_GATEWAY_URL`,
`env.FFMPEG_GATEWAY_API_KEY`, or the `NEXT_PUBLIC_ESSENTIA_*` values — that map
inlines values into every client bundle. Server routes read `process.env`
directly. The exposed `FFMPEG_GATEWAY_API_KEY` value was rotated in Bitwarden
Secrets Manager (`FFMPEG_GATEWAY_API_KEY`, `FFMPEG_API_KEYS`,
`PROXMOX_HOME_HOSTINGER_FFMPEG_GATEWAY_PRIVATE_FFMPEG_API_KEYS`) so the leaked
value is dead.

### Resource limits

- `/api/storage/upload`: 2 GiB per file (+ content-length precheck)
- `/api/deepgram/transcribe`: 500 MiB, filename clamped to 255 chars
- `/api/caption/scene`: 25 MiB image cap
- `/api/splitter/image`: 50 MiB image cap

### Security headers

`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
(camera/microphone/geolocation disabled), and HSTS are applied to all routes via
`next.config.ts` `headers()`. A strict CSP is intentionally deferred: Next.js
inline/bootstrap scripts require nonce infrastructure that should land with its
own review.

### Per-user draft storage

`/api/studio/draft` previously stored one global `default.json` that any caller
could overwrite. Drafts are now keyed per authenticated user id in storage
(`media-uploads/studio-drafts/<user>.json`). The dev-only local tmp cache still
applies outside production.

## Deployment notes

- Vercel environment needs the full variable set synced from BWS:
  `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET`, `AUTH_URL`,
  `AUTH_TRUST_HOST=true`, plus the existing Trigger/media/caption/Essentia/
  FFmpeg/Deepgram variables. Without them, sign-in and dispatch fail closed.
- After rotating `FFMPEG_GATEWAY_API_KEY`, restart consumers so they pick up the
  new value: ffmpeg-gateway service (Hostinger VM) and the Trigger worker env
  (VM100). Both read their key at boot; BWS is the source of truth.

## Known follow-ups (non-blocking)

- Per-user ownership tags on uploaded objects (currently bucket-level checks).
- Rate limiting/quota on paid endpoints (auth gates the who, not the how much).
- Strict CSP with nonces.
