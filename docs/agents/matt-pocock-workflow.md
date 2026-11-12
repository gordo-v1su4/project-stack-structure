# Current Matt Pocock workflow

Verified November 6, 2026 against upstream `mattpocock/skills` main at `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` (commit dated October 31). The installed file audit is `.agents/matt-pocock-source.json`; the relevant skills are kept upstream-exact. Repository adapters and Robert's explicit instructions carry local choices rather than altering the skills.

## Route selected through Ask Matt

`ask-matt` → focused `grill-with-docs` (`grilling` + `domain-modeling`) → existing accepted scope synthesized with `to-spec` → `to-tickets` → `implement-spec` across the ready task graph. Implementers use meaningful agreed behavior seams and `tdd` where appropriate; the integration work receives `code-review` against the spec and standards.

Wayfinder is for an effort whose unresolved decisions cannot be held in one session. Its default destination is decisions, not deliverables. This project already has an accepted film/workflow outcome, architecture and real implementation; restarting a decision map would not advance the current completion work.

## Standing user direction

- Follow the first recommended answer for routine unresolved workflow choices; do not wait for another interview round. Mark these as delegated recommendations, never pretend a live human answered.
- Preserve the approved story, identities, reference roles and original project. Do not reopen settled scope without new evidence.
- Actual creative review and final cut consent remain real acceptance gates; delegated routine decisions do not manufacture approval.
- Use Linear as configured in `issue-tracker.md`, with native parent/blocking relationships.
- Commits are allowed. For the review-performance batch V1S-458–464, Robert authorized one combined PR/GrepTile review at the end, after all seven issues are verified. Do not open an early PR or invoke GrepTile during implementation.
- Finish the existing Love Me Tonight film first. Preparation for separate zero-footage acceptance may proceed, but its live GPU run waits for that priority to be satisfied.
- One owner controls the current film's project writes and GPU submissions. For V1S-458–464, work sequentially in numerical order with one issue In Progress: diagnose, implement, verify actual acceptance, record evidence, commit and close, then move to the next issue. Preserve previously started later work without expanding it before its turn. Robert explicitly rejected parallel implementation for this batch on November 11, 2026.

## Domain documentation

Use the existing `CONTEXT.md` and accepted ADRs according to `domain.md`. Do not create a competing glossary just because upstream examples call theirs `GLOSSARY.md`. No new hard-to-reverse architecture choice was made by this reconciliation, so no extra ADR is needed.

## Current entry point

The current review-performance batch is V1S-458–464 under V1S-442, beginning with [Measure and repair populated-film navigation and review latency](https://linear.app/v1su4/issue/V1S-458). The earlier [film completion spec](https://linear.app/v1su4/issue/V1S-436) and [reconciliation record](../plans/2026-11-06-current-completion-map.md) remain historical context; they do not override the current batch order or its end-of-batch PR instruction.

The repository-local skills are available for subsequent sessions in this completion worktree. Read `ask-matt/SKILL.md` for routing, not an invented generic sequence.
