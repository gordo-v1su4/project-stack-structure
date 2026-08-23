# PRD — Current Implementation Buildout

## Metadata
- Updated: 2026-06-18 UTC
- Status: current implementation roadmap
- Source PRD: `docs/plans/prd-roadmap-spec-workflow-docs.md`
- Source test spec: `docs/plans/test-spec-roadmap-spec-workflow-docs.md`
- Active repo: `project-stack-structure`

## Purpose
This document converts the current PRD into an agent-executable buildout path. It replaces older implementation notes that treated the April docs as final. The current goal is a section-preview-first, music-aligned, motion-continuity smart music-video editor in this repo.

## Product Rules That Cannot Change
1. Musical alignment is always the top priority.
2. Motion continuity is the default visual continuity mode.
3. Prepared section preview beats fake live mutation.
4. Post-cut segments are the analysis/ranking unit.
5. Web-first remains default until benchmark evidence says otherwise.
6. Reference repos are references, not active workspaces.
7. No secrets in docs, logs, prompts, or commits.

## Current Verified Starting Point
Known repo anchors:

- `src/components/StudioApp.tsx`
- `src/components/studio/audioAnalysis.ts`
- `src/components/studio/mediaUpload.ts`
- `src/components/studio/previewGeneration.ts`
- `src/components/studio/ffglitchApi.ts`
- `src/app/api/essentia/full/route.ts`
- `src/app/api/ffglitch/route.ts`
- `docs/roadmap.md`
- `docs/architecture/media-pipeline.md`
- `docs/protocols/spec-workflow.md`
- `docs/protocols/latency-budget.md`

Current verification scripts exist in `package.json`:

- `bun run lint`
- `bun run typecheck`
- `bun run test`
- `bun run check`
- `bun run build`
- `bun run probe:media`
- `bun run preview:section`
- `bun run bench:latency`
- `bun run bench:compare`

## Recommended First Slice

### Slice 1 — Planning source cleanup and sync

**FRs:** FR-19, FR-20

Goal: Keep the canonical planning artifacts in `docs/plans/` aligned with the current active goal.

Tasks:
1. Keep the PRD/spec/test/buildout artifacts in `docs/plans/` current (relocated from `.omx` on 2026-08-23).
2. Update `docs/roadmap.md` to point to the current PRD and remove stale “recommended future scripts” language that is now implemented.
3. Update `README.md` planning section if needed.
4. Run docs sanity checks and `git status`.

Acceptance:
- `docs/plans/prd-roadmap-spec-workflow-docs.md` is current.
- `docs/plans/test-spec-roadmap-spec-workflow-docs.md` is current.
- `docs/plans/prd-implementation-buildout.md` is current.
- `docs/roadmap.md` does not contradict current PRD.
- Active repo is clearly `project-stack-structure`.

Verification:
- `git status --short --branch`
- `grep -R "svelte-video-shaders" docs/plans docs README.md` should mention it only as a reference repo, if at all.
- `grep -R "recommended future scripts" docs docs/plans` should not imply missing scripts that now exist.

### Slice 2 — Contract audit against current code

**FRs:** FR-1 through FR-6, FR-19

Goal: Audit current code against the PRD contracts before adding new behavior.

Tasks:
1. Inspect audio analysis model in `src/components/studio/audioAnalysis.ts`.
2. Inspect media probe/thumbnail flow in `src/components/studio/mediaUpload.ts`.
3. Inspect segment manifest and preview scripts/modules.
4. Write or update contract notes in `docs/architecture/media-pipeline.md`.
5. Identify exact gaps for the next implementation slice.

Acceptance:
- Audio Analysis fields are documented.
- Clip Manifest fields are documented.
- Segment Manifest assumptions are documented.
- Gaps are turned into concrete stories.

Verification:
- `bun run check`
- `bun run probe:media`

### Slice 3 — Recompute state machine hardening

**FRs:** FR-12, FR-13, FR-14, FR-15, FR-16

Goal: Make section preview lifecycle explicit and race-safe.

Likely files:
- `src/components/StudioApp.tsx`
- `src/components/studio/previewGeneration.ts`
- related state modules/hooks if present

Tasks:
1. Identify current preview/recompute state shape.
2. Define explicit states: ready, stale, recomputing, cancelled, failed.
3. Add versioning/job identity to prevent stale publish.
4. Surface state in UI.
5. Add tests around stale/new job behavior if feasible.

Acceptance:
- Stale jobs cannot replace newer prepared assets.
- UI shows recomputing/ready/failed state.
- Playback uses last ready asset until new one is ready.

Verification:
- `bun run check`
- targeted tests for recompute state
- browser/manual check if UI state changes

### Slice 4 — Ranking and fit policy proof

**FRs:** FR-7 through FR-11

Goal: Prove music-first ranking and default motion-continuity behavior in code.

Tasks:
1. Locate or create ranking module.
2. Define candidate shape with musical fit and motion descriptor fields.
3. Add comparator tests proving musical alignment wins.
4. Add fit policy tests for trim/ramp/reject/overlap.
5. Document any placeholder descriptor fields as temporary but typed.

Acceptance:
- Tests fail if motion continuity outranks musical alignment.
- Motion continuity is the default mode after musical fit.
- Fit policy returns explicit decisions.

Verification:
- `bun run test`
- `bun run check`

### Slice 5 — Prepared section preview path

**FRs:** FR-12 through FR-16

Goal: Ensure preview generation consumes the ranking/fit/manifest contracts and produces a ready section preview.

Tasks:
1. Inspect `src/components/studio/previewGeneration.ts` and `scripts/preview-section.ts`.
2. Ensure prepared preview output has a stable manifest/metadata shape.
3. Ensure UI consumes only ready output.
4. Add failure/readiness UI if missing.

Acceptance:
- `preview:section` produces or verifies a prepared section preview with fixture media.
- UI state clearly distinguishes stale/current settings from last-ready preview.

Verification:
- `bun run preview:section`
- `bun run check`

### Slice 6 — Benchmark and platform decision checkpoint

**FRs:** FR-17, FR-18

Goal: Maintain evidence for web-first viability.

Tasks:
1. Run `bun run bench:latency` locally.
2. Compare to existing benchmark docs.
3. If remote benchmark data exists, run `bench:compare`.
4. Update `docs/benchmarks/` with findings.
5. Decide whether web-first remains supported.

Acceptance:
- Latest benchmark evidence exists.
- Docs state whether web-first remains viable and why.
- Desktop/Tauri remains contingent unless evidence crosses threshold.

Verification:
- `bun run bench:latency`
- `bun run bench:compare -- <local-json> <remote-json>` when applicable

## Agent Execution Rules

- Work only in `project-stack-structure` unless user explicitly names another repo.
- Treat `svelte-video-shaders` as a reference repo only.
- Start each coding slice by reading the linked PRD FRs.
- Run relevant commands and report actual output.
- Do not repeat a failed approach more than three times; reassess with file state, system state, and approach validity.
- Do not expose secrets.
- Keep changes focused and commit docs separately from implementation.

## Immediate Next Commit Candidate

A safe first commit is documentation-only:

```bash
git add docs/plans/deep-interview-roadmap-spec-workflow-docs.md \
  docs/plans/prd-roadmap-spec-workflow-docs.md \
  docs/plans/test-spec-roadmap-spec-workflow-docs.md \
  docs/plans/prd-implementation-buildout.md

git commit -m "docs: refresh music video product specs"
```

Only commit after user review or explicit approval.
