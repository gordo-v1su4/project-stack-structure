# Finish a music video without manually producing missing footage

Status: **UNFINISHED**. At saved draft revision 25 / placement revision 8, twenty-two selected pending candidates reduce 75.838954649 seconds of base gaps to **29.885333333 seconds**. Web `1a312b6` and Trigger `20261106.18` (worker source `4aab1e1`) are production-verified. The real zero-footage project has a reviewed Story and three-window full-master plan: its first render passed 33/33 intended frames, but its second failed resemblance and reproduced the location reference board, so generation correctly paused. The finishing batch is terminal, with P16/P17/P22/E32 banked pending and proposed alternate handles for P14/P20 awaiting canonical range checks. Two user-authorized aspect-preserving paired-still resizes now pass the unchanged numerical input screen; video acceptance remains open. Explicit first-frame mode passes code checks/build and awaits its own web/worker deployment and real integrated render. Complete coverage, whole-film creative acceptance and final export remain open. See the [current film checkpoint](../docs/plans/2026-11-06-love-me-tonight-finish.md).
Updated: 2026-11-06.

### Numerical detection versus likeness decision

Robert delegates unresolved workflow choices to the first recommended option. The recommended choice is a new, explicitly selected policy family using **0.90 minimum YuNet detection confidence**, while retaining **0.800 SFace cosine**, every-intended-frame coverage, frontal geometry, track continuity, foreground dominance or joint assignment constraints, model hashes and whole-draft review. OpenCV documents 0.90 as its face detector's default box-score threshold: [FaceDetectorYN 4.12](https://docs.opencv.org/4.12.0/df/d20/classcv_1_1FaceDetectorYN.html). That is a face-detection operating point, **not** identity calibration or an accuracy guarantee.

Evidence motivating this distinction: P05 attempt 2 has one stable, frontal, adequately sized face in all 124 native frames. Every intended frame exceeds the fixed cosine cutoff (0.873443–0.906447), but 47/58 fail the earlier experimental 0.94 detection-confidence scope. Increasing retries does not resolve that product-policy mismatch. This decision is made after observing that result and must not be described as held-out calibration.

Implement this as new immutable family IDs/hashes for future requests, with explicit new intent lineage when the policy changes. Keep existing 0.94 families, historical job requests, stored proofs, failed statuses and terminal rejections unchanged. Do not silently reinterpret old results or reset their attempt counters. A new-family take must undergo actual CPU preflight, rendering and per-frame assessment before selection. Low cosine, geometry, track or assignment failures still exclude a take. Do not infer wrong identity from unassessable footage. Implementation and the first real v2 failure/pass path are production-verified; held-out identity calibration and complete-film acceptance remain open.

Decision authority: Robert explicitly delegates further workflow/product decisions while absent. Use Matt Pocock's Grill with Docs or Wayfinder, choose the first recommended answer, record it, and continue implementation. The skill defaults requiring a live user answer are superseded by that instruction for this goal; external commitments and destructive/paid operations still require applicable authorization.

## Outcome

Robert supplies a song, creative direction, and identity/location references. The app plans a musically aligned edit, uses suitable existing footage when supplied, generates all missing footage with local MiniMax H3 through SwarmUI, prepares a reviewable cut, supports targeted revisions, and produces a durable, playable final video. Zero uploaded footage is a required supported case.

Success removes manual external generation and download/reimport as a prerequisite for finishing. A successful job or build is not sufficient evidence of this outcome.

### Required final creative deliverable

Robert explicitly requires an actual fully cut music video as the final product of the long-horizon goal, in addition to finishing the app and intervening workflow. The result must be dynamic, storytelling-led, narrative-driven, high energy, and use fast cuts with musical intent. A functioning generator, technical export, slow rough cut, or short demo does not satisfy this creative outcome.

Use a safe copy of the saved Love Me Tonight project and preserve its approved Diego/Valentina story sequence and reference identities. Plan energetic pacing from the song's phrases, accents, and sections; vary shot size, action and viewpoint while maintaining legible story progression and continuity. Fast editing is not permission to manufacture coverage with repetitive loops or obscure generation defects with indiscriminate cuts. The current creative direction supersedes the earlier relaxed/balanced default for this acceptance film.

Deliver the full-song playable MP4, review the actual edit and generated shots, and retain durable source/project/job lineage so revisions remain possible.

