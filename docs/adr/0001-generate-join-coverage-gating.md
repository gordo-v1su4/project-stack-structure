# ADR-0001: Generate → Join coverage gating

**Status:** accepted (2026-09-06)  
**Context:** `CONTEXT.md` · GitHub issue #61

## Decision

Edit-plan **coverage signals** drive Generate readiness and Join availability. Only **true gaps** (missing primary match with no approved generated replacement) block the workflow.

| Signal | `SlotStatus` | UI tone | Blocks Join? |
| --- | --- | --- | --- |
| Missing primary | `missing` | Red (`failed`) | **Yes** |
| Short source | `short` | Purple (`review`) | **No** — optional whole-shot replacement |
| Weak match (score &lt; 45%) | `weak` | Yellow (`processing` / warn) | **No** — optional reroll |

Implementation sources:

- Classification: `editPlanCoverage.ts` (`analyzeEditPlanCoverage`, `COVERAGE_WEAK_SCORE_THRESHOLD = 0.45`)
- Pipeline: `studioPipeline.ts` — `generateReady = matchReady && gapSlotCount === 0` where `gapSlotCount` is `trueGapCount` only
- Approved generated assets that cover a missing primary reduce `trueGapCount` to zero (`tests/unit/studioPipeline.test.ts`)

## Rationale

Users must not assemble a Join timeline with holes, but short-source and weak-match slots are quality reviews — not workflow blockers. Purple/yellow must never be promoted to red in sidebar or Generate metrics.

## Consequences

- Generate stage copy and metrics must label optional reviews explicitly (“optional”, not “gap”).
- Whole-shot replacement (`wholeShotReplacement.ts`) is the guided path for purple slots; it must be visible in Generate UI (issue #61).
- Section-level preview playback is **out of scope** for this ADR; continuity review stays at Match evidence + Generate cut audition until a future feature lands.

## Alternatives considered

- **Block Join on weak matches** — rejected; forces unnecessary Generate work when footage is usable.
- **Block Join on short source** — rejected; trim/glue policies may suffice; replacement is opt-in.
- **Treat all coverage issues as “gaps”** — rejected; conflates blocking holes with quality review.
