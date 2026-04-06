# PRD — Media Pipeline Buildout

## Metadata
- Date: 2026-04-06 UTC
- Source roadmap PRD: `.omx/plans/prd-roadmap-spec-workflow-docs.md`
- Source test spec: `.omx/plans/test-spec-roadmap-spec-workflow-docs.md`
- Scope: implementation path from current documentation/test foundation to a working media pipeline

## Purpose
This PRD translates the roadmap into a concrete buildout path so the project can move from planning and contract validation into a real music-first preview system.

## Product Rules That Cannot Change
1. **Musical alignment is always the top priority.**
2. **Motion continuity is the default visual continuity mode.**
3. **Accuracy beats quick-scan shortcuts.**
4. **Prepared section preview is better than laggy pseudo-live playback.**
5. **Desktop/Tauri remains a contingency, not the default, until evidence proves otherwise.**

## Current Verified State
### Completed
- Documentation foundation exists under `docs/`.
- Consensus PRD and test spec exist under `.omx/plans/`.
- Bun-based test structure exists under `tests/`.
- Local fixture lane is established at `.local-fixtures/media/` and ignored from git.
- `segmentManifest.ts` exists and is tested.
- `mediaProbe.ts` exists and probes real local media through `ffprobe`.
- `probe:media` command emits a canonical fixture manifest.
- Motion descriptor contracts now exist for probed files and segment manifests.

### Fresh evidence
- `bun run check` passes.
- `bun run build` passes.
- `bun run probe:media` passes.
- Current observed fixture inventory:
  - audio files: 1
  - video files: 23
  - total probed items: 24

## Problem Statement
The repo now has planning artifacts, test structure, segment-manifest logic, and real fixture probing. What it does not yet have is the rest of the execution path needed to turn those contracts into a musically correct preview engine:
- real motion descriptor extraction,
- ranking over real descriptors,
- fit policy execution,
- section recompute state orchestration,
- preview asset generation,
- benchmark evidence for the web-vs-desktop decision.

## Desired Outcome
The project should reach a state where:
- real fixture media can be probed,
- descriptors can be attached to media/segments,
- ranking decisions are provably music-first,
- fit fallbacks are encoded and tested,
- section recompute behavior is explicit and testable,
- a first real preview pipeline exists,
- latency evidence exists to support or reject the web-first baseline.

## In Scope
- Media probe and manifest evolution
- Motion descriptor extraction contract
- Ranking engine implementation over real descriptors
- Fit policy implementation
- Section recompute state machine
- Preview generation contract and first implementation
- Benchmark / latency evidence capture
- Supporting tests and scripts

## Out of Scope
- Final export pipeline
- Auth, billing, collaboration
- Mobile app
- Full professional editing UI
- Production deployment hardening

## Acceptance Criteria
1. A canonical motion descriptor schema exists and is exercised by tests.
2. Ranking functions operate on real descriptor/manifests and prove musicality-first behavior.
3. Fit policy rules exist for trim, speed-ramp, reject, and overlap eligibility.
4. A section recompute state machine exists with tests for stale/recomputing/ready/cancelled behavior.
5. A first preview-generation path exists and uses prepared assets only.
6. A benchmark path exists for recompute timing and ready-to-play timing.
7. The repo can produce evidence supporting or challenging the web-first baseline.

## Buildout Phases
### Phase A — Motion descriptor contract
Create a first descriptor layer that can be attached to probed fixture media and, later, to post-cut segments.

Deliverables:
- motion descriptor module
- typed schema
- fixture-backed tests

### Phase B — Ranking engine on real descriptors
Use descriptor data to rank candidate joins while preserving music-first precedence.

Deliverables:
- ranking module
- integration tests over real manifests/descriptors
- alternate mode hooks for motion/color/random

### Phase C — Fit policy engine
Encode the legal fit decisions when a segment does not naturally fit a target slot.

Deliverables:
- fit-policy module
- tests for trim / ramp / reject / overlap gating

### Phase D — Section recompute orchestration
Formalize the state transitions for recompute and preview readiness.

Deliverables:
- recompute state machine
- tests for stale cancellation and ready-only swap behavior

### Phase E — Preview generation path
Implement a first real preview generation flow, likely FFmpeg-backed and section-scoped.

Deliverables:
- preview generation module/command
- prepared preview artifacts
- integration tests

### Phase F — Benchmark and checkpoint
Measure whether the web-first path remains viable.

Deliverables:
- latency benchmark harness
- hardware lane notes (local macOS vs remote Tailscale machine)
- decision memo for web-first vs desktop contingency

## Risks and Mitigations
| Risk | Mitigation |
| --- | --- |
| Motion descriptors are too weak to improve joins | Start with a typed schema and fixture-backed assertions before UI use |
| Ranking starts favoring continuity over music | Keep explicit music-first comparator tests in every ranking layer |
| Recompute work overlaps active playback | Encode cancellation/ready-state rules before preview integration |
| Preview generation becomes expensive too early | Keep first path section-scoped and prepared-asset-only |
| Desktop pivot pressure appears before evidence exists | Require benchmark output before platform re-decision |

## Verification Plan
- `bun run check`
- `bun run build`
- `bun run probe:media`
- targeted integration tests for descriptor, ranking, fit, recompute, and preview modules
- architect verification at each significant milestone slice

## Current Position on the Path
The repo is now through local and remote benchmark comparison for the current prepared-preview slice. Current evidence supports staying web-first. The next clean implementation slice is deeper UI/runtime integration so manifest, descriptor, and ranking decisions affect more of the preview experience.
