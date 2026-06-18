# PRD — Smart Auto Music Video Editor

## Metadata
- Updated: 2026-06-18 UTC
- Status: current draft for user review
- Active repo: `project-stack-structure`
- Source spec: `.omx/specs/deep-interview-roadmap-spec-workflow-docs.md`

## 0. Document Purpose
This PRD defines the current product requirements for `project-stack-structure`. It replaces stale April planning assumptions with the current goal: a web-first, music-first auto music-video editor with deterministic prepared section previews, music-first ranking, and agent-ready implementation slices.

This PRD is the source of truth for product intent. `docs/roadmap.md`, `docs/architecture/media-pipeline.md`, and `.omx/plans/prd-implementation-buildout.md` should stay aligned with it.

## 1. Vision
The product is a smart auto music-video editor. A creator supplies a song and video clips; the app analyzes musical structure, probes and segments video, ranks candidate joins, prepares section previews, and lets the user iterate while preserving musical alignment.

The core promise is not “live edit everything instantly.” The core promise is trustworthy music-synced preview: when a section is ready, playback is correct. If a setting change requires recompute, the UI should say so and swap in the result only when ready.

The app should remain web-first while the workflow is proven. A desktop/Tauri sidecar path is a contingency, not the default, and should be triggered only by benchmark evidence that browser scheduling/decode/media constraints prevent musically correct preview.

## 2. Target User

### 2.1 Jobs To Be Done
- As a creator, I want to upload a song and clips and get a musically aligned visual edit without manually cutting every beat.
- As a creator, I want the system to preserve motion flow where possible so cuts feel intentional rather than random.
- As a creator, I want explicit recompute/readiness states so I know whether I am watching the current prepared result.
- As a developer/agent, I want stable requirements and acceptance criteria so implementation does not reopen product direction.

### 2.2 Non-Users for MVP
- Professional editors needing a complete NLE timeline.
- Teams needing auth, billing, collaboration, approval workflows, or cloud storage.
- Users needing mobile-first editing.
- Users needing guaranteed desktop-native packaging before web viability is measured.

### 2.3 Key User Journeys

#### UJ-1: Creator prepares a section preview
The creator uploads audio and video clips. The app analyzes the audio and probes the clips. The creator chooses a song section or changes a setting. The app marks affected preview work stale/recomputing, creates a prepared section preview, and swaps it into playback only when ready. The result cuts on musical events and favors motion continuity.

#### UJ-2: Creator changes section focus without playback drift
The creator adjusts section boundaries or a section-specific parameter. The app cancels or supersedes stale work, recomputes the affected section, and keeps active playback tied to the last ready preview asset until the new one is ready.

#### UJ-3: Agent implements a media-pipeline slice
An agent receives one story tied to FR IDs. It edits only the active repo, runs `bun run check` or targeted commands, verifies behavior with fixtures/scripts/browser where needed, and reports actual evidence.

## 3. Glossary
- **Audio Track** — The uploaded song that defines musical timing.
- **Audio Analysis** — Normalized beats, onsets, sections, waveform, and metadata from the analysis endpoint.
- **Cut Event** — A beat, onset, section boundary, or other musical moment eligible for segmentation or edit decisions.
- **Source Clip** — A user-supplied video file before segmentation.
- **Clip Manifest** — Canonical metadata for a Source Clip: duration, dimensions, fps, codec/container, keyframes, audio presence, thumbnail metadata, support status.
- **Segment** — A post-cut media unit derived from Source Clips around musical Cut Events.
- **Segment Manifest** — Canonical data structure describing candidate Segments and their relationship to source media and musical timing.
- **Motion Descriptor** — Data used to score visual continuity, including global motion field, residual motion, motion magnitude/coherence, and continuity score.
- **Fit Policy** — Rules for trim, speed ramp, reject, or overlap when a candidate Segment does not naturally fit a target slot.
- **Section Preview** — A prepared preview asset for a song section.
- **Recompute State** — Lifecycle for preview work: fresh/ready, stale, recomputing, cancelled, failed.
- **Prepared Asset** — A preview media artifact that is complete and safe for playback.
- **Musical Alignment** — The rule that cuts/transitions land on intended musical events.
- **Motion Continuity** — The default visual mode that prefers joins with coherent motion flow.

