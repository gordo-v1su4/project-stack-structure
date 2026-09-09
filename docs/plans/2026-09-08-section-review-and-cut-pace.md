# Song-section review and readable cuts

## Accepted requirements

Continue in worktree 632b. Preserve the accepted story, original uploads, fixed
master-song timing and intentional holes. The latest user clarification supersedes
the earlier two-second answer: normal assembly cuts have a four-second minimum,
usually about four to six seconds. Rapid montage edits belong inside supplied or
generated clips. Longer takes remain useful; scene detection is an inventory of
possible boundaries, not a demand to cut at each one.

Review navigation follows the returned musical sections. Number Verse, Chorus
and Bridge occurrences chronologically, without restarting after another type.
Keep distinct consecutive verses and choruses. Combine adjacent initial Intro
fragments for review only; preserve all original timestamps and IDs underneath.
Shots and story moments belong inside sections. Story action may span a boundary.

## Implementation

- Repair source reload after Stop/section changes and pause both video buffers
  at the end of a section, alongside the master song.
- Put named musical sections first in Join; show the current section's shots and
  expose arrangement controls after selecting a shot. Preserve selection when
  collapsing playback. Play the full combined Intro range.
- Reduce automatic cue density and enforce four-second interior cut spacing.
  Keep exact section edges, including short boundary windows; they are timing
  metadata, not permission to manufacture short source shots.
- Use four-to-six-second targets in source placement planning and leave holes
  when an eligible source slice is too short. Existing saved placements remain
  explicit user decisions; show short legacy cuts rather than silently replacing
  accepted footage or rebuilding the story.
- Match's cue controls are diagnostic suggestions, not saved edit controls.
  Explain them in plain language, defer expensive recalculation until release,
  and keep the local slider thumb/value responsive while dragging.

## Verification

Regression tests cover repeat playback, end-of-range video pause, section labels
and Intro grouping, four-second cut spacing and truthful gaps. Run affected tests,
typecheck, focused lint and build. Verify production replay, named section
navigation, collapse/return, and slider interaction in the existing saved project.
Do not claim a revised saved assembly until it has been explicitly applied and
reviewed; this change must not silently discard the current blocking decisions.

## Local verification

706 tests passed (21 skipped) across the shared suite and four isolated lanes.
Source/test lint passed with eight existing warnings; typecheck and production
build passed. The literal `bun run check` command encountered seven pre-existing
lint errors in ignored `.tmp/save-recovery-20260908/rebuild-recovery.ts`; that
recovery artifact was preserved. Lint, typecheck and the complete test script were
then run separately. Production browser acceptance follows deployment.
