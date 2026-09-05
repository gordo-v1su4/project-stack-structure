# Spec Workflow Protocol

## When this applies

Use this protocol for substantial product changes, architecture decisions, or requests with unresolved requirements. Small fixes, documentation edits, and implementation already covered by a spec can proceed from the user's request and relevant code. They do not require an interview, new planning documents, or an approval checkpoint.

Historical plans describe the decisions for their own work. They do not automatically expand a new task or require its author to repeat that process.

## Establish the outcome

For substantial work, capture intent, scope, non-goals, observable acceptance criteria, and verification in an existing relevant document under `docs/plans/`. Create a new spec when the work needs its own durable record. Include performance and correctness constraints when media behavior changes.

Ask focused questions only when unresolved choices materially change the outcome. Make reasonable implementation decisions from existing requirements and continue independent work while a necessary answer is pending. Use a deeper interview when the request actually needs one.

Planning-only requests finish with an actionable plan. Implementation requests continue through implementation and verification unless the user explicitly requested an intermediate review or an action exceeds the authorized scope.

## Plan to fit the change

Use these sections where relevant; omit sections that add no useful information:

- Problem, user outcome, scope, and non-goals
- Touchpoints and data contracts
- UI states and performance/correctness constraints
- Acceptance criteria and verification plan
- For architecture decisions: alternatives, tradeoffs, risks, and the chosen approach

A separate PRD, test spec, and ADR are useful for complex work; they are not prerequisites for every change. Older project artifacts refer to `$ralplan`, `$ralph`, and `$team`. These are historical tool-specific workflows, not required dependencies. Use available tools to achieve the outcome without blocking on an unavailable skill.

## Execute and verify

Preserve the applicable product contracts: musical fit takes priority over motion continuity, post-cut segments remain the analysis unit, segmentation and fit fallbacks remain explicit, and playback uses prepared previews. Retain existing platform decision constraints. For affected media paths, verify that:

- previews stay aligned with musical accents;
- stale work cannot replace or overlap current playback;
- ranking precedence remains correct;
- unsupported media paths fail explicitly.

Choose checks based on changed behavior using [tests/README.md](../../tests/README.md). A UI change may need browser interaction; a pipeline change may need real media output. Local tests alone do not establish production sign-in or service health. Keep the pre-PR check required by [AGENTS.md](../../AGENTS.md).

Complete authorized implementation, inspect relevant results, and fix regressions caused by the change. Once the acceptance criteria and required checks are satisfied, report the outcome and any remaining limitations. If blocked, identify the missing input or failed dependency and what remains unverified.

## Durable records and changes of scope

Keep canonical plans in `docs/plans/` and durable architecture, protocols, and runbooks in `docs/`. Tool-local planning caches are not the source of truth.

Update the affected artifact when a later idea changes one part of the work; do not restart settled planning without new evidence. A change to musicality precedence is a major product decision: reconcile the affected spec, tests, and downstream contracts before calling that change complete.

A planning handoff is complete when the intended outcome and boundaries are clear, acceptance criteria are testable, and the implementation has a usable verification plan.
