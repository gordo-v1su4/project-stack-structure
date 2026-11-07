# V1S-442 workflow guidance verification

Base: `73833556ad96d808976056798112c5b2d588ade3`.

The November 6 live project observation contained 20 sources, 81 scenes, 10
references, 28 selected takes and draft revision 31. These counts describe that
observation, not a permanent project invariant. The separate Love Me Tonight
execution chat retains ownership of film saves and GPU submissions.

## Corrected behavior

- Draft playback included selected pending generated takes, but BeatSpine used
  the approved-only arrangement and labeled those same windows Missing footage.
  Draft now builds spine slots from the full selected draft. Story, Join, Effects
  and Finish retain the approved arrangement. The regression exercises real
  pending-candidate overlay and spine generation, including the generated asset
  binding and preservation of non-Draft gaps. The selected-cut inspector labels
  pending review and reserves Revert for approved shots; pending takes are not
  described as missing footage.
- A pending replacement over already approved coverage unlocked Finish because
  readiness checked missing coverage alone. A current nonempty draft selection
  now requires exact-draft review before Finish, even when approved footage
  already covers the song. Unselected pending candidates do not block Finish.
  Genuine remaining gaps retain their gap guidance. Server export validation and
  draft acceptance are unchanged.

Both regressions failed before their respective fixes. Focused verification:
`bun run test resolvedDraftCoverage studioPipeline generatedFirstWorkflow spineSlots`
passed 31 tests; `bun run typecheck` passed. Targeted ESLint passed with two
pre-existing StudioApp warnings (unused transcript-failure argument and unused
disable directive).

After the inspector follow-up, the full isolated `bun run test` runner passed
1,224 tests with 23 skips and no failures. Skips cover unavailable local media
fixtures and two offline Trigger bundle fixtures; they do not establish live
media or deployment acceptance. Final typecheck passed and targeted ESLint
retained only the same two existing StudioApp warnings. Standards review aligned
the pending-review indicator with the shared `TONE_TEXT.review` token; its
affected inspector tests and lint were rerun after that presentation-only fix.

## Remaining acceptance

This code-level evidence does not prove a deployed authenticated browser pass,
physical drag-and-drop, final film quality, full-song playback, GPU generation,
real review consent, durable export or downloaded playback. Those remain separate
acceptance boundaries in V1S-436 and its linked tasks. No project data or GPU job
was changed by this verification branch. No PR or deployment was created.
