# Issue tracker: Linear

Robert explicitly selected Linear for the current completion effort on November 6, 2026. This supersedes the older GitHub tracker configuration. Historical GitHub issues remain reference material; do not create parallel implementation tickets there.

- Project: [SBS Studio — Project Stack Structure](https://linear.app/v1su4/project/sbs-studio-project-stack-structure-bb6dcb48537a), `P-V1S-11`.
- Team: V1su4, key `V1S`.
- Current spec: [Finish Love Me Tonight and verify the complete music-video workflow](https://linear.app/v1su4/issue/V1S-436).
- First execution ticket: [Resume Love Me Tonight with current references and closing takes](https://linear.app/v1su4/issue/V1S-437).

## Operations

Prefer the connected Linear tools. Use `get_issue` for the full body and relations, `list_issues` scoped to this project for discovery, and `save_issue` to create or update. Read back writes before reporting success.

- Spec: one parent issue containing the outcome, accepted scope, decisions and observable acceptance.
- Ticket: one independently verifiable end-to-end slice. Set `parentId` to the spec.
- Blocking: use native `blockedBy` / `blocks`, never a parallel text-only dependency graph. Create all tickets before wiring references when needed, then verify relations.
- Ready work: label `ready-for-agent`, status `Todo`. Claim with the current driving developer and move to `In Progress` before execution. Existing current-film work already has one owner.
- Completion: set `Done` only when the ticket's actual acceptance evidence exists. Successful checks/builds do not stand in for browser, generated-media, creative, download or playback evidence.
- Superseded work: set `Canceled` and link its replacement; retain history. Remove it from the active project when requested. Never label obsolete work Done merely to clean a backlog.
- Comments and attachments: use them for authorized ticket evidence and decision records; do not message unrelated people.

Use the canonical triage vocabulary in `triage-labels.md` for raw incoming issues. Verify a label exists before applying it. Tickets produced by `to-tickets` are already agent-ready and do not need triage again.

## Frontier and execution gates

The implementation frontier is the current spec's open `Todo` children whose native blockers are complete and which have no active owner. An `In Progress` assignee is a claim; skip it when another session owns it.

A deliberately deferred `Backlog` ticket is not ready to dispatch. The zero-footage acceptance fixture has an explicit scheduling gate: prepare if useful, but finish the existing film before starting its separate live generation. Do not invent a technical dependency to represent that priority.

For the review-performance batch V1S-458 through V1S-464, Robert explicitly directed sequential execution on November 11, 2026: finish V1S-458, verify its actual acceptance, record evidence and close it before proceeding to V1S-459, then continue numerically through V1S-464. Keep only the current issue In Progress. Preserve existing partial work on later issues, but do not expand it before its turn. Do not dispatch parallel implementation for this batch without a new explicit instruction. Scale verification to demonstrated risks; do not repeat passing checks without changes or new evidence.

Robert's follow-up permits bounded back-and-forth where two tickets genuinely depend on each other. Record the primary, related issue, reason and stopping condition before crossing scope; retain one active primary rather than reopening the batch. Use `docs/plans/2026-11-11-review-execution.json` and `.agents/skills/ticket-execution/SKILL.md`; refresh the seven issue records and run its checker before advancing. Reuse the existing worktree/branch, finish the already-active 458 in its current context, then use a fresh scoped implementation context per ticket with one writer. Do not create eight worktrees. Record acceptance evidence, commit and read-back of Done before starting the next ticket; preserve public release as a separate final gate.

Maintain one current-film project writer and GPU submission controller. Re-read current project/reference versions before writes or generation; reconcile ambiguous submissions rather than duplicating them.

## No PRs

Robert explicitly instructed: commit verified slices as work proceeds. For V1S-458–464, prepare one combined PR and invoke GrepTile only after the complete batch is verified and ready; the end-of-batch PR is authorized, early PRs/reviews are not. Linear closes through issue state and evidence, not PR merge. This overrides any conditional draft-PR advice in an implementation skill. Preserve unrelated edits and existing worktrees.

## Wayfinding operations

If genuinely unresolved multi-session decisions later require Wayfinder, its map is a separate parent with `wayfinder:map`; decision children use `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` or `wayfinder:task` only. Use native parent and blocking relationships. Do not turn the implementation spec into a decision map or add triage labels to Wayfinder decisions. The current effort already has an agreed destination and uses the implementation task graph above.