Execution priority clarified by Robert: finish the existing film and its remaining scoped work first; start a new creative project afterward. Preserve its approved story, analyzed song, captions, references, and useful placements. Use the existing public app and connected production Trigger project for integration, with local code checks and verified incremental releases to that same setup. Do not make a parallel local auth/worker environment a prerequisite for finishing.

## Trigger and decisions

The user starts or resumes a project. Generation is attached to a specific current shot requirement and song placement. Existing approved footage is preserved unless replacement is requested.

Confirmed first-round decisions:

| Decision | Agreed behavior | Status |
| --- | --- | --- |
| Required inputs | Song + brief + named references; uploaded footage optional, including zero footage | Confirmed |
| Creative checkpoint | Agree on story, generate/assemble a draft, then review and revise | Confirmed |
| Primary video engine | Local MiniMax H3 through SwarmUI | Confirmed |

Confirmed second-round decisions: analyze the master song without requiring a separate stem or timed lyrics (both are optional enhancements); use four main steps, Setup → Story → Draft → Finish, with detailed editing tools available inside; and deliver narrative/performance footage cut to the master song, with accurate generated singing/lip-sync deferred. Automated draft assembly remains distinct from silently accepting unreviewed media for final export.

Engineering behavior implementing the agreed review point: candidates can be selected automatically into a clearly labeled draft. Robert reviews the assembled draft and may approve its current selection together or reject/revise particular shots. Final approval is tied to the reviewed plan and exact candidate/trim selection; a stale or changed selection cannot silently inherit approval.

### Draft review contract

- Keep existing `pending`, `approved`, and `rejected` asset review states. Automatic selection for draft playback does not change a pending candidate to approved.
- Persist a draft-selection snapshot alongside generated assets: current plan signature, selection revision, and chosen asset IDs. Preview preparation also hashes exact candidate IDs and trims.
- Draft playback uses only selected ready candidates that still match the current requirement, reference packet, and plan. Final export uses the approved selection.
- **Use this draft** approves precisely the selection and trims presented in the viewed snapshot after validating readiness, target bindings, and measured durations. The complete selection is saved together.
- **Reject shot** preserves review history, removes that draft selection, and exposes either the prior approved source or an explicit hole. Never silently substitute an unseen candidate.
- **Revise shot** creates another attempt for the same requirement/window. Keep the previous approved version usable until its replacement is reviewed.
- Late job completions cannot override a newer selection revision. Changed story, timing, or reference authority invalidates the affected snapshot; old results remain history.
- A short candidate cannot clear coverage beyond its usable interval.

These are implementation choices within assembled-draft review, not an additional per-shot approval gate.

### Identity acceptance, 2026-11-06

Robert rejected the first integrated Diego pilot because the face did not look sufficiently like the approved person. That judgment overrides the agent's initial overly generous visual assessment. Job success, matching wardrobe and environment, and a broadly similar face do not establish identity acceptance. The candidate must remain rejected and outside the draft/final cut.

Add a reference-bound face similarity screen before automatic draft selection. Compare usable faces across the clip against multiple views extracted from the approved identity sheet; require adequate face size, detection quality, and temporal coverage. Calibrate acceptance using actual approved reference views and rejected candidates rather than inventing a universal percentage. A low score, inconsistent identity, ambiguous face association, insufficient evidence, or unavailable verifier must not silently pass. Store verifier/model version, reference hashes, sampled-frame evidence and decision with the candidate. A similarity pass is a screening result, not a guarantee or permission to override an explicit user rejection. Continue visual identity, wardrobe, motion and continuity review before final acceptance.

Robert explicitly requires deterministic face models and numerical comparisons, not LLM resemblance judgments. Installed ArcFace models were tested on the rejected pilot: repeated fixed CPU inference produced exactly matching scores; the rejected pilot's buffalo centroid scores were 0.556–0.747, versus 0.799–0.911 for leave-one-view-out canonical comparisons. SFace/YuNet with pinned runtime/model hashes also reproduces its measurements. The required 0–2.5s trim's 60-frame SFace scores overlap imperfectly with some reference-gallery configurations and contain quality abstentions, so no passing production calibration is claimed. The current verifier emits measurements and `unverifiable`; it cannot silently pass an uncalibrated candidate. The rejected pilot remains a negative fixture. See `docs/protocols/generated-asset-identity.md` and `scripts/identity/README.md`.

### Reuse existing planning

The technical follow-up verified that `storyMusicPlacement.ts:104-135` can build timeline items without source moments; `musicVideoProject.ts:628-720` can prepare the plan and explicit gaps; and `storyTreatments.ts:322-328` supports generated/unfilled story requirements. Reuse these paths. Remove footage/caption requirements from generation-first readiness while retaining scene analysis and captions for footage actually supplied.

