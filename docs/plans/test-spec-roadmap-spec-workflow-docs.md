# Test Spec — Smart Auto Music Video Editor

## Metadata
- Updated: 2026-06-18 UTC
- Status: current verification spec
- Source PRD: `.omx/plans/prd-roadmap-spec-workflow-docs.md`
- Active repo: `project-stack-structure`

## Verification Goals
1. Prove musical alignment remains the highest-ranked decision factor.
2. Prove motion continuity is the default visual continuity mode after musical fit.
3. Prove section recompute lifecycle prevents stale/partial preview from masquerading as current output.
4. Prove media contracts are explicit and fixture-backed.
5. Prove platform decisions are evidence-driven through latency/correctness benchmarks.
6. Prove agents can verify work with actual repo commands.

## Required Command Gates

Use the smallest relevant set for a story; broader changes should run the full check.

```bash
bun run lint
bun run typecheck
bun run test
bun run check
bun run build
bun run probe:media
bun run preview:section
bun run bench:latency
bun run bench:compare -- <local-json> <remote-json>
```

Agents must report actual command output or the concrete blocker. Do not claim a pass without running the command.

## Test Categories

### A. Audio Analysis Contract Tests
Related FRs: FR-1, FR-2

Acceptance:
- Analysis proxy returns or normalizes beats, onsets, sections, and waveform data.
- Fixture analysis data has stable units and ordering.
- Analysis failure is recoverable and visible.
- Secrets are not logged.

Suggested checks:
- Unit tests for normalization helpers.
- Route/proxy tests where feasible.
- Browser or script check for analysis readiness state.

### B. Video Probe / Clip Manifest Tests
Related FRs: FR-3, FR-4

Acceptance:
- Probe output includes duration, dimensions, fps, codec/container, keyframe/audio presence, and support status.
- Unsupported/risky clips are flagged.
- Thumbnail generation is not treated as playback readiness.

Suggested checks:
- `bun run probe:media`
- Fixture-backed unit tests for manifest parsing/validation.

### C. Music-Driven Segmentation Tests
Related FRs: FR-5, FR-6

Acceptance:
- Cut Events derive from beats/onsets/sections.
- Fixed-duration chunking is not the default path.
- Segment Manifest is deterministic for same inputs/settings.

Suggested checks:
- Unit tests for cut-event generation.
- Unit/integration tests for segment manifest construction.

### D. Motion Descriptor Tests
Related FRs: FR-7, FR-8

Acceptance:
- Descriptor schema exists and is typed.
- Descriptor data attaches to segments.
- Ranking does not rely on cardinal direction tags as primary engine.

Suggested checks:
- Unit tests for descriptor schema validation.
- Fixture descriptor tests.

### E. Ranking and Fit Policy Tests
Related FRs: FR-9, FR-10, FR-11

Acceptance:
- Musical alignment outranks motion continuity when they conflict.
- Motion continuity is default visual continuity mode.
- Fit policy handles trim, speed ramp, reject, and overlap eligibility.
- Illegal fits are rejected predictably.

Suggested checks:
- Comparator tests with conflicting candidates.
- Fit policy table tests.
- Regression tests proving random/color modes do not override musicality.

### F. Section Recompute Lifecycle Tests
Related FRs: FR-12, FR-13, FR-14, FR-15

Acceptance:
- Recompute state transitions are explicit.
- Stale jobs cannot publish over newer jobs.
- Playback consumes only ready Prepared Assets.
- UI can distinguish last-ready from current-settings-stale.

Suggested checks:
- State machine unit tests.
- Race/cancellation tests.
- Integration test around preview job versioning.

### G. Studio UI State Tests
Related FRs: FR-16

Acceptance:
- Upload, analysis, probe, recompute, preview, and error states are visible.
- User-facing copy communicates readiness/progress clearly.
- Important media state is not console-only.

Suggested checks:
- Component tests where available.
- Browser/manual check with documented screenshots or notes.

### H. Benchmark / Platform Decision Tests
Related FRs: FR-17, FR-18

Acceptance:
- Latency benchmark captures recompute timing and ready-to-play timing.
- Benchmark output can be compared across local/remote lanes.
- Desktop/Tauri pivot decision is gated by evidence.

Suggested checks:
- `bun run bench:latency`
- `bun run bench:compare -- <local-json> <remote-json>`
- Update docs/benchmarks after meaningful benchmark runs.

### I. Agent Workflow Tests
Related FRs: FR-19, FR-20

Acceptance:
- Specs/roadmap/docs stay synchronized when product decisions change.
- Active repo is always `project-stack-structure`.
- Reference repos are not modified unless explicitly asked.
- No secrets appear in docs/logs/commits.

Suggested checks:
- `git status --short --branch`
- `git diff --stat`
- Search docs for accidental secret-like material before commit when relevant.

## Acceptance Matrix

| Requirement | Proof |
| --- | --- |
| Musicality first | Ranking tests show musical fit beats visual continuity |
| Motion continuity default | Default ranking mode and docs use motion continuity |
| No fake live preview | Recompute lifecycle tests block stale/partial asset publication |
| Segment-level analysis | Segment Manifest and descriptor tests operate on post-cut segments |
| Web-first with evidence gate | Benchmark docs and outputs inform pivot decision |
| Agent-ready workflow | Stories reference FRs and command gates |

## Completion Rule
A slice is complete only when:

1. Relevant tests/checks ran or blockers are documented with actual output.
2. The implementation maps to PRD FR IDs.
3. Product docs are updated if behavior/decision changed.
4. No unrelated repo or reference repo was modified accidentally.
