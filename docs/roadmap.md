# Product Roadmap

## Purpose
This roadmap turns the current PRD into a phased delivery path for `project-stack-structure`, the active smart auto music-video editor repo.

Canonical planning source:

- `docs/product/creative-production-brief.md`
- `docs/plans/deep-interview-roadmap-spec-workflow-docs.md`
- `docs/plans/prd-roadmap-spec-workflow-docs.md`
- `docs/plans/test-spec-roadmap-spec-workflow-docs.md`
- `docs/plans/prd-implementation-buildout.md`

## Current Product Goal
Build a web-first smart auto music-video editor where the user supplies a song and video clips, the app analyzes musical structure, probes and segments video, ranks candidate segments by musical alignment first and motion continuity second, prepares section previews, and only plays ready preview assets.

The product is not a full NLE. It is a music-first auto-editing studio with explicit recompute/readiness states.

## Non-Negotiable Rules

1. **Musical alignment first** — beat/onset/section fit outranks visual heuristics.
2. **Motion continuity second** — motion continuity is the default visual continuity mode.
3. **Prepared preview over fake live mutation** — show stale/recomputing/ready states and swap assets only when ready.
4. **Segment-level analysis** — rank post-cut segments, not just whole clips.
5. **Accuracy over shallow quick scan** — typed descriptors beat loose tags.
6. **Web-first until evidence says otherwise** — Tauri/desktop is contingent on benchmark evidence.
7. **Reference repos are references** — donor repos inform specific capabilities, but `project-stack-structure` remains the active product repo.

## Confirmed Donor Map

These donors are confirmed for this plan:

- `review-room` — reviewer/media-review workflow, polished client-facing review feel, media cards, hover scrub, ratings, shortlist/selects, comments, approvals, and metadata-driven smart views.
- `freecut` — browser media/runtime/editor primitives, timeline concepts, preview handoff, media library, WebCodecs/WebGPU/export ideas, scene/optical-flow references.
- `MasterSelects` — successful preview/playback/render-target/RAM-preview patterns, WebGPU engine structure, source monitor, playback health/debug monitoring, and native-helper contingency patterns.
- `svelte-video-shaders` — WebCodecs frame buffer, audio-master-clock playback, section clip buckets, section waveform overlays, trigger system, energy speed remap, shader/effect catalogue, and the Deepgram/SRT/Kimi/auto-edit path from the M3 copy.
- `stutter-blaster` — rhythm/runtime reference: Essentia client/cache, audio master clock, quantization, musical moments, scheduler/A-V sync, WebCodecs/WebGPU ideas.
- `video-timeshaper` — audio-reactive preview/remap reference: envelopes, feature extraction, time engine, edit engine, trigger ordering, curve editor.
- `auto-video-scrambler` — backend FFmpeg behavior, beat split/join/shuffle/speed-ramp patterns, motion-vector extraction and motion-sequence sorting.
- `fftron-sync` — onset switch scheduling, rapid cut timing, time-shaper algorithms, music-first switching.
- `audio-ui-curves` — ramp/envelope controls and speed-ramp UX.
- `storyception` — story/treatment layer, story arc over music sections, motif planning.


## Current Brownfield Baseline

Current repo anchors:

- `src/components/StudioApp.tsx` — main studio UI/control shell.
- `src/components/studio/audioAnalysis.ts` — hosted audio analysis and waveform normalization.
- `src/components/studio/mediaUpload.ts` — browser-side video metadata and thumbnail prep.
- `src/components/studio/previewGeneration.ts` — preview/concat generation integration.
- `src/components/studio/ffglitchApi.ts` — FFglitch integration.
- `src/app/api/essentia/full/route.ts` — hosted audio-analysis proxy.
- `src/app/api/ffglitch/route.ts` — FFglitch proxy/capability route.

Current verification scripts:

- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run check`
- `bun run build`
- `bun run probe:media`
- `bun run preview:section`
- `bun run bench:latency`
- `bun run bench:compare -- <local-json> <remote-json>`

## Phase 0 — Planning Source Cleanup

### Goal
Keep `docs/plans/` as the single canonical planning home so agents do not follow stale April planning or reference-repo assumptions; tool-local working trees are disposable cache and never authoritative.

### Deliverables
- Current source spec in `docs/plans/`.
- Current PRD in `docs/plans/prd-roadmap-spec-workflow-docs.md`.
- Current test spec in `docs/plans/test-spec-roadmap-spec-workflow-docs.md`.
- Current implementation buildout in `docs/plans/prd-implementation-buildout.md`.
- Current public roadmap in `docs/roadmap.md`.

### Exit criteria
- Active repo is clearly `project-stack-structure`.
- `svelte-video-shaders` is mentioned only as a reference repo, if at all.
- Docs no longer imply missing scripts that now exist.

## Phase 1 — Contract Audit

### Goal
Verify the current code contracts before new media-pipeline work accelerates.

### Work
- Audit audio analysis normalization from `/api/essentia/full` through UI state.
- Audit clip probe/thumbnail flow and clarify Clip Manifest fields.
- Audit existing Segment Manifest and preview scripts.
- Update `docs/architecture/media-pipeline.md` with any contract gaps.

### Exit criteria
- Audio Analysis fields are documented.
- Clip Manifest fields are documented.
- Segment Manifest assumptions are documented.
- Next implementation stories have exact file/module touchpoints.

### Verification
- `bun run check`
- `bun run probe:media`

## Phase 2 — Recompute State Machine

### Goal
Make section preview lifecycle explicit and race-safe.

### Work
- Define states: ready, stale, recomputing, cancelled, failed.
- Add versioning/job identity to prevent stale publish.
- Surface recompute/readiness state in the Studio UI.
- Ensure playback uses last ready asset until new asset is ready.

### Exit criteria
- Stale jobs cannot replace newer prepared assets.
- UI exposes recomputing/ready/failed states.
- Playback does not consume partial preview output.

### Verification
- `bun run check`
- targeted recompute state tests
- browser/manual UI verification for readiness states

## Phase 3 — Ranking and Fit Policy

### Goal
Prove music-first ranking and motion-continuity default behavior in tests and code.

### Work
- Define candidate shape with musical fit and Motion Descriptor fields.
- Add comparator tests proving musical alignment wins.
- Add default motion-continuity ranking mode after musical fit.
- Add Fit Policy decisions: trim, speed ramp, reject, overlap eligibility.

### Exit criteria
- Tests fail if motion continuity outranks musical alignment.
- Fit policy returns explicit decisions.
- Random/color modes cannot silently become the default over motion continuity.

### Verification
- `bun run test`
- `bun run check`

## Phase 4 — Prepared Section Preview

### Goal
Generate and consume ready section preview assets through the app pipeline.

### Work
- Inspect and harden `src/components/studio/previewGeneration.ts`.
- Ensure `scripts/preview-section.ts` produces/verifies prepared preview assets with fixture media.
- Ensure UI consumes only ready output.
- Add visible failure/readiness states where missing.

### Exit criteria
- Section preview path is deterministic for the same inputs/settings.
- Last-ready vs current-settings-stale is visible.
- Preview generation failure is recoverable.

### Verification
- `bun run preview:section`
- `bun run check`

## Phase 5 — Benchmark and Platform Decision

### Goal
Decide whether web-first remains viable using evidence.

### Work
- Run local latency benchmarks.
- Compare against prior/remote benchmark data where available.
- Update `docs/benchmarks/` with current findings.
- Keep Tauri/desktop as a contingency unless evidence crosses threshold.

### Exit criteria
- Latest benchmark evidence exists.
- Roadmap can justify staying web-first or opening a Tauri branch.

### Verification
- `bun run bench:latency`
- `bun run bench:compare -- <local-json> <remote-json>` when applicable

## Later Capabilities

- **Reference name extraction (vision):** on reference-sheet upload, read printed character/location names via Qwen3-VL instead of filename/manual entry.
- **Project database (maybe):** evaluate Convex (or similar) for project metadata, media catalog, and ingest/pipeline state — pattern from Pindac and review-room; not committed while RustFS + `project.json` remains the source of truth.
- Optional fine-cut / micro-shot backend pass after the current full-workflow review:
  keep PySceneDetect as the major scene detector, then split long/one-shot scenes
  into candidate `micro-shot` segments using frame-difference, FFmpeg scene score,
  optical-flow discontinuity, and minimum-duration guards. These should be
  candidate cut points for Match/Join density controls, not forced final edits.
- Whole-song rough cut after section preview is credible.
- Final export pipeline.
- Additional continuity modes.
- Richer controls and review UI.
- Desktop/Tauri package only if evidence justifies it.

## Success Definition
The roadmap is succeeding when:

- planning artifacts stay synchronized with implementation reality,
- musical alignment remains the top priority,
- motion continuity has a credible default path,
- section preview readiness is explicit and trustworthy,
- the web-vs-desktop decision stays evidence-driven,
- agents can pick up a slice and verify it without asking what repo or goal applies.
