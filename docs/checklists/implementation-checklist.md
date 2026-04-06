# Implementation Checklist

This checklist tracks the path from the current repo state to a fully set up music-first preview system.

## 0. Planning and documentation foundation
- [x] Deep interview completed
- [x] Consensus PRD created
- [x] Test spec created
- [x] Roadmap doc created
- [x] Media pipeline architecture doc created
- [x] Spec workflow doc created
- [x] Latency/correctness budget doc created

## 1. Test and fixture foundation
- [x] Bun test structure added
- [x] `test`, `test:watch`, `typecheck`, and `check` scripts added
- [x] `.local-fixtures/media/` established as the default private fixture lane
- [x] `.local-fixtures/` ignored from git
- [x] Initial unit tests for timeline, ranking helpers, readout, and payload normalization added
- [x] Fixture discovery integration tests added

## 2. Media ingest and manifest foundation
- [x] Music-driven cut event builder added
- [x] Segment manifest builder added
- [x] Music-first candidate comparator added
- [x] Real fixture probing via `ffprobe` added
- [x] Canonical media probe manifest generation added
- [x] `probe:media` command added
- [x] Real fixture probe tests added

## 3. Motion descriptor layer
- [x] Define canonical motion descriptor schema
- [x] Attach descriptor generation to probed media or segments
- [x] Add tests for descriptor shape and confidence fields
- [x] Add fixture-backed descriptor validation

## 4. Ranking engine over real descriptors
- [x] Rank candidates using real descriptor data
- [x] Keep musicality-first precedence in integration tests
- [x] Add alternate mode hooks for color/random ordering
- [x] Add tests proving continuity never overrides stronger musical fit

## 5. Fit policy engine
- [x] Implement trim fallback rules
- [x] Implement speed-ramp fit rules
- [x] Implement reject-placement rules
- [x] Implement overlap eligibility rules
- [x] Add tests for all fit-policy branches

## 6. Section recompute orchestration
- [x] Define state machine: stale -> recomputing -> ready -> swapped / cancelled
- [x] Add stale-job cancellation rules
- [x] Add prepared-preview-only swap rules
- [x] Add integration tests for recompute state behavior

## 7. Preview generation path
- [x] Add first preview-generation module/command
- [x] Keep it section-scoped and prepared-asset-only
- [x] Add integration tests against fixture media
- [x] Confirm preview generation does not violate music-first rules

## 8. Benchmark and latency evidence
- [x] Add recompute timing harness
- [x] Add ready-to-play timing harness
- [x] Record hardware lane used for each benchmark
- [x] Compare local macOS vs remote heavy-compute lane where needed
- [x] Write checkpoint note for web-first vs desktop decision

## 9. UI/runtime integration
- [x] Connect real manifest/descriptor/ranking logic into the app state
- [x] Surface recomputing/progress state in the UI
- [x] Ensure active preview only swaps on ready state
- [ ] Add UI-facing integration tests where practical (recommended next; framework not yet added)

## 10. Platform checkpoint
- [x] Decide whether web-first remains acceptable
- [ ] If not, define Tauri/sidecar execution plan from benchmark evidence

---

## Current status summary
### Done now
- Planning/docs foundation
- Test structure
- Private fixture lane
- Segment manifest layer
- Real `ffprobe`-backed media probing
- Canonical probe manifest generation
- Motion descriptor contract layer
- Descriptor-based ranking engine with music-first precedence
- Fit policy engine with trim / speed-ramp / overlap / reject decisions
- Section recompute orchestration/state machine layer
- First prepared preview-generation path
- Local latency benchmark harness and checkpoint note
- Thin Studio UI integration for preview status/progress
- Preview duration validation against requested music window
- Remote benchmark-compare command and blocker note

### Current next step
**Add UI-facing integration tests where practical, or continue enriching playback-facing behavior.**

### Current evidence snapshot
- `bun run check` passing
- `bun run build` passing
- `bun run probe:media` passing
- Current test suite: 58 passing tests
- Remote heavy-compute comparison captured and reviewed
- Real fixture inventory currently includes at least 1 audio file and 23 video files
