# Review workflow and media performance clarification

Status: implementation and Linear tracking authorized by Robert on November 11
after the interview. Start with measurement and bounded review fixes; no framework
migration, generation or production release is implied by that authorization.

## Priority and scope

Robert's November 11 clarification puts reviewing and editing the populated film
first. Rendering optimization comes later. Bun alignment remains a follow-up
across the server's applications, including Trigger and related tooling; it is
not limited to this repository and is not the immediate workstream.

Keep the existing Setup → Story → Draft → Finish journey from ADR-0003. Clarify
the responsibilities and shared review tools before changing that structure.
Preserve approved references, original media, the song and existing project data.

## Requirements stated by Robert

- Explain whether section navigation shows the whole musical section, its
  timeline range, or a particular clip. Make the selected scope visible.
- Make the top timeline, section switching, shot selection and players responsive
  with the real populated project, not only a small synthetic project.
- Story → Draft navigation and returning between pages must remain responsive
  while media loads. Robert reports a substantial pause; duration and causes are
  not yet measured. Treat route/stage responsiveness separately from image fetches.
- Thumbnail enlargement applies specifically to the embedded Story "Full-song
  still animatic" gallery circled in screenshot 1. Use the standalone Preview
  gallery in screenshot 2 as the visual size/proportion reference, not a vague
  instruction to enlarge every thumbnail. Keep 16:9 image areas and reduce the
  repeated text beneath cards. The top song-wide timeline strip is not part of
  this enlargement request. Standalone Preview still needs its loading fixed;
  its existing card size is the reference, not a request for another enlargement.
- Prepare lightweight image thumbnails and video preview/scrub assets when media
  is ingested or generated. Reuse the Review Room approach where appropriate.
  Hover video and scrub-strip behavior may be chosen from measured feasibility;
  Robert delegated that implementation choice.
- Connect images and videos to the same timed shot and current-cut context.
  Avoid separate, inconsistent preview inventories and unexplained selectors.
- Provide one discoverable detailed queue view for image and video work, linked
  from the compact activity panel. Show actual waiting/running/completed/failed
  work and which shot it belongs to.
- Make the embedded preview and standalone Preview page complementary. The
  standalone page should provide deeper review rather than repeat a still-only
  gallery with excessive text.
- Explain the scene-direction review panel and what selecting a scene changes.
  Keep scene-direction approval separate from take and final-cut approval.
- Make the story-to-song coverage display reflect the relevant current footage,
  including generated media, rather than presenting original matches as if they
  were a complete inventory of the current cut.
- Clarify Draft's target-shot selector versus its available source-footage
  selector, and simplify the path to watching/comparing a saved take.
- Pacing adjustments should stage suggestions. An explicit action prepares or
  applies the rearrangement, with honest progress. Moving sliders must not
  repeatedly replace the live cut underneath the reviewer.

## Verified current behavior

- BeatSpine's Full song / Selected section / Selected cut are zoom controls.
  Section buttons seek to the analyzed section start and zoom to that section;
  they do not themselves rearrange or generate footage. Only Join provides the
  callback that also selects overlapping draft cuts.
- MusicCutExplorer's sliders change suggested blocks only. It has no Apply
  callback. Story's separate Edit pace settings and Use this story operation are
  different controls; Join's Apply arrangement currently applies a proposed
  source swap/replacement, not those explorer sliders.
- Story's translation table reads original source placements from its own
  reconstructed story project. It does not consume generated-media/draft
  selection as a current-cut coverage inventory.
- The standalone Preview page currently displays and polls the still animatic;
  it is not a combined generated-video review and render-queue workspace.
- In Draft, an Animatic shot is a timed destination requirement. A Project source
  is an uploaded original video that can be explicitly selected to cover it.
- Ready stills or completed render jobs do not by themselves prove that motion
  footage is selected into the current cut. Available, selected and approved
  media must remain distinct.
- The timeline's TAKES and inspector's OTHER TAKES currently consume the same
  section-level source-footage matches, not generated variants of the selected
  animatic shot. Their percentages are rounded composite matching scores, not
  quality, identity-confidence or approval ratings. Multiple shots in a section
  can show the same suggestions. Selecting an alternative passes section/source
  identity rather than the exact shot identity; ambiguous multi-shot sections
  can therefore reject an enabled selection. Inspection and deliberate adoption
  must be distinct, with adoption explicitly targeting the selected shot.

