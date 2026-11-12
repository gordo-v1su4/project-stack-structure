---
name: ticket-execution
description: Turn agreed multi-ticket plans into visible, bounded execution and keep the tracker current. Use when planning settles, publishing tickets, starting a batch, or reconciling progress and completion. Reuse existing tracker choices and authorization.
---

# Ticket execution

Apply at planning-to-tickets, ticket-to-implementation and completion boundaries. Small standalone fixes do not need a batch plan.

## Make the transition visible

- When outcome, scope and acceptance settle, say so. Proactively propose publishing tickets in the configured tracker; do not wait for a slash command.
- Read repo tracker configuration. Reuse settled Linear/GitHub/project choices. If missing, ask once which tracker/project to use; never create duplicate backlogs.
- If already authorized to publish or implement, proceed without asking again. For planning-only conversations, present the concrete breakdown and ask whether to publish/start. Agreement with a design alone is not implementation authorization.
- Before starting, announce tracker, count, first ticket, execution mode, verification boundary and PR/release timing. Say "ready to start" when authorization is missing, or "starting ISSUE" when already authorized.

## Bound the batch

- Default to one primary ticket at a time on the existing worktree/branch. A fresh context does not require a new worktree.
- Separate technical blockers from scheduling priority. Check that an earlier ticket's acceptance does not require a later ticket's unbuilt feature. Assign each final check to a ticket; reconcile prerequisites/acceptance in the tracker rather than silently deferring them.
- Each ticket needs a bounded user-visible outcome, non-goals, criterion-specific verification and closure condition.
- Necessary coupled work is allowed: record primary ticket, related ticket, why crossing the boundary is needed and when to stop. Keep one primary In Progress. Coupling is not permission to open the batch.
- Parallel work is an explicit alternative: declare a small concurrency limit, independent scopes, separate contexts and nonconflicting writers/workspaces. Never run concurrent writers in the same worktree.
- Keep the coordinator compact. Use a fresh implementation context per ticket: a scoped subagent when authorized, or a new chat when the user requests one. Pass ticket/spec pointers, commit, necessary decisions and verification only. Wait for one writer to exit before starting another in the existing worktree. An already-active ticket may finish in its current context; the next starts fresh. Do not accumulate every ticket's implementation history in the coordinator.

## Finish before advancing

1. Read live ticket, blockers, comments and ownership. State its title; claim it and read back the tracker change before implementation. Preserve other owners and existing partial later-ticket edits.
2. Identify the observable failure/requirement and relevant check; implement the bounded change. Use affected tests/type checks during development and required broader checks at completion/integration. Rerun green checks only for new changes, failures or evidence.
3. Verify every criterion at its actual boundary. Browser/media behavior needs browser/media evidence. Map each criterion to evidence and commit; a full-suite count cannot replace missing interaction proof. Distinguish candidate verification from public release acceptance explicitly.
4. Update the tracker as work happens. Record the conclusion, set Done and read it back before claiming the next item. A combined final PR does not delay individual ticket closure.
5. If blocked, record the failed boundary, next action and owner in the tracker and tell the user. Preserve obtained evidence; do not rerun unrelated checks or silently switch tickets. Never auto-close or weaken thresholds.
6. Report "ISSUE complete; evidence ...; next ISSUE" or "ISSUE blocked by ...; next action ...".

## Boundary checker

Run `bun <this-skill>/scripts/check.mjs <plan.json> <snapshot.json>` after publication, before advancing and before final completion. Refresh selected tickets through the connected tracker first. Snapshot: `{ "fetchedAt": "ISO timestamp", "issues": [full selected tracker issues] }`, including title, description, status and native relations; include external blockers too. Plan shape: [example-plan.json](example-plan.json). Store each Done criterion's evidence under its exact checklist text.

The read-only checker flags stale/incomplete snapshots, excess active tickets, wrong order, unmet blockers, missing acceptance, reused contexts and Done records lacking criterion evidence/commit/tracker receipt. Never alter exported tracker states to obtain a pass.

This is a boundary command, not an installed event hook or background monitor. It validates supplied records, not screenshot truth, spoken announcements or unobserved tracker writes. Use actual readiness text, user authorization and read-back receipts. Report unavailable tracker/tools honestly.
