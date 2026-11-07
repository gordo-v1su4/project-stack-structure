# H3 per-shot crowd reference selection verification

Tested code: `96517f324a6d61b4bf8a0dc0eb43542b885c2db3` on
`codex/crowd-reference-selection`, based on
`f43eedd5ff4449caf9e32cc92efa080bbda280e8`.

## Behavior and boundaries

- A new advanced pickup defaults to no crowd sheets. Optional checkboxes select
  only the sheets needed for that shot; the total packet is limited to nine
  references including named characters and location. Missing, unnamed, or
  incompletely uploaded selected crowd references block dispatch rather than
  disappearing from the packet.
- An exact reference-mode pickup restored from job history displays its prior
  ordered crowd subset. The production-used pickup request builder retains the
  frozen ordered packet and intent for an unchanged retry. A deliberately changed
  or empty packet starts a fresh intent at attempt zero.
- Candidate revisions retain the original crowd subset while named character and
  environment selection continue to follow shot direction. Retry/recovery keeps
  the saved request. New batch windows receive no crowd sheets; there is no global
  crowd setting. An existing window's deliberate revision retains its subset.
- Crowd declarations guide background extras variety and wardrobe range only.
  Named identity/wardrobe and environment authorities retain their roles. Ordered
  Ref2VA sockets and native encoder grammar remain unchanged.
- First-frame mode disables the crowd picker and omits its reference-mode crowd
  choices. I2VA visually conditions only on its frozen PNG; named reference
  authorities remain available for the existing similarity screening contract.
- No server/runner scope, source/reference version work, film-owner project,
  production deployment, or shared infrastructure was changed.

## Verification

- Focused tests: 31 passed, zero failed across `h3DraftPlan.test.ts`,
  `h3Generation.test.ts`, and `h3FirstFrame.test.ts`. Tests exercise the actual
  pickup request builder and POST transport seam, unchanged and changed packets,
  revision/reload, omitted available sheets, readiness/limit failures, reference
  roles, and ordered conditioning sockets.
- Final `bun run check`: 1,253 passed, 23 skipped, zero failed; typecheck passed.
  ESLint reported zero errors and five existing warnings: two in `StudioApp.tsx`,
  one in `media-viewer.tsx`, one in `scene-detection.ts`, and one in
  `storyTreatmentServer.test.ts`. Changed-file lint reported no warnings.
- Final `bun run build`: passed at the tested code SHA.
- The actual emitted native H3 prompt with one selected crowd sheet passed the
  dynamic compiler's `lint_prompt.py --format h3 --fps 24 --duration
  5.166666666666667 --strict`: 124 frames, one shot, zero errors or warnings.
  The check used `uv run --no-project --python 3.12 python`; no renderer ran.
- `git diff --check` passed. Graft was refreshed: 3,696 nodes and 10,190 edges.

These checks are synthetic/local verification, not browser or creative acceptance.
No browser interaction, live GPU generation, saved-project write, rendered video
review, upload, push, PR, or deployment was performed. The 23 skipped tests do not
establish media integration acceptance. Keep this branch isolated for coordinated
integration with the film owner's release.

## Isolated integration with film source-version guards

Verified November 7, 2026 UTC in the same isolated crowd worktree. Starting
branch `codex/crowd-reference-selection` was clean at
`2e48afe122dc51623b4cc27ba40deaf43c12ce15`. The immutable film release
`1f42fb94ba5bb2b1f41c39099614df662b213aeb` and the crowd branch shared merge
base `f43eedd5ff4449caf9e32cc92efa080bbda280e8`.

Git's normal `ort` merge completed without conflicts at
`846f00cbb0a269791789f40c3586e04289457a1a`. Its first parent is
`2e48afe122dc51623b4cc27ba40deaf43c12ce15`; its second parent is
`1f42fb94ba5bb2b1f41c39099614df662b213aeb`. Both parent ancestry checks passed.
No manual code changes were needed. This combines the optional per-shot crowd
packet and frozen retry/new-intent behavior with the film release's raw-media
and source-version approval, dispatch and export guards.

Checks run against the exact merge commit:

- `bun run test h3 generationScope sourceConfirmation finalExportRecovery
  projectSaveRecovery projectExportValidation studioSourceContext`: 319 passed,
  zero failed, 1,907 assertions. The normal isolated test runner was used with
  Git Bash on PATH.
- `bun run check`: 1,322 passed, 23 skipped, zero failed, 5,879 assertions;
  typecheck passed. ESLint reported zero errors and the same five existing
  warnings recorded above.
- `bun run build`: passed, including the source-confirmation route.
- `git diff --check`: passed; the worktree remained clean after checks.
- Local logs: `.tmp/crowd-release-integration/focused.log`, `check.log`, and
  `build.log` in that directory.
- Graft tally for this integration: zero calls and zero refreshes. No code
  context or conflict resolution was needed; the previously refreshed crowd
  graph was retained.

This follow-up changes only this verification document after testing. No tests
were rerun for the documentation-only evidence commit. No other worktree or
branch, saved film data, GPU, service, deployment, push or PR was changed. The
film release owner retains deployment ownership. Browser, creative/render and
live source-authority acceptance remain separate; these synthetic local checks
do not resolve the film reference-authority gate described in the combined
release document.
