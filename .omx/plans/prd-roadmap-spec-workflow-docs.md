# PRD — Auto Music Video Editor Foundation

## Metadata
- Date: 2026-04-05 UTC
- Planning mode: ralplan / consensus / short
- Source spec: `.omx/specs/deep-interview-roadmap-spec-workflow-docs.md`
- Source transcript: `.omx/interviews/roadmap-spec-workflow-docs-20260405T012314Z.md`
- Context snapshot: `.omx/context/roadmap-spec-workflow-docs-20260405T010154Z.md`
- Planning scope: documentation + roadmap + protocols only

## Requirements Summary
This app should become a smart auto music-video editor that:
- analyzes uploaded audio,
- cuts/reorganizes uploaded video to music events,
- prioritizes musical alignment above all other join heuristics,
- defaults to motion continuity as the primary visual rejoin mode,
- uses richer motion analysis (`global motion field + residual motion + continuity score`) rather than coarse direction tags,
- favors explicit section recompute states over laggy pseudo-live playback.

The current brownfield evidence is:
- `package.json` only exposes `dev`, `build`, `start`, and `lint`.
- `src/components/StudioApp.tsx` already models split/join/shuffle/ramp controls and preview-oriented studio UX.
- `src/components/studio/audioAnalysis.ts` already uploads audio, decodes waveform data, and normalizes beats/onsets/sections.
- `src/components/studio/mediaUpload.ts` currently prepares video metadata and thumbnails only.
- `src/app/api/essentia/full/route.ts` already proxies hosted analysis.

## Acceptance Criteria
1. Roadmap documents a phase-based path from current prototype to deterministic section preview system.
2. Spec workflow documents a repeatable path: deep interview -> PRD -> test spec -> implementation -> verification.
3. Documentation defines segment analysis at the **post-cut segment** level, not whole-clip tags or fixed-duration chunking.
4. Documentation defines ranking precedence: **musical alignment first**, **motion continuity default visual mode**, optional secondary modes like color/random later.
5. Documentation defines fit fallbacks: slight trim, speed ramp in/out, reject placement, layered overlap when supported.
6. Documentation defines a media-processing protocol that avoids overlapping playback and recompute work.
7. Documentation separates **current scripts** from **recommended future scripts**.
8. Documentation records the web-first baseline and the explicit desktop/Tauri pivot condition if browser latency cannot preserve musical correctness.
9. Documentation standardizes future model references on GPT-5.4 wording and removes stale older-model wording from future project docs.

## RALPLAN-DR Summary

### Principles
1. Musical alignment outranks every secondary heuristic.
2. Prepared, trustworthy playback is better than fake real-time lag.
3. Segment-level analysis is the atomic unit for rearrangement.
4. Accuracy is favored over shallow quick-scan analysis.
5. Architecture should stay reversible until performance evidence forces a pivot.

### Decision Drivers
1. Preserve musicality at joins and section transitions.
2. Achieve reliable segment recompute + preview without drift.
3. Choose a media backbone that is correct first and optimizable second.

### Viable Options
#### Option A — Web-first with FFmpeg/FFprobe backbone and section precompute
**Pros**
- Best match for current brownfield app shape.
- Strongest correctness path for media probing, segmentation, and deterministic preview asset prep.
- Keeps browser UI while avoiding overpromising live mutation.
- Leaves desktop pivot open.

**Cons**
- Requires non-trivial media orchestration beyond current browser-only thumbnail prep.
- Browser UX must tolerate explicit recompute states.

#### Option B — Browser-native first with WebCodecs/WebGPU-heavy path
**Pros**
- Potentially strong future interactivity.
- Keeps everything inside the web runtime.

**Cons**
- Higher implementation risk now.
- WebCodecs does not demux containers itself.
- WebGPU support is less universal and is better treated as optimization, not baseline.
- Higher chance of rebuilding the pipeline twice.

#### Option C — Desktop-first pivot now via Tauri + sidecar binaries
**Pros**
- Strong hardware control and easier heavy processing path.
- Natural fit for bundled FFmpeg/FFprobe sidecars.