### Local H3 execution contract

- Derive the owner from the authenticated session. Each immutable job names project, approved story revision, plan signature, requirement, song interval, attempt intent, seed, prompt, and server-owned profile/template version.
- Carry actual ordered reference assets, not only text describing references. Each has an immutable version/content hash, role, canonical name, and owned durable bucket/object key.
- Validate ownership and bytes, then upload the required images through SwarmUI's `/ComfyBackendDirect/upload/image` proxy. Bind the returned paths to declared image/reference slots in a server-owned native H3 template; the browser does not supply arbitrary model paths or workflow JSON.
- Start with Ref2VA for new shots. Use exact first/last-frame conditioning only when those endpoint roles are intentionally supplied.
- Keep song placement distinct from generated source duration and handles. Validate actual dimensions/FPS/frame count and compile/lint the prompt against the resulting duration. Generated sound does not replace the master song.
- Deduplicate using owner/project, story/plan revision, requirement/window, ordered reference versions/roles/hashes, prompt, seed, profile/template version, and attempt intent. A deliberate new candidate has a new attempt; a refresh reattaches to the same job.
- Persist job intent before submission and the provider prompt ID immediately afterward. Use unique correlation metadata/output prefixes. An ambiguous submit timeout enters reconciliation; it must not automatically launch a duplicate inference.
- Track awaiting-backend, submitting, rendering, persisting, ready, failed, and cancellation states durably. Retry transport/storage independently from rendering. Continue unaffected shot work after one shot fails, and make unresolved windows visible.
- Cancellation must target the job where supported; never interrupt the whole shared GPU backend to cancel one project.

Technical defaults such as bounded retries are implementation choices, not another interview checkpoint. Re-establish the single-shot baseline before queuing a full song.

### Recovered validation fixture

Read-only investigation recovered the actual native Ref2VA API graph from PNG metadata in `D:/ComfyUI_V89/ComfyUI/output/h3/love-me-tonight-ref2va-base_00002.png`. The accepted source plate is `F:/__comfyui-workflows-master/Benji/references/love-me-tonight-bar-trio-1344x768.png`. Model files and those fixture files were present during the audit; the backend was not running.

The recovered graph uses `MiniMaxH3ReferenceToVideo`, the Ref2VA pruned int8 model, Qwen3-VL 32B NVFP4 encoder, standard H3 video/audio VAEs, `res_multistep`/`simple`, 20 steps, seed `1324674643131`, and 124 frames at 24 FPS. Preserve the original graph as provenance; extract only the base-output ancestors into a versioned app template and validate that template with a fresh render.

This composite-reference pilot is historical evidence. A separate identity + environment packet must also produce a visually accepted clip before claiming that the app preserves arbitrary supplied identities. Reuse native reference-slot and frame-count patterns from `music-video-vending-machine/scripts/mvvm_gen/graphs.py`; do not copy its raw backend transport or automatic ambiguous-submit resubmission.

## Proposed journey

1. **Setup:** provide song, creative brief, and named references; add existing footage when available. Never require uploaded clips, scenes, or captions when there is no existing footage. Surface missing inputs with actionable explanations.
2. **Plan:** propose the whole-song narrative and timed shot requirements. Mark footage evidence and genuinely missing coverage separately. Review story intent before expensive generation.
3. **Create and review:** generate missing shots, show progress and recoverable failures, assemble prepared musical previews, and revise rejected windows without rebuilding accepted ones.
4. **Finish:** review the entire song, apply optional effects, export, and download. Split, Match, and Join remain available as detailed tools inside the four-step primary journey.

## Existing contracts to preserve

- Musical timing takes priority over motion continuity; source/generated trims must respect intended accents and usable duration.
- References carry separate identity, wardrobe, environment, and composition roles. Do not confuse reference-to-video with guaranteed first-frame locking.
- Programmatic local video runs through SwarmUI and its managed ComfyUI backend, never a separate raw ComfyUI provider.
- Authenticated browser/API/Trigger ownership and durable media references remain mandatory. No browser credentials, caller-supplied server paths, or anonymous project identity.
- A candidate is bound to the current plan signature, shot requirement, narrative moment, target interval, reference versions, and generation configuration.
- Rejected, undersized, stale, or failed candidates cannot silently clear real coverage holes. Review history survives replacement.
- Jobs and outputs survive reload; idempotency includes actual reference inputs. Retries do not silently duplicate inference.
- Existing rough-cut playback with visible holes remains available; final export requires complete approved coverage.
- A temporary worker path or private fallback URL is not a successful durable final export.
- New H3 prompts follow the canonical H3 compiler and duration/FPS-aware preflight. Rendering must separately prove identity, action, and continuity.