## 4. Features and Functional Requirements

### 4.1 Audio Analysis Plane

#### FR-1: Upload and analyze Audio Track
The user can upload an Audio Track and receive normalized Audio Analysis.

Consequences:
- `/api/essentia/full` remains the canonical app proxy for hosted analysis.
- Analysis returns enough structure for beats, onsets, sections, and waveform UI.
- Analysis errors are visible and recoverable.
- Secrets are never logged or committed.

#### FR-2: Normalize analysis into canonical model
The app stores analysis output in a stable shape consumed by UI and pipeline modules.

Consequences:
- Beats/onsets/sections have consistent units and ordering.
- Downstream segmentation does not depend on raw endpoint quirks.
- Tests can use fixture analysis data.

### 4.2 Video Ingest and Probe Plane

#### FR-3: Probe Source Clips
The app can probe Source Clips into a Clip Manifest.

Consequences:
- Probe output includes duration, dimensions, fps, codec/container, keyframe/audio presence, and support status.
- Unsupported/risky media is flagged early.
- Probe scripts and UI agree on the canonical fields.

#### FR-4: Preserve thumbnails as browsing aids only
Thumbnail extraction helps the user browse clips but is not treated as the playback/render pipeline.

Consequences:
- Thumbnail failure does not imply clip failure.
- Playback/preview readiness depends on probe/segment/prepared asset status, not thumbnails alone.

### 4.3 Music-Driven Segmentation

#### FR-5: Generate Cut Events from music structure
The system derives candidate Cut Events from beats, onsets, and sections.

Consequences:
- Fixed-duration chunking is not the default segmentation model.
- Cut Events preserve musical timing and section context.
- Density/min-spacing rules are explicit and testable.

#### FR-6: Build Segment Manifest
The system builds a Segment Manifest from Source Clips and Cut Events.

Consequences:
- Segments retain source references and timing.
- Segment creation is deterministic for the same inputs/settings.
- Segment data can be tested without UI.

### 4.4 Segment Analysis and Motion Descriptors

#### FR-7: Attach Motion Descriptors to Segments
Segments can carry typed Motion Descriptor data.

Consequences:
- Descriptor schema exists and is tested.
- Simple placeholders are allowed only if typed and replaceable.
- The schema can later accept FFglitch/motion-vector-derived data.

#### FR-8: Prefer rich motion signals over cardinal tags
Coarse direction tags may be display summaries but not the primary ranking engine.

Consequences:
- Ranking code uses richer descriptor fields when available.
- Tests prevent regression to pure random/cardinal matching as default.

### 4.5 Ranking and Fit Engine

#### FR-9: Enforce musical alignment first
Ranking must prioritize musical fit above motion/color/random modes.

Consequences:
- A visually smooth but musically wrong candidate loses to a musically correct candidate.
- Tests encode the precedence.

#### FR-10: Use motion continuity as default visual mode
After musical alignment, default ranking favors motion continuity.

Consequences:
- Motion continuity is the default mode in code and docs.
- Alternate modes may exist but do not outrank musical alignment.

#### FR-11: Apply explicit Fit Policy
When a Segment does not fit a target slot, the system chooses from allowed fallback behaviors.

Consequences:
- Allowed behaviors: slight trim, speed ramp in/out, reject placement, layered overlap when supported.
- Illegal or unsupported fits are rejected visibly/testably.

### 4.6 Section Recompute and Prepared Preview

#### FR-12: Track recompute lifecycle
The app tracks Section Preview lifecycle explicitly.

Consequences:
- States include ready, stale, recomputing, cancelled, failed.
- User-visible UI reflects state.
- Stale work cannot silently replace current work.

#### FR-13: Generate prepared Section Preview assets
The system prepares preview assets for affected sections.

Consequences:
- Playback consumes ready Prepared Assets.
- Section-scoped recompute is preferred over full-song recompute where possible.
- Preview-generation failures are visible.

#### FR-14: Cancel or supersede stale jobs
When inputs change, stale jobs are cancelled or superseded.

Consequences:
- Only one current asset version may be active per section.
- Old work cannot race against new work and win accidentally.

### 4.7 Playback and UI

