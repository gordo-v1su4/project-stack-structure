# Story-to-edit restructuring plan

Status: implementation in progress, September 6, 2026. The user approved execution
with parallel subagents. This is the controlling plan for the
story, footage understanding, matching, generation-gap, and review flow.

## 1. Outcome

A user supplies a song, reference sheets, footage, and optionally a short story
seed. The app proposes three understandable stories. Each has a proper logline,
a three-sentence hook, and an inspectable sequence of story moments. The user can
accept a recommendation with minimal input or edit it without starting over.

The resulting edit must follow the chosen story. Unsupported actions remain
visible holes. The system must not manufacture narrative coverage by repeating
clips or choosing a different action in the same location.

**Central rule: footage describes what is visible; the chosen story determines
where, when, and why that footage belongs.** A shooting, kiss, escape, or collapse
can be an opening, climax, or flashback. Never permanently label a source clip
as an intro, ending, or other universal narrative phase.

## 2. Product decisions from the walkthrough

- Default to automation with optional correction, not a long mandatory form.
- Preserve three genuinely distinct treatment options. Each card opens its own
  full treatment and coverage review; inspecting a card need not commit it.
- Keep the seed as a starting point. Add direct editing and a short optional
  revision instruction, such as “start outside, then show Diego arriving alone.”
- Story moments and song sections are separate layers. A narrative moment may
  span multiple music sections; several moments may fit inside one section.
- An opening image may establish geography or theme without advancing the plot.
- Missing story evidence is useful information, not a failure to hide.
- Default coverage is strict. Repetition or a best-effort final video is an
  explicit alternative chosen after the user sees its compromises.
- Match percentages are evidence scores, not a probability that a story is right.
  A contradiction must not be averaged away by shared names, color, or setting.
- Keep the current short Nano Banana Pro image-prompt style. Improve the story
  input feeding it; resume image-prompt experiments separately.
- Use only the six selected videos and three canonical reference sheets for this
  acceptance run. Preserve the expandable library; leave the crowd library empty.

## 3. What we actually found

| Area | Current evidence | Consequence |
| --- | --- | --- |
| Treatment generation | `storyTreatmentServer.ts` demanded exactly four anchors; the parser retained only four, despite a schema allowing six. | Establishing or transitional moments can disappear. |
| Cards | The logline field has no explicit formula in the original instructions. Synopsis text is clamped. | Weak pitch copy and incomplete reading experience. |
| Editing | Anchor title/description fields exist; full treatment prose was read-only. | Users can change anchors while leaving contradictory prose behind. |
| Assignment | Confirmation distributes anchors by section index, rather than explicit story timing. | Repeated section directions and inaccurate progression. |
| Preview | `buildEditPlanPreviewSegments` refreshes candidate lists; `pickPreviewCandidate` prioritizes variety/reuse before rank. | An approved opening can acquire unrelated later action. |
| Coverage | A primary candidate makes a slot weak/short/filled; only absence is a blocking gap. | A bad semantic match can still make the project look complete. |
| Caption inputs | The schema has subjects/action/setting, but the base prompt describes a single frame. The exact temporal evidence reaching the worker still needs verification. | A static pose cannot establish an action like entering, searching, or escaping. |
| Music labels | `src/trigger/essentia.ts` passes through `structure.sections`; the UI numbers repeated roles. | The odd verse/chorus pattern needs an upstream audio-analysis audit, not cosmetic relabeling. |
| Card metrics | “Auto-resolved” counts any decision, including generate/omit. “Reuse estimate” comes from model output. | These are not measured usable-footage or finished-edit coverage. |

The live treatment also contradicted its anchors: the paragraph began with Diego
entering/searching, while the first confirmed anchor described the pair already
face-to-face. That is a source-of-truth problem as well as a ranking problem.

These findings do not establish that every existing caption is wrong. Inspect
actual frames and temporal evidence before attributing a bad placement to captioning.

## 4. The user flow

### September 7 clarification: the whole-song rough-cut loop

The user clarified that the preview is an editable assembly of **all song
sections together**, including story holes, rather than a collection of isolated
section previews. The primary review loop is: play the whole rough cut, inspect
a hole or uncertain clip order, move/swap footage or supply a missing shot, and
play the revised sequence again. Final effects, transitions, and export follow
that assembly review. Section playback remains a quick way to test a local edit.

- Keep the master song and its section windows fixed while arranging visuals.
  A hole plays as an explicit placeholder for its full song window; playback
  continues into the next available clip without compressing the song.
- Join must be available for an incomplete confirmed story, including an
  all-gap assembly. Coverage is still incomplete, and final export remains
  blocked until its requirements are satisfied.
- Show sections in song order with their clips and holes. Provide whole-song
  and selected-section playback, an obvious route to replace a selected clip,
  and a route to fill the selected hole with supplied or generated media.
- Support explicit arrangement changes with visible consequences and undo.
  Preserve evidence eligibility and causal story constraints; when a change
  requires revising the story, surface that requirement rather than silently
  turning an incompatible clip into a supported match.
- Match, Generate, Join, Effects, and Export consume the same saved placement
  sequence. No preview may substitute the larger Split pool or random ordering.
- A revision stops stale playback and invalidates affected prepared output;
  the user can replay the new assembly immediately and restore it after reload.
