# Storyboard review and whole-shot replacement

> **Historical implementation plan:** the application/workflow decisions below
> remain useful, but its creative prompt and reference guidance is superseded by
> [Canonical Higgsfield / Nano Banana reference-continuity protocol](../protocols/higgsfield-nano-banana-reference-continuity.md).
> Do not copy prompt formulas or asset assumptions from this plan into a new run.

## User-approved direction

- Plan from the resolved edit, not primary-match shortage counts. The earlier 38 chunks were never 38 required paid jobs.
- A 2K Nano Banana 3×3 board may review rough composition only. Continuity-critical source frames are generated one at a time as standalone 2K images.
- Select individual panels, then generate **new standalone 2K images from scratch**. Never upscale, retouch, inpaint or sharpen the small panels in this workflow.
- Composition frames control camera, layout and blocking only. Attached canonical high-resolution character sheets always control identity and wardrobe; environment and crowd sheets retain separate roles.
- Video is Seedance only: 2.0 budget option or 2.5; default 480p, optional 720p. The user's spoken “80p” was interpreted as 480p and kept selectable.
- Replace a short shot in full. A five-second source needing ten seconds of coverage becomes a twelve-second new take with one-second handles, not two glued halves of the same movement. Longer sequences may contain deliberate shot changes.

## Implementation

`StoryboardPlanner` groups contiguous resolved cuts by section, at most nine cuts per suggested board. Scope is editable through per-sequence direction, selection and watching the existing sequence. None is automatically declared a gap.

Approval shows the exact section/time range, model, stage, references, composition preview, prompt and price guide. Users may review one job, select all, approve one at a time, or opt into auto-approval of **only the reviewed finite batch**. New stages and batches reset auto-approval. Visual acceptance is always separate from permission to generate.

Subscription/manual is the default billing route. It produces persistent handoff packets and makes no generation API calls. The provider UI must confirm inclusion in the user's subscription; the app cannot determine remaining entitlements. Returned manually generated images can be attached through their configured RustFS URL. Grids are split and persisted; fresh images are never split.

Metered Higgsfield uses `/api/generate/storyboard`: an authenticated, read-only provider-credit quote precedes a signed, user-bound, 15-minute approval of the exact job. Submission requires explicit approval and a fresh credit check; increased/unavailable costs fail closed. Trigger idempotency includes user, model and exact job; paid retries are disabled. Queued run IDs persist, and browser reload monitors existing runs without resubmitting them. The legacy unquoted `/api/generate/higgsfield` POST now rejects requests.

The current live Higgsfield catalog (checked 2026-08-30) identifies `nano_banana_pro` as Pro and `nano_banana_flash` as Nano Banana 2. The old `nano_banana_2` alias is no longer used by the new path. Read-only 2K credit probes returned 2 credits for each model; do not treat this as a permanent rate.

The dated [Google standard API pricing guide](https://ai.google.dev/gemini-api/docs/pricing) gives image-output-only benchmarks of $0.134 per Pro 2K image and $0.101 per Nano Banana 2 2K image. These exclude input/thinking/retries and provider markup. They are not Higgsfield dollar quotes or extra subscription charges. OpenRouter is not configured as a generation provider by this change.

Returned images undergo metadata-only size verification; no resizing occurs. API outputs are persisted before validation so a low-resolution paid result remains recoverable. Result review, parent-panel lineage, roles, original job specification and run IDs survive project serialization.

Seedance packets now default to opening-composition references and full replacement duration plus handles. Approved fresh frames for the selected range may join the reference pack. Missing canonical identity, excessive duration/reference count, unverified end-frame mode and exact start-frame/leading-handle conflicts block submission packets. `Video_1` is master-audio timing only; moving the cut or changing handles invalidates it. Generated media does not replace the master song or enter Join without audition approval.

## Verification and deployment boundary

- Development-only `/dev/storyboard` exercises the real Generate UI with explicitly synthetic returned-image fixtures. It returns 404 in production; fixture image routes do too.
- Browser-visible regression checks cover grouping, fresh-image prompts, duration math, identity precedence, model limits, persistence, review gates, signed approval expiry/user binding/tampering, and reference-host validation.
- Browser interactions cover cancel, approve-one progress, scoped auto-approval/reset, panel selection, fresh-frame visual approval, conditioning roles, Seedance models and handles. No paid generation is used by these checks.
- Typecheck, lint and production build are separate static checks. Unit regressions are provided for CI; functional verification in this session uses the in-app browser per user instruction.
- Deploy the Next.js app **and updated Trigger Higgsfield task together** before real paid generation. The worker now receives explicit model IDs and must honor absent split rows/columns for standalone images. Do not run the new client against an older worker.
- Still requires explicit user approval: real paid image/video pilots, final visual quality audit, audition/Join/Effects/Export, RustFS output persistence and visible audiovisual playback. This implementation is not a completed production E2E.
