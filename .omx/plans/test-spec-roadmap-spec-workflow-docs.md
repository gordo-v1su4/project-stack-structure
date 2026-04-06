# Test Spec — Auto Music Video Editor Foundation

## Metadata
- Date: 2026-04-05 UTC
- Source PRD: `.omx/plans/prd-roadmap-spec-workflow-docs.md`
- Source spec: `.omx/specs/deep-interview-roadmap-spec-workflow-docs.md`
- Scope: documentation + future execution verification design

## Verification Goals
1. Prove the planning artifacts faithfully encode the clarified requirements.
2. Prove future implementation work can be tested against musicality-first behavior.
3. Prove the roadmap contains a measurable decision path for web-first vs desktop pivot.

## Test Categories

### A. Artifact correctness tests
- Confirm PRD cites the current repo touchpoints:
  - `package.json`
  - `src/components/StudioApp.tsx`
  - `src/components/studio/audioAnalysis.ts`
  - `src/components/studio/mediaUpload.ts`
  - `src/app/api/essentia/full/route.ts`
- Confirm PRD and test spec align with the deep-interview artifact.
- Confirm older-model wording is not reintroduced in future project docs that derive from these artifacts.

### B. Protocol acceptance tests
1. **Music-driven segmentation test**
   - Planned system must define cuts from beats/onsets/sections, not fixed-duration chunking.
2. **Post-cut segment analysis test**
   - Planned system must analyze motion on resulting segments, not only whole-source clips.
3. **Ranking precedence test**
   - Planned system must state that musical alignment outranks motion/color/random continuity modes.
4. **Motion descriptor richness test**
   - Planned system must use richer descriptors than simple cardinal direction tags for ranking.
5. **Fit fallback test**
   - Planned system must define allowed fallback behaviors: trim, speed-ramp, reject placement, layered overlap when supported.
6. **Recompute-state test**
   - Planned system must define explicit recomputing/ready states instead of pretending stale previews are playable.
7. **No-overlap orchestration test**
   - Planned system must define stale-job cancellation or equivalent safeguards so active playback does not drift because of overlapping analysis/recompute work.

### C. Script taxonomy tests
- Verify docs separate current scripts (`dev`, `build`, `start`, `lint`) from recommended future scripts.
- Verify recommended future scripts are grouped by quality, media, and docs responsibilities.
- Verify no future script is documented without a clear purpose and input/output contract.

### D. Roadmap decision-gate tests
- Verify the roadmap includes a formal performance checkpoint before a platform pivot.
- Verify remote Tailscale / RTX 5090 / dockerized GPU pass-through is documented as an optional test lane, not a hard dependency.
- Verify local macOS testing remains acceptable for correctness-first work.

## Acceptance Matrix
| Requirement | Proof |
| --- | --- |
| Musicality first | PRD ranking policy section says musical alignment wins first |
| Motion default mode | PRD names motion continuity as default rejoin mode |
| No blind quantization | PRD/spec preserve beat/onset authority over arbitrary grid snapping |
| Rich motion analysis | PRD names global motion field + residual motion + continuity score |
| Explicit recompute state | PRD protocol requires ready-state asset swap |
| Web-first baseline | ADR chooses web-first FFmpeg/FFprobe-backed baseline |
| Desktop contingency | ADR/roadmap define Tauri pivot checkpoint |

## Future Execution Verification Plan

### Unit-level checks
- Ranking-policy helpers choose musical alignment over weaker musical candidates.
- Segment-fit policy rejects illegal placements and permits documented fallback paths.
- Motion descriptor schema contains required fields for global motion, residual motion, and continuity scoring.

### Integration checks
- Audio analysis output can feed cut-event generation without requiring fixed-duration chunking.
- Video probe output can feed segment-manifest creation.
- Section recompute state transitions correctly from stale -> recomputing -> ready.

### End-to-end checks
- User changes section/mode -> recompute indicator appears -> prepared preview swaps in only when ready.
- Candidate clip ordering changes by mode (motion/color/random) without violating musical alignment.
- Problematic clip-fit cases trigger documented fallback behavior rather than silent drift.

### Observability / benchmark checks
- Benchmark records section recompute duration and ready-to-play timing.
- Logs or traces can distinguish stale canceled work from current active work.
- Test notes capture whether local macOS or remote heavy-compute hardware was used.

## Exit Criteria
The planning phase is complete when:
1. This test spec and the PRD both exist in `.omx/plans/`.
2. The PRD and test spec both point back to the deep-interview spec as source of truth.
3. Future execution can proceed without reopening fundamental ambiguity on segmentation, ranking precedence, or fit fallback behavior.

## Critic Verdict
APPROVE

Reasoning:
- Acceptance criteria are concrete.
- Verification path is explicit.
- Ranking precedence and motion-analysis requirements are no longer ambiguous.
- The plan preserves reversibility by keeping Tauri contingent.
