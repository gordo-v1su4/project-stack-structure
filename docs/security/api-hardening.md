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
  (production worker host). Both read their key at boot; BWS is the source of truth.

### Final export media ownership and H3 evidence

Final export and shader-capture clip audio validate every durable object and chunk
against the authenticated account's existing upload-key layouts. The configured
bucket and `media-uploads/` prefix alone do not establish ownership. Multipart
export uploads use the same owner-scoped paths. Legacy unscoped inputs must be
re-uploaded through the authenticated upload flow.

Named-project FFmpeg exports send `projectId`, `planSignature`, `placementRevision`
and `draftRevision`. The server reads that owner's fresh project, requires the
accepted snapshot with no pending draft selection, rebuilds its cut, and checks
the exact master, source intervals and song intervals. An H3 durable key always
requires this context, including when browser metadata relabels it as ordinary
footage; H3 outputs cannot be hidden inside source chunk manifests.

For approved H3 takes the server reads the canonical ready job and uses its media,
target, reference hashes and verifier evidence. Saved client proof is not an
attestation. Owner approval supplies consent and the selected trim; it cannot
replace worker evidence. A pinned eligible provisional similarity filter can be
used after approval without changing its unverifiable identity status. Dispatch
binds a digest of the accepted snapshot and canonical reports. Before FFmpeg reads
an H3 video, the worker verifies the downloaded bytes against its canonical SHA256.

WebGPU capture remains owner-uploaded captured pixels with
`browser-webgpu-capture` provenance; this path does not attest to pixel identity.

## Canonical metadata privacy (V1S-450, local implementation; release pending)

The 2026-11-09 read-only audit observed anonymous direct-S3 HEAD 200 for an
operator-owned canonical project JSON. The existing stack bucket policy allowed
public GetObject over every key; the Media API also redirected metadata GET/HEAD
to unsigned S3. This bypassed the application's ownership checks. Existing
bucket/object ACL observations were owner-only; ACL authorization alone is not
the enforcement boundary in pinned RustFS 1.0.1.

The exact bounded prefix contract is [studio-metadata-privacy.json](../../config/studio-metadata-privacy.json).
It is byte-identical to the Media API source fixture (SHA256
`0e4a2240717d48448f1a45589cec20c0f4158f2993c60580bb56c923d5950b86`).
It protects default/timestamp legacy drafts, project indexes and project JSON,
H3 video/still jobs and intents, shot plans, identity policies/assessments,
current identity records, generation scope receipts/baselines/enrollment markers,
conditioning JSON, still preparation JSON and native frame source receipts. Conditioning PNGs, references,
audio, video, still results and analysis manifests remain public under this scope.
This change does not claim confidentiality for all stored JSON or media.

The paired ops artifact `infra/rustfs/stack-structure-metadata-policy.json`
retains the current public allow and adds GetObject deny for those resources
only in `stack-structure`, conditioned on the storage server's derived
`aws:PrincipalType=Anonymous`. Signed S3 reads used by canonical stores and
workers remain authenticated. Project-index, legacy-draft, ownership-discovery
and analysis-manifest Media API readers already send the existing server bearer.
No credential, env name, bucket or object migration is added.

Media API GET/HEAD for protected metadata requires that bearer and streams a
signed SDK GET, capped at 64 MiB, without a public redirect. HEAD closes the SDK
body unread (signed S3 HEAD is incompatible with this pinned deployment).
Uploads of matched metadata use private ACL and private/no-store caching.
First-touch bucket setup reapplies the deny rather than restoring blanket access.
Other buckets and public media retain anonymous redirects, CORS and byte ranges.

The app's download-url route returns an owned-session `/api/storage/media` URL
for matched metadata. Its proxy sends only the configured server bearer
upstream, retains ranges and returns safe headers. Foreign metadata cannot gain
ownership through a copied media reference. Dot segments, backslashes and
control characters are rejected. Metadata redirects fail closed with 502,
including when the app is ahead of an old gateway.

Release order and rollback are recorded in the canonical ops
`hostinger-ops/docs/rustfs-vm-runbook.md` under V1S-450: stage and verify the
authenticated Media API first, release the app proxy next, then apply/verify
the exact policy after fresh backup/guards. Gateway first-touch can apply the
deny as soon as it receives a write, so coordinate this interval. Live mutation
requires separate approval. Historical gateway JSON uploads used a one-year
public immutable cache header. The proposal therefore includes persistent
metadata-only Cloudflare cache bypass plus four Stack namespace root purges
(S3/gateway × projects/studio-drafts), covering old deleted/renamed paths and
query variants. This temporarily makes public media under projects a cold
cache. Existing DNS token presence/verify does not prove purge or rule-edit
permission: rules/normalization reads returned 403, and a harmless canary purge
is the first capability test only after approval. Rule ordering, normalized
aliases, and unchanged original URLs must pass actual edge verification; cached
or previously downloaded browser copies cannot be revoked by origin policy.
The release uses an overlay on the exact running Media API image, preserving
base/dependencies, and pauses metadata writes for the coordinated cutover.
Full rollback to the old blanket policy deliberately
reopens the observed exposure; prefer retaining the deny and fixing transport.

Acceptance: an owned canonical GET/HEAD through anonymous S3 fails with 403;
anonymous Media API returns 401; signed SDK and bearer gateway reads succeed
without Location; an owned app session reads metadata, anonymous/foreign
sessions fail; public reference/audio/video/conditioning PNG range reads still
work; a fresh Media API first write preserves the deny. Use only operator-owned
objects and an approved disposable fixture for write verification.

## Known follow-ups (non-blocking)

- Complete ownership coverage across remaining legacy media routes.
- Rate limiting/quota on paid endpoints (auth gates the who, not the how much).
- Strict CSP with nonces.
