# Shot and style refs

Implementation slice: [V1S-445](https://linear.app/v1su4/issue/V1S-445/use-durable-shot-and-style-refs-in-selected-generation-shots).

## Outcome and scope

Users keep original visual examples alongside the character, crowd and environment sheets, then choose the few examples relevant to a new shot. A shot example guides framing, blocking and screen direction. A style example guides light, lens response, color and atmosphere. Neither controls identity, wardrobe or architecture. Named character sheets remain identity and wardrobe authorities; environment sheets remain location authorities.

The accepted request is synthesized here without reopening settled film decisions. Routine defaults: project-wide library availability, explicit per-shot inclusion, optional section/shot availability restrictions, at most three aesthetic examples and nine total H3 references. Availability never auto-injects an image. Existing timeline media and generation history remain unchanged.

## Data and behavior

- A separate optional `aestheticReferences` project field stores `assets` and per-timeline-item `shots` selections. It is not part of `referenceAssets`, caption identity context, source-context signatures, generation-scope reference manifests or current-identity migration galleries.
- Each asset retains original SHA-256, original filename, durable bucket/object/URL, display name, purpose, descriptive guidance and availability scope. Multi-image drag/drop uploads original File bytes through the existing authenticated direct RustFS upload path. No canvas, cropping, resizing or recompression occurs. Byte-identical names/copies deduplicate by SHA-256.
- Setup includes the exact label **Shot and style refs**, click-enlarge inspection, editable purpose/guidance/scope, status/error and removal. Existing characters/crowd/environment are untouched.
- Create one shot shows applicable examples and saves explicit selections. New reference-mode H3 jobs carry only selected examples alongside the required named identity/environment inputs. Batch creation and deliberate revisions read the saved per-shot selection. Retries retain their existing request; server rematerialization still checks availability and ownership.
- Server materialization resolves selected IDs from the owned saved project's separate library, validates scope and durable owner/bucket, and maps them to composition/style only. Original hash, purpose, guidance and scope enter new job identity. The existing conditional download additionally checks original byte hash. Raw original storage remains separate from normal model conditioning.
- Signed/public issued-policy normalization preserves the validated optional aesthetic binding; its original hash must equal the raw downloaded hash and purpose must match its non-identity role. User guidance cannot introduce native H3 reference tags or wrapper sections at materialization or compilation. Invalid scope identifiers fail closed rather than becoming project-wide.
- Prompt compilation limits aesthetic retention to the declared visual aspect, even when examples contain faces. Historical jobs without the optional aesthetic snapshot metadata retain their old identity and compilation behavior.
- First-frame video does not consume these references. Its accepted native PNG artifact/similarity screen remains required; the server rejects attempts to attach aesthetic inputs to that profile. Aesthetic uploads are not first-frame registration or acceptance.
- Reload hydrates durable previews and selections, strips runtime blobs, deduplicates and bounds metadata, and exposes interrupted uploads as failed. Older projects hydrate with an empty library. A project containing only aesthetic refs is not considered empty.

Scope is availability, not a second scheduling framework: a section/shot association simply determines which saved entries can be selected for a request. Unavailable saved selections fail explicitly instead of silently dropping inputs or widening their scope.

## Acceptance and verification

Behavior tests cover exact-byte hashing/deduplication, save/reload, durable previews, unchanged source signatures/reference authority, explicit scoped selection, missing inputs, total reference bounds, owner/bucket rejection, metadata-bound job identity, prompt/workflow input order, first-frame rejection and original-hash enforcement after conditional download. Existing persistence, reference library, H3 planning/generation/conditioning, current-identity and conditional-store regressions run separately where their mocks require process isolation. UI interaction is checked in a local fixture without production uploads or GPU work.

Production project mutation, uploading Robert's opening PNGs, generation, deployment and final creative acceptance are outside this branch's execution. The film controller owns live ingestion and release. The nine opening attachments remain unedited; root's original-file inventory reports eight unique images and one exact duplicate.

## Integration and lifecycle

Web and Trigger worker changes must be released together before new aesthetic-bearing jobs are dispatched: server materialization, worker prompt compilation and original-byte verification all understand the new snapshot metadata. This branch does not deploy or enqueue. Do not reinterpret an in-flight historical request or rewrite old proof/history.

After isolated review and integration, the controller can upload the eight unique original opening images through the new library, assign opening-section availability, select only the relevant examples for a new shot, save/read back the project, inspect the new frozen job packet and then perform separately authorized generation. Keep current character/environment/crowd descriptors and migration evidence byte-identical. Browser save/reload, exact durable hashes and a real new-job input/output review remain integration evidence; unit checks alone do not claim those live boundaries passed.

## Branch verification evidence

The isolated local browser fixture exercised the actual library and MiniMax panel with mocked local storage endpoints: three selected original PNGs (including one byte-identical duplicate) produced two assets with exact matching hashes. Rename, visual guidance, Style purpose, Opening-section availability and two explicit shot selections survived reload. Click-enlarge and click-image-close worked; the reference count showed four of nine including the two canonical authorities. This proves component interaction and serialization, not RustFS acceptance, production authentication or generated media.

The default production build cannot traverse this worktree's shared dependency junction under Turbopack. The webpack fallback compiled successfully, then Next's route type validation rejected the existing `handleStoryTreatmentsPost` export in the unchanged Story treatments API route. That same export exists at this branch's base commit. It is an integration/build limitation, not a passed production build; this feature does not repair an unrelated route. Standalone TypeScript and the repository check remain separate evidence.

### November 8 source integration

The historical build limitation above is superseded for `codex/reference-integration`,
which uses self-contained dependencies and the repaired route exports from main.
The combined playback ownership, leaf subscriptions, timeline zoom, live review,
shot/style library and timeline-block labels pass `bun run check` and the default
`bun run build`. Proof logs are retained locally under `.tmp/integration-proof/`.

Integration preserves the live-review queue when a revised take includes explicitly
selected aesthetic references. A regression follows the revision through saved-batch
reload and server job materialization, then verifies its one-take pause and unchanged
pending packets. The MiniMax panel mounts once, keeps stale-Story read-only access,
and disables shot/style selection while creative actions are blocked.

An actual ReactDOM/HappyDOM StrictMode fixture checks the combined panel: one
opt-in viewer, notes reload and project isolation, source/ownership cleanup and
stale creative/style controls. It performs five mocked GETs, zero mutations,
zero action callbacks and zero playback calls. This remains source-fixture evidence;
no production upload, worker release, generation or final-film acceptance is claimed.

### Current release source integration (held)

`codex/current-workflow-integration` starts at corrected release `14cc957` and
reapplies only the six held feature commits, in order:

| Held commit | Integrated commit | Scope |
| --- | --- | --- |
| `74db040` | `e483b1b` | Timeline section and cut focus |
| `a92a4ac` | `3f546a2` | Live draft take review |
| `ac15336` | `088e940` | Explicit shot/style references |
| `6b0aae0` | `c0aa6cc` | Reference policy validation |
| `4071880` | `110bc30` | Timeline block and gap labels |
| `344c6d0` | `f582a64` | Integrated reference regression coverage |

The existing production leaf subscription change (`3907fbd`, equivalent to held
`ce10213`) is retained from the release base, without another cherry-pick. The
only merge conflict among these six commits was the waveform
ruler: the release's three cached canvas layers and memoized beat grid/ruler stay
in place, with the fixed viewport and zoom-aware ruler dependencies added. The
source-confirmation route, storage diagnostic implementation and waveform cache
helper are unchanged from the release. Exact-gap imports retain their saved
project ID and plan-drift checks. At this baseline checkpoint, separate
current-snapshot export work was not yet included; see the follow-up below.

`bun run check` passes: 1,536 tests, zero failures, TypeScript clean, and ESLint
zero errors with five existing warnings. Self-contained dependencies were
installed from the frozen lockfile. At this baseline checkpoint, the default
build was waiting for the shared build window; the final combined build result
is recorded below.

Local actual ReactDOM fixtures use synthetic samples and stubbed canvas operations.
Across 120 clock updates, both the full-song spine and a fixed 64–96 second
viewport retain zero static canvas redraws while producing 120 distinct played
masks and playhead positions. Changing the fixed range to 128–160 seconds rebuilds
geometry once; subsequent clock updates remain cached. Seeking its midpoint
returns master-song position `144 / 256`, rather than viewport-relative `0.5`.
Existing data, size, DPR, tempo and scrolling-zoom invalidation assertions pass.
These are operation-count assertions, not browser latency measurements. Local
fixtures and logs are under `.tmp/integration-proof/`.

This candidate is source-ready and held for a coordinated **web and Trigger
worker** release. The worker import closure changes through
`h3GenerationServer.ts`, `h3Workflow.ts`, `h3JobStore.ts`,
`issuedIdentityPolicy.ts`, `projectPersistence.ts` and the new
`aestheticReferences.ts`: job materialization binds explicitly selected reference
scope and guidance, compilation constrains visual transfer, policy records retain
the restrictions, and conditional downloads verify the original byte hash.
Historical job identities stay unchanged when no aesthetic reference is selected.
The web source must not be released independently of a worker containing these
changes. No production upload, provider call, job dispatch, media generation,
browser acceptance, deploy or final-film acceptance was performed for this
integration.

The baseline evidence was committed separately as `276fe3e`. The verified export
freshness change `8adf74f` is subsequently included as `16e0c9e`. Its one
`StudioApp.tsx` conflict retains both the current aesthetic library dependency and
the incoming exact-snapshot completed-export filter, in-flight snapshot epoch
guard and filtered pipeline readiness. No worker schema or worker implementation
changes come from this follow-up. After the controller's live performance
measurement ended, the combined source at `16e0c9e` passed a new full
`bun run check`: 1,542 tests, zero failures, clean TypeScript and zero ESLint
errors with the same five existing warnings. Its one default `bun run build`
also passed using Turbopack and self-contained dependencies, generating all 37
pages. Proof logs are `.tmp/integration-proof/check-with-export.log` and
`.tmp/integration-proof/build-with-export.log`. The earlier interrupted check
is superseded by this complete run. This remains a held source candidate;
these results do not claim a coordinated release or live acceptance.