Additional source evidence: spineSlots.ts:89-108;
matchCandidateRailModel.ts:25-39; semanticEditPlanner.ts:232-272;
StudioApp.tsx:1988-1995,2769-2771,2848-2849,3153-3161;
musicVideoProjectSelection.ts:19-29. These facts were checked in source; the
screenshot's individual saved match records were not independently inspected.

Evidence: BeatSpine.tsx:55-98; StudioApp.tsx:2833-2883;
MusicCutExplorer.tsx:26-73; StoryTab.tsx:59-63,146-190,264-294,444-449;
AnimaticPreviewPage.tsx:48-108; AnimaticSourceFootagePanel.tsx:17-59;
animaticDraft.ts:29-41; docs/protocols/music-video-editing.md; ADR-0003.

## Proposed approach, not yet settled

Use prepared playback proxies and scrub/thumbnail derivatives, load visible
cards first, and limit active video decoding. Consider one silent hover player
for the focused card instead of mounting a playing original video in every card.
Measure asset transfer, decode/player lifecycle and rendering work before making
a framework decision. The symptoms do not establish React as the cause.

Stage a new arrangement separately, report its changes/conflicts, and retain the
current cut during preparation. Apply a ready proposal explicitly with undo.
Rearrangement reuses immutable source footage; it must not silently regenerate,
repeat completed actions, or approve newly selected media.

## Settled interview decisions

- Q2: Yes. Preview is the shared review workspace reached from Story and Draft,
  with selected-shot context, image/video inspection and a detailed queue.
- Q3: Yes. Hand-picked takes and manual trims are protected by default during
  pacing rearrangement. Conflicts are shown in the proposed arrangement rather
  than silently replacing those choices.
- Q4: Yes. Shared Preview defaults to the current video cut, with clearly labeled
  still/gap fallbacks and optional timing-only and still-only modes.
- Q5: Yes. Pacing changes prepare a separately reviewable proposal before Apply
  replaces the current cut. Preserve undo and keep the current cut available
  while the proposal is prepared.
- Q6: Yes, expanded by the multi-selection clarification below. Section selection
  scopes playback, with explicit Play rather than autoplay on selection.
- Q7: Separated ranges can play for comparison, such as all choruses, using
  each range's matching master-song audio. Show skipped ranges/time jumps;
  those artificial joins do not test transitions in the actual cut.
- Q8: Do not automatically squeeze or stretch videos into timing windows.
  Speed changes and speed ramps are outside this review-performance scope.
- Q9: Automatic rearrangement must preserve story-beat order. Deliberate manual
  reordering remains a potential user action; the warning/override interaction
  is the remaining clarification, not permission for automatic cross-beat moves.
- Prioritize responsive navigation, linked multi-selection, quick hover/scrub/
  playback and marking unsuitable footage for replacement. The larger pacing
  proposal workflow must not delay that first review milestone.
- The screenshot clarification narrows the enlargement request to the embedded
  Story gallery. No global thumbnail-size change is implied.

Visual references supplied November 11:
`codex-clipboard-d1bc9667-8336-4f69-99c6-e45cdcfb9a41.png` (circled Story gallery)
and `codex-clipboard-0e0f26af-5835-495f-891d-b4aece8308da.png` (Preview size reference).

## Multi-selection and pacing clarification

Robert's next screenshot, `codex-clipboard-017c5d1f-5d08-404f-9da5-9e2a88a91e02.png`,
identifies the Music and cut timing graph as another view that must share the
top timeline's scope. Choosing a verse should focus both views on that time
range so individual cuts can be inspected at a useful scale.

- Support selecting several cuts/chunks or musical sections and extending a
  selection across boundaries, such as Verse 1 into Verse 2.
- Share selected time ranges, highlighted cuts and viewport scope between the
  top timeline, timing graph and shared Preview. Distinguish selection from
  rearranging footage; selecting never changes the cut.
- Make the entire visible block height interactive. The reported behavior where
  hovering only near the graph's top highlights a block is a usability defect
  to verify, not the desired interaction.
- Use familiar range/add/remove gestures. Proposed defaults: click selects one;
  Shift-click extends a contiguous range; Ctrl/Cmd-click toggles individual
  items; Shift-drag adds intersected blocks. Provide a plain visible multi-select
  mode as well so modifier keys are not the only way to select several items.
- Offer Play selection and show its ranges and duration. Separated ranges play
  with matching song audio for comparison, with visible time jumps rather than
  implying those jumps are transitions in the saved cut.
