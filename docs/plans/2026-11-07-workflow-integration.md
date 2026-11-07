# Workflow and save integration verification

Verified November 7, 2026 UTC (November 6 local time) in the new isolated
`workflow-integration` worktree, branch `codex/workflow-integration`.

## Committed inputs and topology

- Requested clean starting base: `73833556ad96d808976056798112c5b2d588ade3`.
- Reviewed Draft/Finish UI source: `1b00df56008e2eb1a400dbf570b391211412e289`
  (`2057895` -> `e61f846` -> `1b00df5`), merged by
  `6fe701e212cd32cc6415e3aa56a5f4b1935ed4ce`.
- Reviewed durable-save source: `e48fab5cb64db8cb5d43fc34df6dd61d0f449ee4`,
  parent `ef1557b4feac7377a555a57399112c84a73bbaea`, merged by
  `c6e637868ecdae6952bcb94d85c2dacbfc774b7d`.
- Source branches share ancestor `b8b90a831185cbf9e02320376c089051fa3da99d`;
  the UI branch descends from the requested integration base. Both exact source
  tips are ancestors of the resulting integration branch.

Both merges used Git's normal `ort` strategy and completed without conflicts.
No source-code resolution or additional code changes were necessary. The shared
StudioApp diff retains the versioned save session and stale-context checks,
passes the selected generated draft into readiness, and uses pending selected
takes for the Draft spine. Pending review remains separate from approved export
coverage. The save source's prepared-snapshot guard remains intact.

Only committed source work was included. Existing worktrees, the active
uncommitted source-version work, film project, GPU jobs, and production were not
changed. No push, deployment, PR, or worktree cleanup was performed.

## Combined verification

Dependencies were installed locally using `bun install --frozen-lockfile`.
Git Bash was placed first on PATH for the repository's process-isolating test
runner. Checks ran against merged code commit
`c6e637868ecdae6952bcb94d85c2dacbfc774b7d`:

- `bun run test projectSaveRecovery projectSaveSession studioProjectConcurrency studioJsonTransportRoute projectPersistence studioProjectStore resolvedDraftCoverage studioPipeline generatedFirstWorkflow spineSlots projectExportValidation`:
  **140 passed across 11 files, zero failures**.
- `bun run typecheck`: passed.
- `bun run check`: passed; **1,246 passed, 23 skipped, zero failures**.
  ESLint retained five existing warnings, with zero errors.
- `bun run build`: passed, including all 33 static pages. Node emitted
  `module.register()` deprecation and unavailable-localStorage warnings.
- `git diff --check 7383355..HEAD`: passed. Worktree was clean before this
  documentation-only evidence addition.

Exact local logs are retained in `.tmp/workflow-integration/` (ignored by Git):

| Log | SHA-256 |
| --- | --- |
| `focused.log` | `8064D5DD0E9C110DA1BC011A9A8B7CB35E2DAC2DF2188E93AC9D9DB577945329` |
| `check.log` | `D9137B3C01831D90FCD7AF58E0C79C9E4C33B70447D4895B2271BDBD46702D6E` |
| `build.log` | `EE8243B4D876266EF85AD31A67AE970084D29FD1975D4EA2B8736F78981FA55D` |

## Remaining acceptance

The 23 skips concern unavailable media/environment fixtures, including offline
Trigger bundles. These local checks establish combined code behavior only.
Still required: review of this integration branch, a production deployment
coordinated with the active film execution owner, and authenticated two-editor testing on a separate technical
fixture that proves a stale editor cannot erase a winning save. Reload and
durable-storage checks must use the actual deployed route.

Draft/Finish acceptance still requires browser verification of pending spine
labels and exact review gating. Physical file interactions, public-app H3
generation, candidate identity/action/continuity review, full-song playback,
approval, durable export, and watched downloaded output remain distinct gates.
The separate film execution chat owns live film writes and GPU submissions.

## Prepared-save caller correction

Integration review identified one remaining P2 wiring defect: the session's
prepared-snapshot callback existed, but Studio's production callers did not
supply it. The exact generated-review fingerprint does not include every saved
project setting. Changing clip audio or shader accents during an approval ACK
could therefore leave newer local settings unsaved while reporting the prepared
snapshot as saved. This was not evidence of permanent in-memory erasure; the
durable compare-and-swap protection remained correct.

Code commit `27a211ec5ac03e838bf8a4a62bebbf560077894f`, based on
`32cd1d54b704caa59b5d28936572a1e2f7f8630c`, corrects the caller boundary in
the isolated `prepared-save-guard` worktree (`codex/prepared-save-guard`):

- Every explicit Studio prepared save (approval, export recovery, generation
  prerequisite, project library, and their reconciliation saves) captures the
  complete live source project, ID, and name at the save boundary. The guard
  compares that source before writing and after the ACK, separately from the
  deliberately derived approval/export payload. Save timestamps alone are ignored.
- Concurrent local edits reject the success continuation and preserve the local
  changes. A completed prepared write with a changed source holds subsequent
  writes for explicit reconciliation. Ordinary autosave retains its existing
  pending-dirty behavior and serialized revision advancement.
- Regression tests exercise the production-used boundary, real save session, and
  real named-project HTTP transport against delayed synthetic ACKs. Clip-audio
  and shader-accent edits prevent success/approval continuation and further
  writes. Additional cases cover unchanged derived snapshots and a source
  superseded before its queued write. No static source-string assertion is used.

Checks against that code commit:

- Affected save tests: **17 passed**, zero failures.
- Typecheck and focused ESLint: passed; two existing Studio warnings, zero errors.
- `bun run check`: **1,250 passed, 23 skipped**, zero failures; five existing lint
  warnings, zero errors.
- `bun run build`: passed, including all 33 static pages. The existing Node
  deprecation and unavailable-localStorage warnings remain.
- `git diff --check`: passed.

Local evidence under `.tmp/prepared-save-guard/` (ignored by Git):

| Log | SHA-256 |
| --- | --- |
| `check.log` | `E2AD9D5C252BC067D8624F324F0FF49DA43772E6B2DC2BE73CAA8E844786C424` |
| `build.log` | `EC33180880CA481E405056B3B803138684E4E6423A601EA4133ABF5681100C95` |

No push, PR, deployment, film write, GPU submission, or existing-worktree change
was performed. The deployed two-editor and creative/media acceptance gates above
remain outstanding.
