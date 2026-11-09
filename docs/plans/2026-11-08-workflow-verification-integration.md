# Workflow verification candidate

Source integration of the held `26fa52a` workflow candidate with three reviewed
fixes. Code head: `4b51ca278c606e8a471c336729c230eebd9ae830`.

- `e455eb9` (original `9424442`): imported clips without an integer native frame
  rate show time and the trim-control time step instead of invented frame numbers.
- `fd549cc` (original `eb53d78`): missing-footage placements use musical cues and
  pace settings. A 29-second empty-library chorus changes from five Slow windows
  to eighteen Fast windows, preserving cue boundaries through H3 targeting and
  candidate assembly. Existing current saved plans are not retroactively recut;
  source trims, intentional holes, exact endpoints and stale-target checks remain.
- `4b51ca2` (original `879d2a2`): explicit, local 20-second playback timing capture;
  see [the capture procedure](../operations/playback-timing-diagnostic.md).

## Local verification

Verified November 8, 2026, in the isolated integration worktree:

- Frozen dependency install; clean source diff and conflict-free cherry-picks.
- Full lint: zero errors, five existing warnings. Full typecheck passed.
- Full isolated test runner: 1,557 passed, zero failed, 24 skipped, 7,322 assertions.
  The initial shell invocation could not find Bun; rerunning the test lane with
  Git Bash on PATH passed. Skipped media-dependent tests are not acceptance.
- Default production build passed. Existing trace/deprecation/localStorage
  warnings remain; no deployment or real-service test was performed.
- The zero-footage fix and timing collector received independent source review.
  The separate timing DOM fixture and imported-label SSR checks are synthetic;
  they do not establish live playback performance or film quality.

## Release and remaining acceptance

This is a source candidate, not a release. Preserve the original project and all
pending/selected media while integrating. It builds on the earlier held workflow
candidate, not the current production/main head; reconcile intervening changes
before release. The shared `musicVideoProject.ts` change joins the earlier
shot/style worker changes, so assess and deploy matching web/worker source
closures together. Do not treat the UI-only timing change as permission to ship
the combined candidate through a web-only release.

Production reference-check and image-transfer integrity failures remain unresolved
at this checkpoint. No PR, main push, deployment, playback or generation is part
of this integration. Real authenticated zero-footage generation, saved recovery,
identity/narrative review, prepared playback and full-song export/download remain
unproven.

Per-cut narrative direction is a separate remaining gap: automatic batch requests
currently reuse the parent story direction. Musical cut boundaries alone do not
prevent repeated completed actions. Reuse approved requirement action sequences,
physical states and exclusions when preparing shot directions; preserve explicit
user pickup edits and bind saved directions to the approved story and cut plan.
Prompt lint and rendered continuity review remain separate gates.
