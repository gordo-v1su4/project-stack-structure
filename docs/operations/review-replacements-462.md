# V1S-462 replacement review

Implementation chat: `01a1cec2-da14-7562-b9fe-364d6d53cde3`; sole writer on
`codex/animatic-motion-source-validation` in the existing D: worktree.

The inherited exact-shot inventory and separate durable review-mark artifact
remain intact. `fbf6266` adds explicit replacement preparation and a separate
generation consent dialog in Draft. Preparation refreshes marks without saving
the film or calling a model. Every mark must match both the fresh saved targets
and exactly one displayed base shot. Stale marks fail the entire preparation;
they are never silently dropped or rebound.

Submission refreshes marks again, verifies the prepared request fingerprint,
saves through the existing project gate, checks active jobs and queues through
the existing authenticated H3 path. Every request keeps its complete target,
current direction, reference packet, reviewed image and review binding. Notes
remain review metadata; changing motion direction requires Story revision.
Replacement results omit the draft-selection revision, so they bank without
selecting or approving footage. Prior takes and marks stay intact. The existing
identity gate can pause a batch after delivery. A reloaded replacement queue is
paused; continuation rechecks current marks and bindings before each request.

`d248a61` makes saved-take inspection silent and explains matching fit versus
render quality beside Source suggestions. Hover behavior and the master's
seek/play barrier are unchanged.

Development checks: 30 focused model/store/selection/batch/recovery tests pass;
11 affected take/source/review tests pass after the inspection correction.
Typecheck and affected lint pass; full lint has five pre-existing warnings.
The first publication run was cancelled before deployment to include the audio
correction. Public acceptance and final publication receipt follow below.

## Public acceptance

Published candidate `d248a61cd0866582ce339d759208d555baed9858` through
[run 43180294913](https://github.com/gordo-v1su4/project-stack-structure/actions/runs/43180294913).
Hosted checks: **2,147 pass / 27 fixture skips / 0 fail**, standalone build,
transfer verification, Dockhand activation, exact public/origin revision and
anonymous API denial passed. Independent public `/health` returned that full SHA.
This is accumulated branch code published as a public test build, not main.

Visible signed-in in-app browser, initially 1280×720, later measured 1490×1307
after the app window resized. No viewport, cache or network throttle override
was applied. Native Chrome acceptance is not claimed.

1. **Takes and suggestions:** actual A006 inventory shows one current saved take,
   `Available · pending`, exact 14.75–17.13s. Six section-wide Source suggestions
   appear separately, with visible matching-fit versus render-quality explanation.
2. **Inspect and exact Use:** real Inspect/Play/Close on A006 and A103 delivered
   visible existing video, muted, bounded to the saved edit. A006 paused at native
   2.335074s for its 2.375s window; A103 at 2.728351s for its 2.708333s window
   (native frame/timeupdate boundary). Pending identity correctly disables Use
   with “Identity could not be verified.” Clicking a section source opens its
   specific 5.96–15.04s viewing window while A006 remains selected. No source
   adoption control is exposed. Successful exact-target Use and stale/revision
   rejection are covered by the four model regressions; no protected-film take
   was selected merely to test an enabled adoption gesture.
3. **Multiple marks and explicit submission:** real Ctrl selection marked A006
   and A007; the current list contained exact 14.75–17.13s / 17.13–19.67s rows.
   A note was saved on A006. Real page reload and lazy mark fetch recovered both
   rows and that note. Draft's Prepare opened a modal listing both destinations.
   Submit was disabled initially, enabled while the explicit generation checkbox
   was checked, and disabled again when unchecked. Cancel closed the modal.
   Submission was never clicked. Model/queue tests verify bank-only requests,
   retained targets and safe reload metadata; this is not a live-generation claim.
4. **Stale reconciliation:** a temporary browser-only GET response removed A006
   from fresh saved targets while leaving real durable marks/project data alone.
   Actual Prepare rejected the whole batch with “Marked shots changed. Refresh
   marks and clear stale marks before preparing replacements.” The override was
   restored in `finally`. Actual unmark of both selected shots returned the real
   durable list to zero, removing the QA note as well.
5. **Review context and cleanup:** actual scrolling reached inspector media,
   source alternatives and the batch dialog. Pointer entry/movement on unprepared
   take cards requested two CPU viewing derivatives; their queue was still waiting
   during this pass, so prepared-hover startup is not claimed here. Explicit
   saved-take playback worked. No H3/AI/GPU/paid generation or approval was sent.
   The existing prepared-hover implementation was not changed.

The QA editor used a temporary fetch guard against saved-film writes and model
submission. It blocked one view-setting autosave on the transition to Draft;
the resulting “Save failed” badge in that screenshot is the test guard, not a
production save-failure finding. The editor document was discarded by navigating
to read-only Preview. The final document has neither guard nor stale override.
Both protected whole-draft hashes **and revisions** are unchanged:

- Finishing: `aace50749de17e84a18ff49cb455063e715a5c2d2732e509f5ff658358a8f6cc`.
- Original: `db8869edc20b187c6c31bf2df46e8e8bb66fb39433d2447cb4cf1598f79ce20d`.

Final public Preview remains 0/108 selected windows, 103 current available takes,
with zero replacement marks. Private receipts/screenshots are ignored under
`.tmp/review-performance/462-*`; no payload, cookie, secret or media is committed.
Two pending CPU viewing-copy requests are an honest runtime observation for the
backend-latency review in V1S-464; no new GPU job or worker tuning is authorized.

No PR/GrepTile, worker release, configuration/credential change, model call or
creative approval is part of this ticket's verification.
