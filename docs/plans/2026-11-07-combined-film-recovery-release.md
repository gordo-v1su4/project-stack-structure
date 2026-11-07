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

## Initial rollout and browser findings

Combined source `1f42fb94ba5bb2b1f41c39099614df662b213aeb` was deployed:

- Active worker `20261107.3`, deployment `7611ms84`, immutable digest
  `sha256:3669a58732e12b5355257ca0ab4be38fcd371ad1fe4efaf14ee119716ca84ce7`.
  Source/runtime inspection passed (40 bundle files, 41 syntax checks), and
  authenticated inventory verified all 17 actual task IDs.
- Web deployment `dpl_21uRvd9RAn2JaCySyEw4q763qXBK` reached READY on the
  production alias. The remote `reviewedCommit` metadata matches that source.
- Real signed-in editors used only new empty technical project
  `06d9a6ca-1b1b-432a-860b-7212acb3d577`. One editor saved its WINNER name;
  the other displayed an explicit conflict and held its attempted local name.
  Separate owned GETs confirmed the same winning revision and draft hash after
  the rejected attempt.
- All three protected projects retained identical saved/draft hashes and
  revisions across the bounded fixture test. This observation does not establish
  that earlier browser restoration caused no metadata writes before its baseline.

The test also exposed an unnecessary autosave after restoration. The existing
dirty-label flag also serves manual saves and navigation, so suppressing writes
with that shared flag would lose real edits. The correction uses a separate flag
armed only by actual project restoration, before enqueueing its mirror snapshot.
Manual-save/navigation dirty-label behavior remains after enqueue.

The UI correction passed independent review, 41 affected tests, type checking,
focused lint (two existing warnings), a production build, and diff checks. It
changes only `StudioApp.tsx`; the deployed worker runtime remains unchanged.
Controlled user-edit conflict and restored-project no-write checks must be
repeated against the corrected web deployment before declaring that acceptance.
Exact local proof files are under the `1f42fb9` release evidence directory in
`.tmp/release21/`, including both protected-state observations and the conflict
screenshot. These technical results provide no creative approval or export.

## Corrected rollout and save acceptance

UI source `eee54d56c492dee1be70429870f18e0e5bf298b0` reached READY as
`dpl_HkEoBxubFujMSQeCSQQJYLyeadC4` on the production alias, with exact remote
`reviewedCommit` metadata. Its only code difference from worker source `1f42fb9`
is the restore-only guard in `StudioApp.tsx`; the verified worker remains `.3`.

The controlled signed-in browser repeat passed on the same isolated technical
project. Both editors restored WINNER with no durable version/hash change.
Editor A then saved WINNER 2, changed clip audio to On after that manual save,
and used the normal stage checkpoint. Editor B's deliberate STALE USER EDIT was
held with an explicit conflict; its local attempted name remained visible.
Reload restored WINNER 2 and clip audio On. Separate actual owned GETs observed
the identical winning revision and draft hash after the stale attempt and after
reload. No network acknowledgment was mocked or intercepted.

All three protected projects retained identical saved/draft hashes and revisions
from the recorded pre-fixture baseline through final cleanup. The technical
project remains clearly labeled in the library; both technical tabs were closed.

Local acceptance proof:
`.tmp/release21/evidence-eee54d56c492dee1be70429870f18e0e5bf298b0-20261107T045500Z-restore-ui/browser-cas-acceptance.json`.
The same directory holds exact readbacks and both browser screenshots. This closes
the deployed project-save conflict/restoration check only. Source-confirmation
application remains blocked on the user's reference-authority choice. Film
revision 31, 28 selected takes and 66 bank assets remain saved; genuine zero-footage
completion, full-song review/consent and final export/download remain open.