## Verified audit findings

Historical pre-implementation baseline: fetched `origin/main` commit `646b66e`; separate completion branch preserves the original dirty checkout. The findings in this table explain the changes required at that time; they are not the current release status. Current evidence is recorded below and in [the film checkpoint](../docs/plans/2026-11-06-love-me-tonight-finish.md#verified-checkpoint-2026-11-06).

| Seam | Current evidence | Completion implication |
| --- | --- | --- |
| Input gates | `src/components/studio/ingestLanes.ts:27-102`; `studioPipeline.ts:55-100,141-147` require clips/scenes/captions and lyrics | Generation-first entry requires a deliberate contract change, not just relaxing one button |
| Local generation | `src/components/studio/panels/GenerateTab.tsx:280-335` sends no actual image/reference packet and keeps results in component state | Connect identity-conditioned video generation to persistent target-bound candidates |
| Visible default | `GenerateTab.tsx:499-532` exposes local still generation and external Seedance return/import | Replace the manual primary video path with an integrated MiniMax route |
| Existing integration to reuse | `StudioApp.tsx:512-548,674-685`; `projectPersistence.ts:215-221`; `GenerateTab.tsx:264-272,1147-1152,1709-1722` | Reuse persistent generated assets, plan binding, approval, and resolved-edit overlays |
| Export durability | `src/trigger/export.ts` catches upload failure and returns `local-fallback` | Fail explicitly or recover to real durable storage; prove final bytes |
| Current E2E | `scripts/run-full-media-e2e.ts:97-99,374-495` can omit generation/export and its H3 FL2VA pilot lacks named identity refs | Add acceptance evidence for actual reference-driven gap fill through production jobs |
| Browser proof | Live saved project: 21 unfilled windows; Generate still requires external creation/import | Use a copy of this project as a potential mixed-footage acceptance fixture, subject to interview |
| Backend | Local SwarmUI port 7861 refused audit GET; September pilot is historical | Re-establish current runtime and render proof before claiming local generation works |

The app has a useful saved rough cut and functioning concepts to extend; a complete NLE rewrite or database migration is not established as necessary.

## Completion checklist

- [x] Audit latest code and preserve original local work.
- [x] Inspect the deployed saved project in the browser.
- [x] Run parallel audits of editor flow, generation integration, and completion evidence.
- [x] Confirm optional footage, local H3 engine, and assembled-draft review.
- [x] Resolve lyrics/stem, primary workflow presentation, and lip-sync scope.
- [x] Record the required high-energy, fast-cut, narrative-driven full-song final film.
- [x] Finalize implementable workflow and align affected glossary/ADR contracts.
- [x] Simplify the route through setup, planning, creation/review, and finish.
- [x] Compile reference-bound MiniMax shot jobs and persist candidate outputs automatically. The first pilot remains user-rejected; the controlled v2 pickup and environment-only lamp are selected pending review.
- [x] Implement bounded batch progress, retries, stale-result rejection, and reload recovery. Unit checks and persisted browser request recovery are verified; actual render recovery remains a live acceptance gate below.
- [ ] Complete review-to-timeline coverage and durable preview/export behavior.
- [x] Pass affected tests, lint/types, required pre-PR checks, and production build for deployed `00cf96c`: 919 passed, 21 fixture-dependent skips, zero failures. Final media acceptance remains separate.
- [x] Prove mechanical execution of a new reference-conditioned shot through public app → production Trigger → SwarmUI → durable media, with actual v2 crop and unchanged raw authorities.
- [x] Exercise a separately pinned, project-scoped numerical draft filter on the controlled shot: 37/37 trim frames eligible in production; strict identity remains unverifiable. Exact assembled-draft approval is still required.
- [ ] Prove the entire intended song through browser, Trigger jobs, durable media, review, reload, final export, and downloaded playback.
- [ ] Deliver and review the actual fully cut, dynamic, high-energy, narrative-driven music video; retain a playable durable MP4 and editable project.
- [x] Deploy reviewed web/worker `00cf96c667a0bc22c78bed5d2f3f58f30b5b27c0`, Trigger `20261106.6`, and verify the public-app stored-pixel similarity recheck without another render.
- [x] Release export ownership correction and canonical H3-proof reconciliation. Final export remains an open live acceptance gate below.

## Observable acceptance

### Current live boundary and additional existing assets

The verified release is `00cf96c667a0bc22c78bed5d2f3f58f30b5b27c0`: [public app](https://project-stack-structure.vercel.app), web deployment `dpl_9obw97EwryhZ6xaWMrmPtzekErAg`, Trigger version `20261106.6` / deployment `wqp7oav4`, worker image digest `sha256:213ce47a1ed6664306e8bc00add11b57602f7627fe8368a680238e7a85c2eecd`. The four-step app, signed-in finishing project, numerical recheck and canonical export validation are live. A final film has not yet been exported.

The finishing revision `75101b25-fea6-42b1-b2c6-85a9d1deb8eb` retains **21 sources, 90 captioned scenes, the ten-beat story, the three canonical references, and all 13 original accepted placements exactly**. Plan `placements-v1-48c7dc9b`, revision **6**, has **126 placements: 98 source / 28 gap**, totaling **168.710s of proposed source coverage and 77.989954649s of base gaps**. Saved generated draft revision **5** selects the lamp and controlled Diego pickup pending review, leaving **73.751954649s** uncovered. New source choices still require final musical/continuity acceptance.

The controlled v2 job `h3-c8d7f22e6afd91d337bf85ddcfee8e5dfc2f825f9e9da6cdf41739046284a710`, run `run_cmw4osybx02qt3foe8yxqswms`, has durable **124-frame / 24fps / 5.166667s** output for song **24.020–25.530s**. Actual portrait conditioning SHA-256 is `23881baddb280676e22af6ee560b29c3876c889a8b8305b886a05d0575190c91`, with unchanged raw authorities. Public-app CPU recheck `run_cmw4q8zla02r23foebcns070w` completed in 11.7s on the same stored bytes: separately pinned draft filter **eligible, 37/37**, cosines **0.860543–0.899159**. The strict identity certificate remains **unverifiable** and the candidate remains pending creative review. Lamp job `h3-471a6b4bd18ef1661d1e05ed1e17499bdcd49700c4a80d09b92838e4c4397adb` covers **12.042–14.770s**, with no identity reference and proof `not_required`. The first pilot `h3-a56dc01e839f189abfa774d20ff123d81f4832cd152eaa580e80f1216cf782cc` remains user-rejected and excluded.

The authorized RustFS archive holds **121 original PNGs / 884,335,654 bytes**, with every object and the inventory manifest verified by full-download SHA-256 and length; local originals were unchanged. Ten additional original videos were uploaded, hash-verified and appended as IDs 11–20, adding 33 analyzed/captioned scenes. The archived images remain a library, not an automatic replacement of the canonical references.

The refined **local audition only** is `.tmp/full-song-audition-v2-refined/Love-Me-Tonight-full-song-audition-v2.mp4`: complete master audio, visible missing-footage slates, H.264/AAC, 864×486, 24fps, 5,921 frames, 53,944,026 bytes; full decode passed. It coalesces metadata seams into 63 continuous source runs and 17 contiguous gap runs. It is not a final export, gap-free film, musical approval or identity approval. Evidence and exact remaining gates are in [the verified film checkpoint](../docs/plans/2026-11-06-love-me-tonight-finish.md#verified-checkpoint-2026-11-06).

- Mixed footage: preserve approved existing footage, fill actual holes, and require no manual generation/reimport.
- Zero footage: reach the same complete outcome with no uploaded clips. A source-dependent caption or Match gate cannot prevent planning and generation.
- Inspect the actual generated clip for likeness, wardrobe, setting, action, movement direction, and usable duration; correlate browser action, job IDs, model/workflow, reference packet, and stored bytes.
- A controlled failure and retry recover without losing the project or duplicating logical assets. A reference change cannot reuse an old identity's idempotent result.
- Reload during a job and reopen after review; the latest remote project preserves refs, generated media, decisions, placements, trims, and playback.
- Full-song output is a durable downloadable MP4 with the correct master song, duration, ordering, musical alignment, intended generated shots, and no unintended gaps. Watch playback separately from probing metadata.
- Production sign-in, when affected, is verified through real OAuth browser interaction; a minted JWT is insufficient.

## Next grilling round

Both product-decision rounds are settled. Continue parallel implementation and verification against the checklist. Resolve routine engineering choices within this scope; ask only for a genuinely missing material creative decision or an action beyond authorization. Do not treat historical model pilots, test skips, a technically successful render, or an unreviewed export as creative acceptance.