**Cons**
- Premature platform pivot before proving the current app’s UX and protocol model.
- Raises packaging/distribution complexity too early.

### Favored Option
Option A.

### Invalidation Rationale
- Option B is rejected as the baseline because it optimizes too early for browser-native sophistication before the segment protocol is proven.
- Option C is rejected as the immediate baseline because the product still needs to prove its workflow and UX assumptions before a platform pivot.

## ADR
### Decision
Adopt a **web-first, FFmpeg/FFprobe-backed, section-precompute architecture** as the planned baseline.

### Drivers
- Musical accuracy must remain authoritative.
- Motion continuity needs richer descriptors than coarse tags.
- Current repo already has a browser-first surface and hosted audio analysis path.
- The user explicitly accepts recompute/loading states if playback stays trustworthy.

### Alternatives considered
- Browser-native WebCodecs/WebGPU-first pipeline
- Immediate desktop-first Tauri pivot

### Why chosen
It is the narrowest plan that preserves correctness, respects current app shape, and creates a reversible path to a desktop pivot if needed.

### Consequences
- Preview generation becomes an explicit staged pipeline, not an implicit live-edit illusion.
- Segment manifests and motion descriptors become first-class data products.
- Some future media work may need heavier external compute or remote hardware validation.

### Follow-ups
- Define canonical segment manifest.
- Define motion descriptor schema.
- Define recompute/playback state machine.
- Define latency benchmark and pivot trigger.


## Architect Review
### Steelman antithesis
A stronger long-term architecture may be to pivot earlier toward a desktop runtime with bundled sidecars, because media-heavy preview systems often suffer from browser scheduling, decode variability, and worker/UI contention. If the app’s core promise is musically exact preview under load, browser-first may delay the inevitable.

### Tradeoff tension
- **Web-first** preserves current app shape and lowers initial coordination cost.
- **Desktop-first** may better serve hard latency and compute goals, but increases platform and packaging complexity before the workflow is proven.

### Synthesis
Use web-first as the proving lane, but make the performance checkpoint explicit and early. Treat the desktop pivot as a planned branch, not a failure.

## Critic Review
### Verdict
APPROVE

### Findings applied
- Ranking precedence is explicit.
- Viable options are fairly compared and rejected with rationale.
- Risks and mitigations are concrete.
- Verification path is testable.
- Staffing and execution handoff guidance are present.

## Product Scope
### In scope now
- Documentation roadmap
- Spec workflow
- Media protocols
- Ranking rules
- Script taxonomy
- Execution/testing guidance

### Out of scope now
- Coding the pipeline
- Final export
- Auth/billing/collaboration
- Mobile app
- Full pro timeline editor
- Model training/fine-tuning

## Proposed Roadmap
### Phase 0 — Documentation and control-plane foundation
- Publish roadmap, PRD, and test spec.
- Define canonical terminology: cut event, segment, section recompute, continuity mode, fit fallback.
- Define doc ownership and plan gates.

### Phase 1 — Canonical ingest contracts
- Lock audio analysis contract from `/api/essentia/full` through normalized UI model.
- Define canonical clip probe contract for video assets.
- Define segment manifest schema tied to music-driven cut events.

### Phase 2 — Deterministic section preview protocol
- Build/document section recompute lifecycle.
- Define stale-job cancellation and prepared-asset swap rules.
- Ensure playback only consumes fully ready assets.

### Phase 3 — Ranking and fit engine
- Make motion continuity the default rejoin mode.
- Add alternate modes: color continuity, random.
- Define motion descriptor schema around global motion field + residual motion + continuity score.
- Define fit fallback policies: trim, speed ramp, reject placement, layered overlap.

### Phase 4 — Performance checkpoint
- Benchmark local macOS path.
- Benchmark remote heavy-compute path over Tailscale / RTX 5090 / containerized GPU pass-through when needed.
- Decide whether browser baseline remains viable or whether Tauri becomes necessary.

### Phase 5 — Later product capabilities
- Final export
- richer controls
- broader continuity modes
- packaging/distribution hardening