- Acceptance: visibly play source → hole → source across section boundaries
  with continuous master audio; change a clip/order, replay and undo; fill a
  hole from supplied media, review it in context, reload, and verify that final
  effects/export use that same accepted sequence. No new image/video generation
  is needed for this test.

```mermaid
flowchart LR
    A[Upload song, refs, six videos] --> B[Analyze music and visible footage]
    B --> C[Three story cards]
    C --> D[Read or edit one story]
    D --> E[Review story moments and holes]
    E --> F[Confirm story]
    F --> G[Match valid footage to moments and music]
    G --> H[Generate or supply missing shots]
    H --> I[Review exact placements]
    I --> J[Join, effects, export]
```

### September 8 clarification: mixed footage, unnamed performers, and trimming

The acceptance project mixes older and newer clips. A separate singer appears
in the older earthquake source; the user deliberately omitted the singer's
reference sheet and does not want another named character. Keep that performer
unnamed. Clothing color or a similar outfit must not identify the singer as
Valentina, and captions must not describe an outfit to compensate for uncertain
identity. Preserve the source: its second detected interval contains useful
floor-collapse footage after a singer close-up. Review these actions separately
instead of discarding the whole clip or treating the singer as a lead.

The assembly workflow must make it easy to trim the start or end of a selected
clip while watching the result. Trims are editable source in/out points, not
destructive changes to uploaded media. Keep song timing fixed; shortening the
available footage must leave a visible hole unless the user supplies coverage.
Reassess the retained interval's frames, captions and character evidence so a
removed singer lead-in cannot continue influencing matching. Invalidate stale
prepared previews and exports, support undo, and persist trims across reload.
Acceptance uses this source to remove the singer lead-in while retaining the
earthquake, then checks replay, undo, reload and the exact range in final output.

The user further requested one continuous interaction: keep the desired part,
then **Continue from here**. From the selected assembly clip, let the user trim
the unwanted lead-in/tail and request continuation from the retained ending
without moving through several setup tabs. Prepare the ending frame and relevant
references from that exact interval using the canonical creative protocol;
do not carry the removed singer into the continuation's subject constraints.
Show the retained clip and proposed continuation together for review, then place
an accepted continuation immediately after the retained clip within the fixed
song timeline. Expose the requested continuation length and prompt for optional
adjustment, with generation cost/approval at submission. Handle generation via
the normal authenticated Trigger contract and retain provenance and undo. This
is an implementation requirement, not authorization to generate new media during
the current existing-media-only acceptance run; exercise the flow through its
submission boundary and test result integration with already supplied media.

### Story cards and the full-story dialog

Card: title, logline, compact three-sentence hook, and “Read story.” Remove the
three unexplained numeric metrics. A small plain-language missing-footage notice
may summarize a real assessment once available; do not invent an estimate.

Use this project logline contract:

> When [inciting incident], a [specific protagonist] must [concrete goal] despite
> [central opposition], or [specific stakes].