- Changing still timing can change image hold durations. Video rearrangement
  must show where existing footage no longer covers a required window.
- Visually distinguish missing coverage from filled blocks; an orange musical
  cue or selected suggestion must not imply that playable footage covers it.
  Keep selection, musical accents and footage-readiness cues distinguishable.
- Let the user select multiple gaps or unsuitable existing shots and explicitly
  request replacements together. Keep this separate from preparing/applying
  pacing: those actions do not themselves submit generation. Preserve previous
  takes while replacements are being prepared and reviewed.

## Implementation defaults and remaining validation

1. For an intentional manual cross-beat move, recommend a clear story-order
   warning and explicit confirmation, while automatic rearrangement stays
   constrained to story order. Preserve undo.
2. For rapid review, recommend that Mark for replacement only flags the exact
   shot(s), with one explicit batch submission later. Browsing, marking and
   changing selection must not spend generation credits or replace the cut.

Recommended labeling to confirm with the shared understanding: actual generated
versions belong under Shot takes; section-wide original-footage alternatives
belong under Source suggestions. Keep matching scores secondary and explained;
do not present them as quality ratings. Previewing an alternative does not adopt
it. Keep the selected-shot inspector close to the media being reviewed.

Robert then requested updating/creating Linear tasks and fixing the workflow,
and specifically asked whether React should be replaced by Svelte. Use the above
safe defaults as implementation recommendations, not claimed explicit answers
to Q10-Q12. Broader pacing proposals follow the initial review milestone.

## Tracked execution plan

The list below is the initial planning snapshot, not live tracker status. Current execution follows [review-execution.json](2026-11-11-review-execution.json) and [the tracker policy](../agents/issue-tracker.md): one active primary, conclude 458 before advancing, reuse the existing worktree with fresh contexts for subsequent tickets. Necessary coupling has a recorded reason/stopping point. V1S-459 owns final prepared-hover acceptance; V1S-458 owns navigation/selection verification. Refresh Linear and run the ticket-execution checker at boundaries.

The existing V1S-442 workflow issue remains open, with these verified children:

- V1S-458 (In Progress): measure and repair populated-film navigation/review
  latency. Distinguish transfer/server latency, media decode, React commits and
  synchronous model work before architecture decisions.
- V1S-459: prepared 16:9 thumbnails, bounded hover preview/proxy delivery and
  existing-media derivative backfill without source rerendering.
- V1S-460: linked multiselection, focused section views and selected playback.
- V1S-461: shared image/video Preview, current coverage and detailed job queue.
- V1S-462: actual shot takes versus source suggestions, explicit adoption and
  safe batch replacement marking/submission.
- V1S-463: protected pacing proposals, blocked natively by V1S-460 because the
  proposal must target the shared selection. Scheduled after fast review work;
  that priority is not represented as invented technical dependencies.
- V1S-464 (In Progress): trace the Python/media API topology and separate service
  latency from frontend review work. Live App VM checks confirm healthy web,
  Essentia and video-worker containers and active caption-gateway systemd service.
  Essentia live source is FastAPI and entrypoint Uvicorn; caption gateway is
  FastAPI/Uvicorn; video worker live command is Uvicorn with tracked FastAPI
  requirements. Media API tracked source is Node/Express on documented storage
  VM114; its live process is not yet checked. Initial public-browser metrics are
  posted in V1S-458, but are exploratory and do not establish interaction latency
  or framework causality.

Robert explicitly excluded SwarmUI/ComfyUI inspection and generation-workflow
optimization from this diagnostic. Treat that path as accepted for this scope;
do not tune, restart or investigate it as part of review performance work.

Verify on the populated film using cold/warm stage switches, selection feedback,
visible-card readiness and first video frame. Proposed budgets: feedback under
100 ms, warm stage switching under 300 ms, prepared hover first frame under
500 ms. Record hardware/network, repeated samples and misses; these are targets,
not current measurements. Compare equivalent before/after browser interactions.
Preserve project/reference/review state and use existing media; no generation
needed to measure review performance.

Retain React/Next.js for the initial optimization. A Svelte migration is not
justified by the reported symptoms alone. Consider it only if profiling shows a
remaining framework-bound bottleneck and a bounded equivalent comparison proves
benefit sufficient to justify migration cost and regression risk. Local source
inventory: 325 .ts and 84 .tsx files under src, plus CSS and an icon; Trigger task
orchestration is TypeScript. Python exists in identity scripts and external media
services, not as the web frontend or the Trigger task implementation language.
