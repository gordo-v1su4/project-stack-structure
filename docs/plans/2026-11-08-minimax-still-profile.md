# MiniMax still profile: source checkpoint

Robert explicitly confirmed that stills, as well as video, should use local MiniMax H3 and the workflow practiced in Music Video Vending Machine. This checkpoint adds a pure frozen descriptor and workflow builder only. It does not change any existing route, start a service, install nodes/models, submit generation, or claim visual acceptance.

## Evidence and exact route

Source: sibling `music-video-vending-machine/docs/pilot/h3-refmods-keyframes-20261012/HANDOFF.md`, final user choice at lines 50–52, and `evidence/workflow-final-h3-output.json`. Original complete graph SHA-256: `53436673cf967996d0595ca7bc53bce42d51c59f9f782e711a1ea4ab09b12874`. The focused fixture `tests/fixtures/h3-still-accepted-graph.json` preserves only the relevant nodes' real input names, stored widget values, modes and connections; it excludes historical creative prompts and unrelated branches.

Output ancestry: UNET337 original Ref2VA → SigmaShift367 (12/3) → BasicGuider368, conditioned by ReferenceToVideo365 with raw image inputs, CLIP336 (int4) and VAE335 (int8). Fizgig latent366 supplies exactly one latent frame at 2560×1440; conditioning365 retains the historical `length:5` encoder field. This does not turn the still into a sampled five-frame video.

Sampler372 uses er_sde370 and simple50/denoise1 scheduler371. Output0 → SeparateAV390; video0 → learned latent upscaler391 with multiplier2/alignment32, CUDA/fp16, temporal chunking and force_unload true; original audio1 rejoins at Concat392. Refine395 uses the same noise369 and guider368, er_sde394, simple10/denoise0.20 scheduler393. Decode396 → ImageScale400 Lanczos2048×1152/crop disabled → Save401. No LoRA, GGUF, RefMod, external image provider or generic model fallback is introduced. Older MVM Eros/RefMod defaults are not this accepted route.

## Binding and preparation

The descriptor binds owner/project, current plan signature, exact timeline target/window, bounded prompt, seed, ordered named references, raw hashes, durable bucket/object/version/etag and a fixed profile hash. It requires each canonical reference name and its ordered Picture token; this syntactic rule does not prove semantic identity or prompt quality. Server adapter must derive owned canonical inputs and run the actual H3 prompt preflight before dispatch. A builder verifies frozen descriptor and hydrated reference hashes before constructing a deterministic workflow and its digest. It performs no network or filesystem calls.

Master2048×1152 is preserved separately from the existing video-conditioning requirement1344×768. Their aspect ratios differ. `h3StillNativePreparation` describes Lanczos resize1344×756 plus six black rows top/bottom, preserving the entire master composition. This is a contract, not implemented pixel processing; actual adapter must verify source/output PNG dimensions and hashes, record preparation implementation/version, and run identity assessment on final derivative pixels. No artifact is registered by this module.

## Required follow-through

- Verify installed managed Swarm node schemas, model availability and real reference wiring against this historical graph without disturbing the controller's existing generation.
- Add owned canonical API/job/store adapter with bounded dispatch, stale-result checks, durable provider IDs, recovery/cancellation and result storage. Preserve manual/frozen requests.
- Implement deterministic PNG preparation and register through current first-frame artifact contract; keep the master and derivative independently hashed.
- Wire automatic still→identity-screen→video in Draft with live clip review. Do not route the new still profile through generic image-model selection.
- Prove authenticated browser→Trigger→Swarm→RustFS→current-project recovery and inspect identity/composition/quality. Tests alone do not establish readiness or final-film completion.

Focused tests compare every emitted node input and all non-reference edges to historical evidence, including original audio preservation and first-sampler output0; test frozen bindings, tampering, Unicode byte bounds, unsafe paths, and preparation geometry. No live render was used.

## Adapter implementation checkpoint

The integration branch adds `/api/generate/h3/stills` with authenticated bounded JSON admission, read-only owned status, cancellation, and an explicit check of an unresolved submission after its previous Trigger worker is terminal. Still intent and attempt counters are separate from the frozen future video request. The dedicated `minimax-h3-still` task adds a nineteenth task to this source candidate; production currently has seventeen, and the held shot-planning task is the eighteenth. Web and worker inventory must be released together before calling this route active.

Canonical admission revalidates the saved story, placement window and owned raw references, freezes conditional-read ETags and actual hashes, then rechecks the saved project. The worker validates current context again before its first submission. Once a provider boundary exists, recovery uses the stored template and exact attempt correlation, without requiring the user to undo later project edits. Recovery never permits another provider POST. Explicit CAS ownership transfer requires the authenticated API to prove the previous owned Trigger run terminal and keeps a bounded append-only recovery history.

The managed provider adapter checks required node schemas and pinned model selectors before submitting once. Output names include both descriptor and still-job hashes. Timeouts, response loss, proxy errors and missing history remain unresolved; they do not authorize another generation. Cancellation before submission stops the job. After submission, cancellation observes only the owned attempt and excludes its result; it never interrupts unrelated GPU work.

Each worker execution also carries a unique immutable submission claim UUID. A run ID alone cannot distinguish two concurrent executions of the same Trigger run: with identical timestamps their CAS/lost-acknowledgment comparisons could otherwise mistake each other's writes for success. Deterministic regression coverage forces the same revision and timestamp, injects a lost acknowledgment, and requires exactly one provider POST.

Actual PNG preparation now runs in a bounded child process. It preserves the original 2048×1152 master bytes and makes the 1344×768 derivative using the geometry above, with encoded and decoded pixel hashes and Sharp/libvips version evidence. Immutable owned storage keeps both images and a generated-still provenance receipt, then registers the exact native artifact. This is not a native-video extraction receipt, an identity pass or a timeline selection. Existing first-frame video preflight must still screen the actual derivative before video GPU submission.

Current limitations remain explicit: aesthetic shot/style references are rejected before GPU dispatch because their still-to-video handoff needs a separate frozen continuation request. Generic image-model selection has not been promoted to this new default. Packaged worker execution, browser review/reload, actual managed generation, deterministic first-frame screening and visual acceptance remain live gates. Source tests and a web build cannot substitute for those gates or final-film export.

Draft's advanced one-shot controls now include MiniMax still preparation, separately authored opening-image prose, master/native review, explicit selection of a frame, and continuation using the unchanged frozen video request. Browser storage saves intent before the single POST; status and lost-ack recovery use GET only, including after reload. The old advanced Generate image tool still uses generic presets and remains separate unfinished migration work. This source UI has not yet been accepted in the live browser.

## Managed schema capacity review

The historical graph demonstrates three reference image slots. The film controller separately captured the managed SwarmUI schema read-only at `2026-11-09T04:20:46.781Z`, file `h3-still-managed-schema-20261109/nodes.json`, SHA-256 `2b974ad9dfe2ff393a401e2afae2b028562114b18eba7fd3f2df4427016397f6`. This agent verified that exact file hash before extracting `tests/fixtures/h3-still-managed-reference-schema.json`. The actual `MiniMaxH3ReferenceToVideo.input.optional.ref_images` spec is `COMFY_AUTOGROW_V3`; `spec[1].template` declares `prefix:ref_image_`, min0, max9, and an IMAGE input. The profile therefore retains its bounded nine-reference capacity. A regression emits and checks every link through `ref_images.ref_image_8`, with no dropped images, and rejects ten explicitly. The static capture establishes schema capacity at that observation, not a successful render, identity quality or perpetual runtime readiness. The adapter must revalidate current schema before dispatch.