#### FR-15: Playback uses ready assets only
Playback never pretends stale/partial preview output is current.

Consequences:
- UI may keep playing the last ready asset while recompute runs.
- UI clearly marks when a visible preview is stale relative to current settings.

#### FR-16: Studio UI exposes readiness and progress
The user can see upload, analysis, probe, recompute, preview, and error states.

Consequences:
- No important media state is only hidden in console logs.
- Progress/readiness language is understandable to creators.

### 4.8 Verification and Platform Decision

#### FR-17: Benchmark latency and correctness
The repo can collect evidence about recompute timing and ready-to-play timing.

Consequences:
- `bench:latency` and `bench:compare` outputs inform platform decisions.
- Local and remote lanes are documented.

#### FR-18: Keep web-first unless evidence forces pivot
The app remains web-first until benchmarks or correctness failures justify Tauri/sidecar.

Consequences:
- Desktop pivot requires documented evidence, not frustration or speculation.

### 4.9 Agent Workflow

#### FR-19: Keep PRD/roadmap/test spec current
Planning artifacts in `.omx` and `docs/` remain synchronized with implementation reality.

Consequences:
- Agents update specs when product decisions change.
- Old reference-repo assumptions do not become active requirements.

#### FR-20: Require real verification evidence
Agents must run actual commands/checks before reporting completion.

Consequences:
- Preferred checks: `bun run check`, `bun run build`, `bun run probe:media`, `bun run preview:section`, `bun run bench:latency` as relevant.
- If checks fail, agents report actual output and whether failures are related.

## 5. Non-Goals
- Full professional NLE timeline in MVP.
- Auth, billing, collaboration, or cloud media management in MVP.
- Mobile app in MVP.
- Model training/fine-tuning in MVP.
- Final export before section preview/ranking correctness is credible.
- Immediate Tauri/desktop rewrite.
- Treating `svelte-video-shaders` as the active app repo.

## 6. MVP Scope

### In Scope
- Audio upload + hosted analysis proxy.
- Canonical analysis model.
- Clip probe/manifest.
- Music-driven Cut Events.
- Segment Manifest.
- Typed Motion Descriptor contract.
- Ranking engine with music-first precedence and motion-continuity default.
- Fit Policy.
- Section recompute lifecycle.
- Prepared Section Preview generation.
- Readiness/progress/error UI.
- Latency benchmark evidence.

### Out of Scope for MVP
- Final export as the first proof.
- Full-song auto-edit if section preview is not yet trustworthy.
- Cloud persistence/accounts.
- Desktop packaging.

## 7. Success Metrics

Primary:
- **SM-1:** A fixture-backed section can be recomputed into a ready preview asset and played without musical drift.
- **SM-2:** Ranking tests prove musical alignment beats motion continuity when they conflict.
- **SM-3:** Recompute tests prove stale jobs cannot silently replace newer work.
- **SM-4:** Benchmark output exists and supports the web-first/desktop decision.

Secondary:
- **SM-5:** UI clearly shows analysis/probe/recompute/readiness state.
- **SM-6:** Agents can complete a roadmap story using linked FR IDs and verification commands without asking what repo or product goal applies.

Counter-metrics:
- **SM-C1:** Number of UI controls is not success if preview correctness is unstable.
- **SM-C2:** Lower latency is not success if musical alignment is wrong.
- **SM-C3:** More continuity modes are not success if default motion continuity is unproven.

## 8. Open Questions
1. Is the first user-facing milestone “single section preview” or “whole-song rough cut”?
2. Should final export remain after section-preview correctness, or become an MVP acceptance item?
3. Should initial Motion Descriptors be lightweight placeholders or FFglitch/motion-vector backed immediately?
4. What exact latency threshold should trigger a desktop/Tauri decision review?
5. Which reference-repo ideas from `svelte-video-shaders` are worth porting first: WebCodecs buffer, shader preview, waveform/section UX, or none yet?

## 9. Assumptions Index
- The active product repo is `project-stack-structure`.
- `svelte-video-shaders` is a reference repo only.
- Web-first remains default until measured evidence says otherwise.
- Final export is secondary to section preview correctness unless user changes priority.
- Motion descriptor schema may start simple if tests preserve replaceability and ranking precedence.