The prose must express all five elements, stay concise, and avoid giving away the
resolution. Do not invent stakes or conflict merely to fill the formula. Sentence
order can vary; semantic completeness matters more than matching a regular
expression. The formula synthesizes the elements described by
[StudioBinder](https://www.studiobinder.com/blog/what-is-a-logline/) and
[ScreenCraft](https://screencraft.org/blog/the-simple-guide-to-writing-a-logline/).
Store the five elements as structured generation fields so validation can detect
missing pieces; keep them out of the default user form. Review their consistency
with the treatment, not just their presence.

The hook has three short sentences: situation, complication/response, and the
central dilemma or escalation. It is pitch copy, not a substitute for the ordered
story plan. Legacy treatments remain readable and editable; flag outdated
assessment instead of rewriting their story without approval.

Dialog: full logline and summary; ordered story moments; candidate evidence and
holes for every moment; optional Edit and Refine actions; a distinct “Use this
story” action. Use a centered native dialog with a bounded scrolling body, keyboard
focus containment, Escape/Close, and focus restoration. Opening or cancelling it
must not alter selection or confirmation.

### Optional edits without repetitive prompting

Support direct edits to prose and story moments, plus one natural-language revision
field. For a revision request, propose a patch to the relevant prose, moments,
requirements, and assignments. Keep unaffected decisions and show what changed.
Do not regenerate all three treatments for a local correction.

Editing prose must trigger reconciliation with the structured story. Mark the
revision pending until the updated moment plan agrees with the text; an editable
paragraph alone does not fix the disconnected data. The app can propose changes
automatically, with a compact review instead of asking the user to rebuild a form.
Add/reorder/remove moments and timing controls under progressive disclosure.

### Review holes within each treatment

Each moment shows its purpose, requested visual, and one of:

- **Footage found:** a supported candidate, with viewable evidence.
- **Uncertain match:** a relevant candidate lacks evidence for a requirement.
- **Missing footage:** nothing supports the required action, subject, or setting.
- **Planned generation / omitted:** an explicit user decision, shown separately
  from whether footage exists.

An unresolved moment must not prevent viewing later planning screens. Users should
be able to confirm a story with visible planned gaps and continue to Generate.
Final export readiness is a separate gate.

## 5. Narrative structure and music timing

Reuse ideas from the existing donor repositories, not their whole UI or random
assignment code:

- [TrailerCraft beat definitions](../../../trailercraft/src/constants/storyBeats.js)
  contain Save the Cat beats, including opening image, setup, catalyst, escalation,
  finale, and final image. Its reference-distribution helper shuffles images; that
  helper is not suitable for evidence-based footage matching.
- [Storyception structures](../../../storyception/lib/data.ts) and
  [beat weights](../../../storyception/lib/beat-weights.ts) include narrative,
  song-arc, performance, and visual-concept options. Preserve the distinction
  between a stable opening/closing and repeatable middle performance material.
- This repo already names Storyception as the donor in
  [the creative production brief](../product/creative-production-brief.md).

Proposed default: a compact visual arc—opening image/world, introduction or
connection, development, disruption or turn, response/climax, closing image.
Adapt or omit roles for performance/concept videos. Do not require fifteen
screenplay beats or force every music video to contain a disaster. Permit a
cold open or flashback when the selected story calls for one; record presentation
order and causal dependencies separately.

Map narrative moments to actual music windows using beat/onset/phrase timing,
energy, recurrence, lyrics where relevant, and editorial pacing. Avoid equal
anchor distribution by section count. Never impose a fixed verse/chorus pattern.
Let the user rename, split, merge, and adjust detected sections. Mark uncertain
labels as provisional; retain the original detection and manual corrections.
The beat spine, Story, Match, Generate, and export must use the same edited map.

## 6. Data and service contracts

| Record | Required purpose and fields |
| --- | --- |
| `MediaEvidence` | Source/scene IDs, source time range, frame/video evidence URLs, visible characters and identity confidence, focal subject count, observable actions and transitions, interaction, shot scale, location, visible physical state, unknowns, model/prompt version. |
| `StoryTreatment` | ID/revision, logline elements and prose, three-sentence hook, chosen structure, ordered narrative moments. |
| `NarrativeMoment` | Stable ID, role/purpose, filmable description, presentation order, causal dependencies, required subject/action/state, optionality, and shot requirements. |
| `ShotRequirement` | Stable ID, moment ID, requested visual evidence, duration/range, optionality, reference roles. An establishing image is valid even without a character or plot event. |
| `SongMap` | Stable section IDs, boundaries, beat/onset references, provisional labels/confidence, manual overrides, version. |
| `StoryMusicPlacement` | Moment/shot IDs mapped to song windows. Supports multiple moments per section and vice versa. |
| `MatchAssessment` | Requirement and source IDs, component scores, satisfied/unknown/contradicted constraints, evidence references, reason, assessment version. |
| `ApprovedPlacement` | Exact source interval or approved generated asset, song interval, approval origin, fit policy, source/story/music versions. |
| `CoverageDecision` | Semantic coverage and duration coverage separately; unresolved, source, generate, omit, or explicitly permitted reuse. |

These are contracts to reconcile with existing types, not a requirement to create
nine new services or tables. Add stable IDs and explicit provenance to the
current project document; use a versioned migration.

### Captioning and footage understanding

Audit the request from browser to Trigger.dev to the Qwen worker. Record whether
it sees a single frame, a multi-frame strip, or the scene clip. For temporal verbs,
use adequate ordered frames or video with source times. Do not infer search,
arrival, relationship history, or intent from a face or pose alone.

Keep factual evidence separate from story-conditioned interpretation. Name only
characters supported by the reference sheets; unknown identity stays unknown.
Distinguish a focal solo subject from background crowds and a visible pair. Record
what changes over the clip, including entrances/exits and intact/fractured
surroundings when visible. A shot can have several possible story uses.

Persist a richer structured result and a concise readable caption. Retain original
caption/model/version and user corrections. Reprocess selected scenes or one video
when needed; do not recap all six on every story edit. Trigger progress must show
real stages and actionable failures in the right panel.

### Matching and placement

Use two stages:

1. **Eligibility:** reject direct contradictions to required visible evidence.
   Solo walking versus paired dancing is not rescued by matching names or club
   lighting. Unknown action evidence remains uncertain. Missing footage stays empty.
2. **Ranking and arrangement:** rank eligible candidates by story relevance and
   then choose musically appropriate source slices. Motion/color continuity,
   shot variation, and reuse apply within eligible material; none can override a
   story contradiction. Preserve musical alignment when placing cuts.

Semantic/identity/action/continuity scores must have inspectable reasons. Do not
select an arbitrary threshold and claim it is calibrated confidence. Calibrate
against the reviewed six-video cases and broader neutral examples; show a match
strength label until percentages are defensible. A hard contradiction gets zero
eligibility, distinct from an uncertain score.

The same approved placements must drive Match, Generate source composition,
preview, Join, and export. Playback must not rerank, add candidate vocabulary, or
change footage. User changes to Match create a new placement revision.

### Honest coverage and generation

Calculate coverage for each requirement, not just each song section. Distinguish
missing action, uncertain interpretation, insufficient usable duration, and
optional visual variety. Coverage summaries must be derived from these records;
remove model-guessed reuse percentages as readiness evidence.

Default **faithful draft** retains holes. Preview placeholders keep their song
windows and master-audio timing; do not skip them and compress the sequence.
Generate receives the unmet requirement, intended song window, neighboring story
context, and correct reference roles. A missing opening has no source composition
frame unless a relevant frame is explicitly selected. Do not use the first
arbitrary cut as a fallback reference.

Offer **best-effort edit using existing footage** only as an explicit alternative.
Show proposed repetitions, omitted moments, and narrative compromises before
applying it. Repetition may extend eligible performance footage; it cannot change
an unrelated action into a supported story event. Save the original faithful plan.
A planned still or storyboard grid is not a completed video gap until the required
video asset exists, passes inspection, and is approved.

### State, persistence, and async work

Story, music map, reference, caption, and placement revisions must invalidate the
correct derived work. Preserve old results as history but prevent stale Trigger
responses, restored snapshots, or preview caches from becoming current. Editing a
logline, character requirement, section boundary, or selected source cannot leave
an old plan marked ready. Autosave must preserve edits and review state across reload.
Retain authenticated routes, per-user run ownership, and durable RustFS references.

## 7. Implementation sequence and acceptance gates

### Phase 0 — baseline and controlled scope

Save the current project and inspect the unpublished diff. Record the selected
six-video manifest, three reference checksums, captions, treatment, assignments,
and deployed SHA. Add a six-video fixture lane rather than invoking the current
21-video default harness. Preserve raw media and user edits.

Deliverable: reproducible before-state with exact source/song IDs for the wrong
opening and its path to Generate. Gate: another run can reproduce the discrepancy.

### Phase 1 — contracts and an evidence audit

Implement versioned records and strict coverage semantics before UI rearrangement.
Review all 42 reported scenes in the six-video set, checking uncertain temporal
claims against video. Build a small labeled regression set: alone/together,
walking/dancing, intact/fractured, visible action/unknown intent, correct/incorrect
story placement. Inspect song audio and detected boundaries; confirm the actual
service/model behind section naming before changing it.

Touchpoints: `types.ts`, `sceneCaptionPrompt.ts`, `sceneCaptioning.ts`,
`sceneCaptioningServer.ts`, `src/trigger/caption.ts`, `src/trigger/essentia.ts`,
and the relevant worker adapter after tracing it.

Gate: evidence distinguishes the concrete examples; uncertain facts remain
uncertain. No invented corrected song structure and no full recaption loop.

### Phase 2 — readable, editable story options

Implement formula-based loglines, three-sentence hooks, full-story dialogs, flexible
structured moments, and optional revision controls. Reconcile prose edits with
moments. Surface holes for each option before selection. Keep extra controls
collapsed and label music corrections clearly.

Touchpoints: `storyTreatments.ts`, `StoryTreatmentPlanner.tsx`,
`StoryTreatmentDialog.tsx`, `src/lib/storyTreatmentServer.ts`,
`panels/StoryTab.tsx`, `StoryStructurePlanner.tsx`, `storyStructure.ts`.

Gate: each option can be read in full, edited, inspected for missing opening
footage, and selected without repeated seed generation. Cancel is non-mutating;
saving invalidates derived work. More than four valid moments survive parsing.

### Phase 3 — preserve story intent through Match

Implement eligibility before ranking, explicit moment-to-music placement, and a
single approved placement list. Remove preview-time reselection. Carry holes
through coverage and stage readiness. Repetition policy is explicit and persisted.

Touchpoints: `semanticEditPlanner.ts`, `musicVideoProject.ts`,
`musicVideoProjectSelection.ts`, `editPlanCoverage.ts`, `resolvedPreviewSelection.ts`,
`buildStudioPipelineInput.ts`, `studioPipeline.ts`, `panels/MatchTab.tsx`, and
`StudioApp.tsx` orchestration.

Gate: paired dancing cannot cover a required solo arrival; a selected later escape
stays later. A deliberate flashback or cold open still works. Missing slots remain
missing after reload, rematch, preview, and stage changes.

### Phase 4 — targeted Generate and exact Join/export

Build generation jobs from unmet requirements and approved reference roles.
Use the supplied 3×3 grid as a manual provider-return fixture, with honest
provenance, to test storage, splitting, review, and downstream handling. Verify
provider-return errors and live feedback. Join and export consume the same approved
placements; resolve preview media/CORS separately rather than hiding playback errors.

Touchpoints: `storyboardGeneration.ts`, `panels/StoryboardPlanner.tsx`,
`panels/GenerateTab.tsx`, `generatedAssets.ts`, `exportGeneration.ts`, storyboard
return/splitter routes, preview player, and relevant storage/worker adapters.

Gate: no wrong-cut composition reference, no silently filled holes, no source
substitution between preview and export. Manual import is not proof of a successful
generation API call. Paid generation retains its explicit approval boundary.

### Phase 5 — visible six-video walkthrough and polish

Run the complete browser journey with the saved baseline and actual media. Verify
both faithful-with-gaps and explicit best-effort modes, reload persistence, async
failures, and final artifact timing. Then resume the deferred UI work.

Gate: the user can understand which story was selected, which moments are missing,
why footage was chosen, and what will be generated or repeated, without reading
technical metadata. Inspect the final render; a build or successful HTTP response
alone is not acceptance.

## 8. Regression scenarios

| Scenario | Required result |
| --- | --- |
| Jungle/cave opening requested, only club interiors supplied | Missing establishing footage; no invented exterior or running replacement. |
| Diego walks alone; candidate shows Diego and Valentina dancing | Ineligible, regardless of shared identity, club, color, or energy. |
| Visible walking but no evidence of searching | Walking evidence retained; search intent uncertain. |
| Same action used in different stories | Placement follows each story; no permanent source-level beginning/end label. |
| Disaster used as intentional cold open | Allowed by explicit story intent; later causal context remains coherent. |
| More than four narrative moments | All supported schema-valid moments retained and visible. |
| Change opening prose | Corresponding requirements/map require reconciliation; old preview cannot remain current. |
| Missing source, then preview refresh/reload | Gap remains; song time does not compress. |
| Several similar dance takes | Ranked within appropriate performance moments; not treated as new narrative events. |
| Repetition selected explicitly | Proposed compromise visible and recorded; original faithful draft preserved. |
| Song label or boundary corrected | Same edited map and stable IDs used in Story, Match, Generate, and timeline. |
| Delayed caption/generation response after edit | Stored as stale/history, not applied to the new plan. |
| Story card dialog keyboard flow | Centered, scrollable, Escape works, focus restored, no accidental selection on Cancel. |
| Manual 3×3 result | Nine panels persisted and reviewable, with manual-import provenance and no false API claim. |

Use affected Bun tests and type/lint checks per change, `bun run check` before a
PR, and builds where relevant. Adapt the real-media harness to the exact six-file
manifest before running it; the default studio lane expects 21 videos and six
sheets. Follow [tests/README.md](../../tests/README.md). Verify production through
the visible browser and inspect media outputs, not only synthetic fixtures.

## 9. Starting state, limits, and deferred work

- Published: `fa2a411` adds a compact-by-default collapsible program monitor.
  Vercel reported Ready on September 6. In the restored unconfirmed story, no
  preview was mounted; expand/collapse interaction still needs a mounted-preview
  scenario. Do not claim that interaction test has passed.
- Unpublished exploratory edits exist for section direction wiring, treatment
  dialog/editing, extra anchors, explicit section assignment, and protected
  source/gap choices. These are partial prototypes, not the completed design.
  Review them against this plan before keeping or extending them. In particular,
  locking one clip to a whole section is only a containment patch, not the final
  requirement-level matcher or musical arrangement policy.
- Caption accuracy, true song structure, score calibration, many-to-many placement,
  revision reconciliation, and full production E2E are not yet verified.
- No new generation or infrastructure mutation is required to approve this plan.
- Auto-resizing/standard media sizes, broader aesthetic work, and caption-server
  speed options remain in [the deferred UI list](2026-09-06-studio-ui-todo.md).
- The underlying model's reasoning quality cannot be guaranteed by a JSON schema.
  Use evidence checks, evaluation cases, and visible uncertainty rather than
  declaring every correctly shaped answer semantically correct.

Recommended order: evidence and state contracts first, story review second,
matching/coverage third, generation and export fourth. This prevents a cleaner UI
from simply presenting the same wrong edit more attractively.


## Execution record — September 6

Implemented locally: editable story cards and per-shot requirements; separate story/music
windows; factual temporal-caption metadata with stale-response guards; strict eligibility
before ranking; saved exact placements with visible duration gaps; reviewed best-effort
reuse preserving the faithful version; targeted generation directions; draft v3 migration
that preserves legacy text for review. The supplied 3x3 image remains the video-demo input.

Evidence: `docs/plans/2026-09-06-footage-evidence-audit.md` and
`tests/fixtures/story-evidence/six-video-review.json` record 42 scenes / 126 sampled frames.
Sampling does not prove every instant of a scene; ambiguous action remains unverified.
The music service uses duration-based fallback boundaries and energy-based verse/chorus
labels; these are now presented as estimated, without inventing corrected song form.

Integrated local verification: `bun run check` passed (585 tests, zero failures;
lint has seven warnings and zero errors), and `bun run build` passed. Regression
checks cover sparse-cue timing overlaps, confirmation-time source signatures,
stale generated returns, and measured partial-return coverage. Exact source
placement labels now survive export without selecting the last item in a section.

The signed-in production browser saved a separate copy named
“Story continuity validation · six clips · 2026-09-06” with six videos and 42
captioned scenes; the original user project remains available. Deployment and the
new authenticated walkthrough, manual image import/split, and video-creation
handoff remain open. No new image or video generation is part of this gate.

Infrastructure lookup: `../proxmox-home/docs/endpoint-index.md` and
`../proxmox-home/docs/operator-source-of-truth.md` identify VM100 `app-vm` as the
caption gateway and Trigger host. `../hermes-notebook-vault` is the Obsidian operator
index. Public service responses were healthy during deployment preparation; SSH
access must be re-established before deploying the updated Trigger worker.

### September 7 production walkthrough

- Web implementation `33690de` reached Vercel Ready and was correlated with the
  GitHub deployment SHA. Follow-up `f1c6ab6` now labels legacy cards as needing
  assessment and unconfirmed table rows as unapproved; estimated section labels
  no longer claim detection. The saved six-video copy restored after reload.
- A visible Edit → change title → Cancel → reopen test preserved the saved story.
  The story dialog is centered and scrollable; its legacy assessment labels also
  need the same review treatment as the cards.
- Two real `qwen-story-treatment` runs completed on worker `20260906.1`:
  `run_cmtqs7dn800lv3is0aqxch4gh` and `run_cmtqsaay000ly3is0rnjjl7zl`, approximately
  125 and 129 seconds. Their outputs were rejected: missing per-shot requirements,
  then duplicate Bold/Wildcard content. Preserved input/output evidence is in
  ignored `.tmp/story-live-treatment-attempts.json`; this is a failed authoring
  acceptance test, not a completed story workflow.
- Corrective work includes a complete authoring JSON example, preservation of
  explicit chronology and ending in all options, and distinct generation/revision
  gateway envelopes. Same requested endings are allowed; duplicate loglines
  remain rejected.
- The gateway's old effective output cap was 3,000 tokens with an 8,192-token
  backend context. Both observed replies finished below the cap, so truncation
  is not established as their cause. The expanded contract requests 7,000 output
  tokens; the proposed bounded 16,384-token context still needs live verification.
  Source changes and rollout checks are in the canonical proxmox-home gateway
  directory. No new gateway deployment or restart has occurred at this checkpoint.
- The documented Hostinger SSH jump reaches app-vm, but Tailscale requires an
  additional interactive sign-in. That check is open in the browser. The updated
  worker, corrected live authoring, faithful/best-effort walkthrough, manual 3×3
  import/split, and video-creation handoff remain outstanding.
- Retry follow-up supplies bounded, specific validation feedback and removes
  exact repeated caption fields without rewriting footage observations. The
  selected-story revision operation now reaches the gateway. Dialog assessment
  labels also withhold legacy coverage claims pending review.
- Gateway source is committed and pushed as proxmox-home `a434ab6`, with 12
  tests passing. This is source readiness only; production is unchanged.
- Web follow-up checks: 37 affected tests / 133 assertions pass, typecheck
  and production build pass, and scoped lint has no errors (one existing unused test argument
  warning). The earlier full implementation check passed 585 tests. Live
  authoring acceptance must still be rerun after worker and gateway deployment.

### Logline acceptance follow-up

The user correctly identified the displayed legacy pitch as a plot recap. Those
saved cards now explicitly distinguish earlier summaries from reviewed loglines.
The existing field-presence validator alone was insufficient: unrelated prose
could pass with populated five-element fields. New gateway source in
proxmox-home `5c1c7ab` therefore runs a separate, bounded semantic review after
generation or revision. It evaluates the actual sentence against explicit user
constraints and ordered moments, with exact quoted spans and valid supporting
moment IDs. Unsupported or unclear elements and disclosed resolutions fail
closed. This is model-based review, not deterministic proof of narrative quality;
its live Qwen performance remains an acceptance requirement.

The web/worker contract requires a versioned review marker so an older worker
cannot silently bypass this check. A deployment mismatch stops immediately;
semantic rejection uses the existing single corrective authoring retry without
an extra SDK retry. Long generated loglines reject rather than being cut at 320
characters. Existing prose remains intact and can be submitted for refinement
up to 2,000 characters; generated replies still require concise complete text.

Local follow-up verification: 50 web tests / 171 assertions, typecheck and production build pass; scoped lint has no errors (one existing test warning);
gateway 22 story and 4 evidence tests pass. The gateway tests exercise mocked
review responses and evidence validation, not live model quality. Production
gateway/worker rollout, new valid treatments, faithful gaps, 3×3 import/split,
and video creation handoff remain outstanding behind app-vm SSH authentication.

### Authenticated rollout and live transport follow-up

SSH authentication cleared on September 7. Gateway source `5c1c7ab` is deployed
with its hash verified, Qwen runtime context is 16,384, and Trigger worker
`20260907.1` contains exact app source `5108b56` and all 17 expected tasks.
The canonical VM checkout was preserved; rollback instructions are recorded in
the deployment runbook. Caption output remains capped at 900 tokens.

Visible Studio run `run_cmtqupq5x00m23is06aa58mhq` reached real authoring and
independent review. Generation used 3,686 prompt / 4,465 completion tokens in
240.9 seconds; review used 3,545 / 1,546 in 79.1 seconds. Neither was truncated.
The worker trace recorded `TimeoutError: The operation timed out.` at five
minutes, before the gateway finished reviewing, and automatically retried.
The browser was reloaded and this run canceled to stop duplicate work; backend
work already underway was allowed to finish. No valid treatments reached the UI.

The story request now disables Bun's separate socket idle timer while retaining
the 540-second whole-request abort. Deployed Bun 1.3.3 source supports that flag:
[fetch timeout handling](https://github.com/oven-sh/bun/blob/bun-v1.3.3/src/bun.js/webcore/fetch.zig#L514).
This correction still requires a fresh worker and real browser acceptance.

The existing 42-scene visual audit also exposed a remaining matching defect:
caption-only claims could auto-cover a named action, and flattened structured
observations ignored explicit uncertainty. Legacy subject/action claims and
ambiguous actor/action associations now remain uncertain candidates. Regression
fixtures distinguish explicitly reviewed observations from caption prose; the
actual misidentified handstand and mixed-performer cases are included.

The visible per-video rerun on S3 completed three real caption tasks on worker
`20260907.1`, with exactly the canonical three reference keys. Structured evidence,
ordered sample times, source intervals, prompt/model provenance, and RustFS
caption storage references survive the worker response. This verifies transport
and persistence output; visual accuracy is being compared against the audit.
No other videos were reprocessed in this targeted test.

### Factual caption context and second live rerun

Worker `20260907.2` now runs exact source `a07cd1e`, including the Bun idle
timeout correction. Web `efa6d48` is Ready on the production alias and removes
story summaries, story prompts, lyrics, and free-form narrative instructions
from both caption dispatch entry points. Source identifiers, sample timing,
and the three canonical visual references remain. Full local checks pass
(601 tests, no errors; seven existing lint warnings).

The second visible S3 rerun completed three tasks on that worker, from
`run_cmtqvr7p600mf3is0crgc3hmt` through `run_cmtqvsfkl00ml3is02uafmq7y`.
Submitted strips were byte-identical to the first rerun. The opening caption
changed from dancing to walking through the crowd, and the close-up dropped
unsupported wet-floor and overhead-circle details. However, the model still
incorrectly identifies Valentina in the opening and misses part of the mixed
interval's solo-to-pair transition. These are remaining visual accuracy defects,
not successful evidence acceptance. The current matcher was exercised with
all three real responses and rejects each as automatic solo-arrival coverage.

Before/after responses and the visual comparison are saved under
`.tmp/story-caption-rerun-s3-audit/`; `.tmp/story-caption-rerun-s3-factual.json`
contains the second run's response and provenance. The first authoring attempt
on worker `20260907.2` is `run_cmtqvx8r000mo3is0efydiy2c`; its acceptance is pending.

### September 7 live authoring and constraint follow-up

Worker `20260907.2` completed authoring plus semantic review in one attempt
for `run_cmtqvx8r000mo3is0efydiy2c` (321.2 seconds), verifying the fix past
the former five-minute disconnect. Its reply and one corrective reply duplicated
treatment pitches, so the browser correctly rejected them. They were not
accepted as three distinct stories.

Web `411d94b` is deployed with 609 passing tests, typecheck passing, and no
lint errors (seven existing warnings). Shot constraints now retain excluded
actions and ordered actions. Empty or undefined model fields cannot erase
requirements derived from the requested visual. Scalar list entries are
normalized without inventing facts; malformed constraints remain review errors.
Generic phrases such as “Two dancers” no longer invent a character named Two.

Gateway `46f8ae8` was deployed with a verified source hash and 35 passing tests.
It requests each treatment separately with prior-option contrast, bounded
tokens/time, and rejects duplicate pitches. This generation path still needs
visible browser acceptance. The focused revision `run_cmtqwwyz600n03is0nv4gy6z7`
failed preflight because its authoring object was incomplete. Its corrective
reply reached independent review but failed exact goal-quote validation. Neither
was accepted. The edited Faithful pitch and hook remain saved and unconfirmed.

The live llama.cpp build `b9445-af6528e6d` passed a small contradictory-prompt
probe using `response_format: {type: "json_object", schema: ...}`. Required
JSON structure and a bounded reviewer-only formatting correction are being
implemented; semantic rejection must remain fail-closed. The authoritative
syntax is in the [pinned server source](https://github.com/ggml-org/llama.cpp/blob/af6528e6d/tools/server/server-common.cpp#L945).

The six supplied clips and three canonical references remain the only media
used. No new image or video generation has been submitted. The existing dance
3×3 grid must be attached to a dance requirement, never the jungle establishing
shot or solo arrival. Manual return/split/review and the video-creation boundary
remain unverified.

### User steering — additional crisis footage, September 7

Story work is paused while the additive Essentia endpoint is repaired in the
existing API repository/deployment. The user supplied four additional candidate
clips under `.local-fixtures/media/videos-to-test-with/earthquake-begins-clips/`:

- `hf_20260613_193547_b6f7603e-a4da-41de-9e16-04ccaafe4b39.mp4`
- `hf_20260613_193743_2854e5a3-cc1e-4cbd-83ed-1a47dcd70fcc.mp4`
- `hf_20260613_193857_b2ce10c8-1aaa-4ad1-9f3d-e9a2203154d7.mp4`
- `hf_20260613_193901_2b014bc5-eada-45e5-90c7-1f90077e6b37.mp4`

These are authorized for the later earthquake/crisis portion when story work
resumes, subject to actual visual inspection and captions. Inventory only so
far: no upload, captioning, or claimed coverage. The user will supply establishing
shots separately. Keep the opening explicitly uncovered until those arrive;
never place earthquake footage there to conceal the gap. The intended progression
is setup, developing connection, crisis, and resolution. The earlier six-video
E2E remains its own recorded baseline; additional footage does not retroactively
change that evidence.

### Deferred follow-up — consistent loglines across all three cards

- [ ] After the user supplies the establishing shots and story work resumes, update and verify **all three** treatment cards (Faithful, Bold, Wildcard) against the agreed logline formula. The current saved Faithful pitch was edited; Bold and Wildcard still contain legacy summaries and are marked "Earlier summary · logline needs updating." Updating generation rules did not retroactively rewrite those saved alternatives. The last replacement generation was not accepted, so this is unfinished work, not a completed three-card correction.
- [ ] Preserve each option's distinct story, supply its own concise three-sentence hook, and verify the saved/reloaded cards and full-story dialog. Review the five logline elements for semantic fit with the treatment, not just field presence. Reassess story/footage coverage after edits; do not treat an edited pitch alone as a reconciled story.
- [ ] Keep this deferred while establishing footage is pending. Do not regenerate or rewrite the current saved options during the pause.

### Resumed execution — opening supplied, September 7

The pause is lifted. The user supplied `hf_20260907_101523_b52d3e72-430f-4b9f-8e48-aa81337c129c.mp4`
and accepts it as a placeholder establishing shot. The original in Downloads was
preserved; a 17,309,561-byte copy is in the canonical checkout's ignored
`.local-fixtures/media/videos-to-test-with/opening-establishing/`. Both SHA256s
are `e274351c9fa3fdfb5622807b036ae1891441ffe308fa380ddad52b4705d053b5`.
Actual sampled frames show a jungle approach, red-lit cave entrance and interior
passage with patrons. They do not establish the named protagonist arriving alone.

The authorized current lane is the original six clips plus this opening and the
four crisis clips listed above, with the same three canonical references and no
crowd sheet. The earlier six-clip evidence remains historical. The crisis samples
show performance, floor fractures, crowd movement, corridor running and a broken
walkway; those observations do not independently prove every requested action or
identity. All five additions were submitted with the visible Add Videos picker.
The opening completed with four scenes/captions; crisis processing is in progress.

The saved `Story continuity validation · six clips · 2026-09-06` project restored
in the new task's production browser. Its manually edited Faithful prose and
legacy Bold/Wildcard options are retained pending real three-treatment generation.
The current music map still uses nine legacy estimated sections; the new analysis
has not yet been applied. The original backup project remains separate.

Recovered pending source was hash-checked before integration. Follow-up review
fixes persist the Essentia job ID for retry polling, retain CUDA/raw-label
provenance through save/reload, invalidate stale direction/placement reviews and
exclude gap source frames. Manual grid returns remain available, with standalone
2K approval required before video conditioning. Local `bun run check` passed
616 tests with 21 fixture-dependent skips, no errors and seven existing lint
warnings; production build passed. These are source checks, not browser acceptance.

The gateway's constrained author/reviewer repair `cdcdfcf` is already deployed:
live/local source SHA256 `892aaa8b07bf1d1d386e6ffcc01fe148b36fcb411ae1ceae07c1a6a4bd077ff9`.
Its last four recorded story failures predate the 03:34 EDT restart. The current
source still needs real authoring acceptance, not another speculative rollout.

The user expanded final acceptance: after solid story authoring, continue through
in-app section previews, final effects/transitions and export, then circle back
to the documented UI/UX fixes. Use existing generated images/videos; no new image
or video generation is required. Full walkthrough and export remain open.
Current local evidence lives in the canonical `.tmp/studio-resume-20260907/`.

### September 7 deployed audio acceptance and CPU investigation

Web SHA `349d5e489d7a144acd1bd7960fe667943990b6ec` completed its Git-triggered
Vercel production deployment. Trigger worker `20260907.3` deployed with 17 tasks
from the same source in an isolated VM100 checkout; its registry image digest is
`sha256:517dd8b73c0a730cab21e0f931a332386830b541673110bfa9c648710047f146`.
All eleven videos finished and saved with 57 captioned scenes. Caption completion
is not factual acceptance: the opening's first caption calls the cave glow an
orb, and another opening interval attaches unsupported lead-character badges.

The visible Replace song picker submitted the same complete master WAV. Run
`run_cmtr4d0q100pa3is0rg17bnb7` completed on worker `20260907.3` in 30 seconds;
metadata retained Studio job ID `e298c4c9dd3f46e1aae66ce4dab80bc7`. The saved
project has 246.69995464852607 seconds, BPM 131.94125366210938, 525 beats and
16 model intervals with CUDA provenance and original labels. The entire saved
story state was identical as parsed JSON before/after the audio
replacement. Actual GPU samples reached 85% utilization during audio analysis.

The user's report of roughly 700% CPU was reproduced during the subsequent
real story request: Qwen container samples reached 737–787% CPU while the RTX
4090 mostly reported 0–10% GPU utilization. Live arguments retain
`--n-gpu-layers 24`; Qwen allocates 4,662 MiB of GPU memory and uses eight CPU
threads. This is partial CPU/GPU model execution, not proof of efficient CUDA
inference. The sibling gateway runbook records a historical image-encoder OOM
with full offload and requires a proven image-caption smoke test before changing
that limit. No shared GPU settings were changed during this diagnosis. CPU/GPU
samples are saved beside the project snapshots. Performance remains open.

The browser retained the manually edited prose, and its seed now describes the
eleven-video scope while retaining solo-arrival and post-escape gaps where visual
evidence is absent. Current three-treatment request
`run_cmtr4ff8r00pd3is0jp5bka3e` failed after 174 seconds because Bold repeated
an earlier pitch. The worker obscured that known diagnosis behind generic
five-element advice, and the browser started its one corrective attempt with
the wrong guidance. A narrow fixed-message mapping now preserves that specific
duplicate-pitch rejection for the UI and corrective prompt, while unknown or
extended provider text remains redacted. Its 29 affected tests, focused lint and
typecheck passed. The corrective run and deployed acceptance remain pending.
