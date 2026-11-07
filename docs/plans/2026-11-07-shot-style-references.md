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
