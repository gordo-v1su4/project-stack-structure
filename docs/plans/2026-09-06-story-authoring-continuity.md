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
