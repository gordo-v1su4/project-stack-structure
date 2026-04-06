# Spec Workflow Protocol

## Purpose
This protocol defines how ideas become implementation-ready work without reopening ambiguity.

## Core Rule
No implementation should start until the work has:
- explicit intent,
- explicit non-goals,
- explicit acceptance criteria,
- explicit verification steps,
- an explicit performance/correctness constraint when media behavior is involved.

## Canonical Flow

### 1. Deep interview
Use deep interview when the request is broad, cross-cutting, or easy to misinterpret.

Expected output:
- context snapshot in `.omx/context/`
- interview summary in `.omx/interviews/`
- execution-ready spec in `.omx/specs/`

For this project, deep interview clarified:
- musical alignment is the top priority,
- motion continuity is the default visual mode,
- post-cut segment analysis is the correct unit,
- accuracy matters more than a quick scan,
- web-first is acceptable but reversible.

### 2. Ralplan / consensus planning
Use `$ralplan` once ambiguity is low enough that architectural and test planning can proceed.

Expected output:
- PRD in `.omx/plans/prd-*.md`
- test spec in `.omx/plans/test-spec-*.md`

A valid PRD/test-spec pair must include:
- requirements summary,
- acceptance criteria,
- roadmap or implementation phases,
- risks and mitigations,
- verification plan,
- architectural decision record (ADR) for consensus planning.

### 3. Execution gate
Execution modes such as `$ralph` or `$team` should start only after the PRD and test spec exist.

Execution must preserve:
- ranking precedence,
- segmentation rules,
- fit fallback behavior,
- platform decision constraints,
- verification expectations.

### 4. Verification gate
Media-affecting execution must prove:
- no silent drift between preview and musical accents,
- no overlap between stale work and current playback,
- no regression in ranking precedence,
- no unsupported media path being silently treated as valid.

## Required Sections for Future Feature Specs
Every future feature spec for this app should include:
1. **Problem / intent**
2. **User outcome**
3. **In scope**
4. **Non-goals**
5. **Touchpoints**
6. **Data contracts**
7. **UI states**
8. **Performance / correctness constraints**
9. **Acceptance criteria**
10. **Verification plan**

## Artifact Map
```text
.omx/context/
.omx/interviews/
.omx/specs/
.omx/plans/
docs/
```

Recommended durable docs:
```text
docs/roadmap.md
docs/architecture/media-pipeline.md
docs/protocols/spec-workflow.md
docs/protocols/latency-budget.md
```

## Roles and Responsibilities
### Deep interview
- clarifies intent
- makes non-goals explicit
- closes requirement ambiguity

### Ralplan
- chooses and stress-tests architecture
- writes PRD and test spec
- makes the plan execution-safe

### Ralph / Team
- execute against approved artifacts
- gather fresh verification evidence
- do not reopen settled planning decisions unless new evidence forces it

## Change Management Rule
If a later idea changes only one branch of work, update the relevant artifact rather than restarting the whole process.

Examples:
- a new continuity mode updates the PRD/test spec and relevant docs,
- a new hardware test lane updates the latency budget doc,
- a change to musicality precedence is treated as a major product decision and must update every downstream artifact.

## Anti-Slop Rule
Do not let new work enter the repo as loose notes or one-off plans.

Every substantial change should map back to:
- a source spec,
- a PRD,
- a test spec,
- and explicit verification evidence.

## Completion Rule
A planning-to-execution handoff is complete only when:
- the planning artifacts exist,
- acceptance criteria are testable,
- downstream implementation knows what proof is required.
