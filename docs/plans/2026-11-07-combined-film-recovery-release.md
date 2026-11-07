# Combined workflow and source-confirmation release

Prepared November 7, 2026 UTC in the film execution worktree. This records
application verification; it does not establish a finished film or a deployment.

## Combined implementation

- Workflow/save integration: `f43eedd`, including prepared-save correction
  `27a211e` and durable project CAS `ef1557b` / `e48fab5`.
- Stable generation scope and conditional media/reference checks: `9343231`.
- The confirmation caller captures the editor epoch before draining autosave,
  checks that the same editor remains open, and saves through the prepared-save
  boundary with the server's exact expected revision. It installs the acknowledged
  draft through project restoration, clearing pending autosaves and advancing the
  editor epoch. Existing review consent is reset; confirmation does not approve
  any take or authorize export.
- Both source branches merged through Git's normal strategy. The test-isolation
  list retains the CAS and source-scope suites.

## Local verification

- `bun run check`: **1,320 passed, 22 skipped, zero failures**; five existing
  lint warnings, zero lint errors. Type checking passed.
- `bun run build`: passed, including the source-confirmation route.
- Independent confirmation-caller review: no blocker; **20 focused tests,
  60 assertions** passed through the prepared-save/session/client boundaries.
- Independent scope review: **136 focused tests, 622 assertions** passed,
  including conditional version failures, changed hashes, ownership/bounds,
  baseline enrollment, export checks and receipt validation.
- `git diff --check`: passed. `graft build`: refreshed 533 indexed files.
- Exact local logs: `.tmp/release21/integration-20261107T0440-check.log` and
  `.tmp/release21/integration-20261107T0440-build.log`.

## Live reference authority gate

Owned conditional reads and full hashes verified all 22 source/master objects
(510,437,769 bytes) against their historical certificate. Reference images are
verified separately. The original Diego object no longer accepts its historical
ETag: the actual conditional read returns 412. A diagnostic read pinned to the
current ETag found PNG `e71f4d43…`, 1448×1086, rather than approved PNG
`47d77269…`, 1402×1122. FFmpeg RGB24 and RGBA comparisons confirm different
decoded pixels. This is not an equivalent re-encoding. Valentina and the world
sheet still match their historical conditional bytes.

The application correctly refuses source reuse. No replacement, restoration,
re-enrollment, project save, consent, or film generation was performed to bypass
that refusal. Both sheets were shown to the user; the authority choice remains
pending. Existing takes, rejected outputs and saved cuts are preserved.

## Remaining acceptance

Deploy the combined reviewed source through the existing application release
owner, verify the actual worker digest/tasks and web source, then exercise a
two-editor conflict and durable reload on an isolated technical project. These
checks can proceed independently of the reference choice. Film reconciliation,
remaining footage, genuine zero-footage completion, full-song playback, fresh
exact-draft user consent and final export/download remain open.
