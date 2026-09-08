# ADR-0001: Generate → Join coverage gating

**Status:** revised (2026-09-08), following the whole-song rough-cut request
**Context:** `CONTEXT.md` · GitHub issue #61

## Decision

Edit-plan **coverage signals** drive Generate completion and final export readiness. Join remains available once Story is confirmed, Split is committed, and a saved song timeline exists. True gaps play as visible placeholders at their original song times; they block final export until filled with eligible footage or an approved replacement.

| Signal | `SlotStatus` | UI tone | Blocks Join? |
| --- | --- | --- | --- |
| Missing eligible source | `missing` | Red (`failed`) | **No** — blocks final export |
| Short source | `short` | Purple (`review`) | **No** — optional whole-shot replacement |
| Weak match (score &lt; 45%) | `weak` | Yellow (`processing` / warn) | **No** — optional reroll |

Implementation sources:

- Classification: `editPlanCoverage.ts` (`analyzeEditPlanCoverage`, `COVERAGE_WEAK_SCORE_THRESHOLD = 0.45`)
- Pipeline: `studioPipeline.ts` — `generateReady = matchReady && gapSlotCount === 0` where `gapSlotCount` is `trueGapCount` only
- Approved generated assets that cover a missing primary reduce `trueGapCount` to zero (`tests/unit/studioPipeline.test.ts`)

## Rationale

Users need to watch an incomplete whole-song cut to judge ordering and missing footage. Requiring every shot before review prevents that iterative workflow. Song time must not compress across holes, and incomplete review must not imply a finished export. Short-source and weak-match notices remain distinct from unresolved song windows.

## Consequences

- Generate stage copy and metrics must label optional reviews explicitly (“optional”, not “gap”).
- Whole-shot replacement (`wholeShotReplacement.ts`) is the guided path for purple slots; it must be visible in Generate UI (issue #61).
- Join offers whole-song and section playback, reviewed swaps, existing-footage replacement, and undo. Match, Generate, Join, Effects, and Export use the same saved placement list.
- Swaps preserve song windows and show trims or residual gaps before applying. They cannot turn an unsupported action into a valid story match. Changes invalidate prepared previews and exports.

## Alternatives considered

- **Block Join on weak matches** — rejected; forces unnecessary Generate work when footage is usable.
- **Block Join on short source** — rejected; trim/glue policies may suffice; replacement is opt-in.
- **Treat all coverage issues as “gaps”** — rejected; conflates blocking holes with quality review.