## Implementation Steps (for downstream execution)
1. **Documentation lane**
   - Author canonical docs under `docs/` using the PRD and test spec as source of truth.
   - Likely touchpoints: new `docs/roadmap.md`, `docs/protocols/spec-workflow.md`, `docs/architecture/media-pipeline.md`, `docs/protocols/latency-budget.md`.
2. **Data-contract lane**
   - Define canonical analysis and segment manifest schemas based on existing structures in `src/components/studio/audioAnalysis.ts` and future video probe outputs.
3. **Preview-state lane**
   - Define section recompute state machine against current `StudioApp` behavior in `src/components/StudioApp.tsx`.
4. **Media-backbone lane**
   - Introduce planned FFprobe/FFmpeg probe and preview commands/scripts, separate from UI concerns.
5. **Benchmark lane**
   - Define latency benchmark harness and remote-test procedure.

## Risks and Mitigations
| Risk | Mitigation |
| --- | --- |
| Motion analysis becomes too coarse and produces ugly joins | Use richer segment descriptors, not cardinal tags |
| Browser path keeps drifting under recompute load | Explicit prepared-asset swap model; performance checkpoint with desktop pivot path |
| Cuts become over-quantized and lose musicality | Keep beats/onsets authoritative; avoid blind quantization |
| Segment fit issues cause broken reorderability | Allow trim/ramp/reject/layered-overlap fallback rules |
| Docs drift from actual codebase | Keep file-based evidence sections and require plan/test-spec updates before implementation |

## Verification Steps
- Verify PRD references current repo facts (`package.json`, `StudioApp.tsx`, `audioAnalysis.ts`, `mediaUpload.ts`, `route.ts`).
- Verify all acceptance criteria are concrete and testable.
- Verify roadmap phases align with user-stated priorities: musicality first, motion continuity default, accuracy over quick scan.
- Verify desktop pivot remains contingent, not assumed.

## Available-Agent-Types Roster
- `planner` — sequencing and artifact structure
- `architect` — architecture and boundary tradeoffs
- `critic` — plan quality and testability
- `executor` — implementation lanes
- `debugger` — failure diagnosis
- `verifier` — completion evidence
- `test-engineer` — test design and harness coverage
- `researcher` — external docs / protocol research
- `writer` — documentation authoring
- `designer` — UI/UX flow shaping
- `security-reviewer` — trust boundary review when needed
- `code-reviewer` — final integrated review

## Follow-up Staffing Guidance
### If executed via `$ralph`
- `executor` (high): media contract + preview state implementation
- `test-engineer` (medium): test harness + acceptance coverage
- `verifier` (high): proof that recompute/playback and ranking precedence match the plan
- `writer` (medium): docs sync after implementation

### If executed via `$team`
- Lane 1: `writer` / medium — publish docs and protocol pages
- Lane 2: `executor` / high — segment manifest + ranking contract
- Lane 3: `executor` / high — preview-state architecture and orchestration lane
- Lane 4: `test-engineer` / medium — benchmark + verification harness
- Lane 5: `researcher` or `architect` / medium-high — remote compute / Tauri contingency analysis
- Verification owner: `verifier` / high

## Launch Hints
### Ralph hint
```text
$ralph .omx/plans/prd-roadmap-spec-workflow-docs.md
```

### Team hint
```text
$team .omx/plans/prd-roadmap-spec-workflow-docs.md
```

Or explicit CLI-style coordination hint:
```text
omx team start .omx/plans/prd-roadmap-spec-workflow-docs.md
```

## Team Verification Path
Before shutdown, team execution should prove:
1. Canonical docs exist and match this PRD.
2. Segment/ranking rules are implemented or explicitly documented with no ambiguity.
3. Recompute/playback orchestration avoids overlapping stale work.
4. Benchmark lane captures evidence for whether web-first remains viable.

If team execution completes, a final Ralph/verifier pass should confirm:
- acceptance criteria are met,
- docs and implementation match,
- no unresolved ambiguity remains in ranking precedence or media fit rules.

## Planner Changelog
- Chose web-first FFmpeg/FFprobe baseline.
- Kept Tauri as contingency rather than default.
- Elevated musical alignment and motion continuity precedence.
- Added remote-heavy-compute testing policy.
