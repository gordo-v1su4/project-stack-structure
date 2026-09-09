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

## Production findings

Deployment `89e199b` was Ready on the main alias. The preserved saved project
showed one Intro, Verse 1–5, Chorus 1–6 and Bridge 1–2 (plus the returned Part A).
Match's graph dropped from 135 blocks at the prior saved settings to 45 with
cue density reduced to 30%; lyric influence 75% and combine-nearby-cues 5s were
restored after pointer/keyboard checks. No placement was rebuilt.

Combined Intro playback loaded, played source footage, reached its trailing gap
and stopped both video buffers and master audio. Browser testing then uncovered
a separate return-control defect: the full-size gap placeholder had `z-10`,
above the monitor toolbar. `elementsFromPoint` at the Return button returned the
placeholder first; pointer clicks were swallowed, while Enter worked. The media
container now establishes its own lower stacking layer and the toolbar stays
above all media/placeholder overlays. Deployment `9b07260` passed real pointer
Return and Collapse over Verse 1 placeholders; Join and Verse 1 selection remained
visible. The header now agrees with the 15 grouped song sections.


## Selection simplification

The user rejected the second large song-section picker as repetitive. The top
spine is now the only section navigator. Click the actual section word to open
its shots; Shift-click another section to include the contiguous range. Timeline
clips support the same click / Shift-click behavior. Shift extends from the
original anchor, forward or backward, and includes every intervening shot and
hole. A normal click starts a new selection. A single compact shot strip shows
the selected range in order, with one Play selection action. Individual shot
review and replace/swap/remove remain available below it. This selects and
previews existing placements; it does not change them.

Selection changes preserve the clicked stage. Range playback uses the selected
first/last shot indexes rather than expanding back to entire sections. Regression
coverage includes backwards range selection and extending/shrinking from the
original anchor. Focused tests, lint (three existing warnings), typecheck and
production build pass; live selection acceptance follows deployment.


Production `03de698` is Ready on the main alias. Real pointer click on Verse 1
then Shift-click Verse 2 selected both top labels and showed six ordered shot
cards for 14.8–43.8s. Play selection ran 29.1 seconds with master audio through
placeholders and stopped at the range end. Return to editor retained both verses
and Join. A normal click on timeline shot 4 reset to one shot; Shift-clicking
back to shot 2 selected shots 2–4, including the intervening shot. That 7.5-second
source preview loaded with readyState 4, no media errors, muted source videos,
and paused both buffers and master audio at its end. One Song sections navigator
remains; the duplicate picker and duplicated section-play button are gone.
These checks did not rebuild or change the 35 saved placements / 21 gaps.
