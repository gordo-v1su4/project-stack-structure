# Product Roadmap

## Purpose
This roadmap turns the approved PRD into a phased delivery path for the smart auto music-video editor.

The product goal is to:
- analyze uploaded audio,
- cut and rearrange user-supplied video to music events,
- keep **musical alignment** as the top priority,
- use **motion continuity** as the default visual continuity mode,
- prefer **accurate, prepared section preview** over laggy pseudo-live playback.

## Current Brownfield Baseline
Current evidence from the codebase:
- `package.json` currently exposes `dev`, `build`, `start`, and `lint`.
- `src/components/StudioApp.tsx` already provides the main studio UI with split/join/shuffle/ramp flows.
- `src/components/studio/audioAnalysis.ts` already uploads audio, derives waveform data, and normalizes beats/onsets/sections.
- `src/components/studio/mediaUpload.ts` currently extracts basic metadata and thumbnails, but does not yet establish a deterministic preview pipeline.
- `src/app/api/essentia/full/route.ts` already proxies hosted audio analysis.

## Product Priorities
1. **Musicality first**
   - Beat/onset/section alignment outranks every secondary heuristic.
2. **Motion continuity second**
   - Motion continuity is the default visual rejoin mode.
3. **Accuracy over quick scan**
   - Rich segment descriptors are preferred over shallow clip tagging.
4. **Prepared playback over fake real time**
   - The app should show explicit recompute/progress states whenever preview assets are not ready.

## What the first serious version must prove
- Audio analysis is reliable and visually useful.
- Music-driven cut events can define candidate segment boundaries.
- Post-cut video segments can be analyzed and reordered.
- Preview playback can stay musically correct after section recompute.
- Motion continuity can produce better joins than naive/random ordering.

## What is explicitly out of scope for this phase
- Final export as a must-have milestone
- Auth, billing, collaboration
- Mobile app
- Full professional NLE timeline editing
- Model training / fine-tuning

## Phase 0 — Documentation and control-plane foundation
### Goal
Make future work execution-safe before feature implementation accelerates.

### Deliverables
- Approved deep-interview artifact
- PRD and test spec in `.omx/plans/`
- Canonical docs under `docs/`
- Shared terminology for cut events, segments, recompute states, continuity modes, and fit fallback behavior

### Exit criteria
- All planning artifacts exist.
- Acceptance criteria are explicit and testable.
- Execution can proceed without reopening scope ambiguity.

## Phase 1 — Canonical ingest contracts
### Goal
Stabilize source-of-truth data flowing into the editor.

### Work
- Lock audio analysis contract from `/api/essentia/full` through normalized UI state.
- Define canonical video probe output for each uploaded clip.
- Define a canonical segment manifest keyed to music-driven cuts.

### Exit criteria
- Audio analysis fields are stable and documented.
- Clip probe schema is documented.
- Segment manifest inputs and outputs are explicit.

## Phase 2 — Deterministic section preview
### Goal
Make section recompute trustworthy.

### Work
- Introduce a section recompute lifecycle.
- Define stale-job cancellation behavior.
- Swap preview assets only when the recomputed result is ready.
- Surface recompute/progress in the UI.

### Exit criteria
- No stale work silently competes with active playback.
- Preview playback consumes stable prepared assets only.
- Section changes preserve musical correctness.

## Phase 3 — Ranking and fit engine
### Goal
Choose and fit segments intelligently.

### Work
- Make **motion continuity** the default rejoin mode.
- Add alternate modes later such as **color continuity** and **random**.
- Use rich motion descriptors:
  - global motion field
  - residual motion
  - continuity score
- Define fit fallback behavior:
  - slight trim
  - speed ramp in/out
  - reject placement
  - layered overlap when supported

### Exit criteria
- Ranking precedence is explicit and testable.
- Segment fit behavior is predictable.
- Motion descriptors are richer than coarse direction tags.

## Phase 4 — Performance checkpoint
### Goal
Decide whether web-first remains viable.

### Work
- Measure local macOS behavior.
- Optionally benchmark on remote Tailscale-accessible hardware.
- Use heavier hardware, including a Windows machine with RTX 5090 or dockerized GPU pass-through, only when accuracy testing requires it.
- Decide if the browser path preserves musical correctness under load.

### Exit criteria
- A latency benchmark exists.
- The team can say whether web-first remains acceptable.
- If not, the desktop/Tauri pivot is justified by evidence instead of assumption.

## Phase 5 — Later capabilities
- Final export
- richer continuity modes
- expanded editing controls
- packaging/distribution hardening

## Architecture Decision Checkpoint
### Default baseline
Stay **web-first with FFmpeg/FFprobe-backed section precompute**.

### Pivot trigger
Escalate to **Tauri + sidecar media tooling** only if browser scheduling, decode behavior, or recompute orchestration cannot preserve musically correct preview playback.

## Current vs Planned Scripts
### Current scripts
| Script | Meaning |
| --- | --- |
| `dev` | local app development |
| `build` | production build verification |
| `start` | run the built app |
| `lint` | linting |

### Recommended future scripts
| Script | Purpose |
| --- | --- |
| `typecheck` | TypeScript verification lane |
| `check` | aggregate quality gate |
| `probe:media` | inspect source media via ffprobe |
| `analyze:audio` | replay/canonicalize audio-analysis flow |
| `preview:section` | build deterministic section preview |
| `bench:latency` | measure recompute + ready-to-play timing |
| `doctor:media` | detect missing media capabilities |
| `docs:spec:new` | scaffold spec artifacts |
| `docs:spec:check` | validate required spec sections |

## Success definition for roadmap execution
The roadmap is succeeding when:
- the planning artifacts stay synchronized with implementation reality,
- musical alignment remains the non-negotiable top priority,
- motion continuity has a credible default path,
- the platform decision stays evidence-driven.
