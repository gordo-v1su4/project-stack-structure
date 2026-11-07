# CONTEXT — Project Stack Structure

Living domain glossary for agents and implementers. Current workflow authority: [finish-music-video](workflows/finish-music-video.md) and [ADR-0003](docs/adr/0003-minimax-draft-first-completion.md). The older product briefs and June/September plans remain background; their upload-first gates and provider defaults are historical. Implementation status and actual acceptance evidence remain separate from the agreed product contract.

---

## Non-negotiable rules

### Musical alignment

Cuts and transitions must land on intended musical events (beats, onsets, section boundaries) before any visual heuristic wins.

### Motion continuity

Default visual continuity mode: prefer joins with coherent motion flow after musical fit. Scored via **motion descriptors** (direction, magnitude, coherence, camera class).

### Prepared preview

Playback uses only **ready** preview assets. The UI shows explicit readiness (waiting / processing / ready / failed), never fake live mutation of a half-built edit.

### Segment-level analysis

Rank and assign **post-cut segments** and caption-backed **video moments**, not whole-clip guessing.

### Preserve existing footage, generate missing footage

A master song, creative brief, and named identity/location references are enough to begin. Uploaded footage, vocal stems, and timed lyrics are optional. Preserve suitable approved footage when supplied; local MiniMax H3 generates genuinely missing coverage. Zero-footage projects follow the same story, draft-review, and export flow. Automatic draft selection never silently approves media for final export.

### Web-first studio

Browser UI + server GPU workers (Essentia, scene detect, captions, FFmpeg, Trigger.dev). Desktop/Tauri is contingent on benchmark evidence, not assumed.

---

## Workflow stages

Four primary steps. Detailed editing tools retain stable internal `Tab` keys and persisted data; they are available inside the primary steps rather than eight mandatory ceremonies.

| Step | UI label | Tab key | Panel component | Ready when |
| --- | --- | --- | --- | --- |
| 1 | Setup | `review` | `IngestTab` | Master song analyzed + named Character 1 and Environment references durably uploaded; other lanes optional |
| 2 | Story | `story` | `StoryTab` | Treatment chosen, anchors resolved, and timed story plan confirmed; music sections supply timing when lyrics are absent |
| 3 | Draft | `generate` | `GenerateTab` | Current source/generation requirements visible; jobs and selected ready candidates form a reviewable saved draft, including explicit unresolved holes |
| 4 | Finish | `compose` | `ComposeTab` | Reviewed current selection covers the full song and durable preview/export is usable |

Draft tools: Join (`join`), Match (`shuffle`), Split (`split`). Finish tools: Export (`compose`) and Effects (`ramp`). `workflowNavigation.ts` owns the grouping. Split/Match/Join remain useful detailed tools, not required visits before generation or incomplete-cut review.

Pipeline gating: `studioPipeline.ts`, `buildStudioPipelineInput.ts`, and `ingestLanes.ts`. Show honest per-lane waiting/processing/ready/failed states. Do not fabricate clips, scenes, captions, or lyric chunks to clear readiness. Caption only footage actually supplied, with the named reference context available.

The master mix supplies duration, beats, onsets, and sections. Optional vocal-stem transcription or imported SRT adds lyric grounding; absence of lyrics cannot block story planning, generation, or review. Narrative/performance footage is cut to the master song; accurate generated singing/lip-sync is deferred.

### Match / shuffle naming (current truth)

- **Match** is the user-facing stage: semantic assignment of **video moments** to **story sections** / **edit slots**, with scores and alternates visible (`DESIGN.md` Match UX rules).
- Tab key is still **`shuffle`** — legacy from the old “shuffle clips by motion/color” workflow. The active panel is **`MatchTab`**.
- Legacy panel files (`ShuffleTab`, `BeatSplitTab`, `BeatJoinTab`, `ReviewTab`) are **removed** from the tree; do not reintroduce them.
- **`ShuffleMode`** (`simple` | `size` | `color` | `motion`) is an internal continuity-ranking mode still used in arrangement/preview code — not the same thing as the Match stage.
- **Match mode (product):** simplified to a single **balanced** picker in `MatchTab` (no multi-mode UI). Scoring blends semantic/story fit, lyric alignment, **motion continuity** (camera/movement direction between cuts), motion energy, duration fit, and **color continuity** — motion and color are factors, not separate user-facing modes. Legacy `MatchMode` variants (`motion`, `color`, `energy`, etc.) remain in `matchModes.ts` for scoring helpers only.

### Legacy tab keys (persistence only)

| Tab key | Was | Superseded by |
| --- | --- | --- |
| `beatsplit` | Beat-driven split | `split` (`SplitTab`) |
| `beatjoin` | Beat-driven join | `join` (`JoinTab`) |

`projectPersistence.normalizeLegacyTab` migrates saved drafts. `localStorage` active tab only accepts current `NAV` keys. No runtime branches remain in `StudioApp.tsx`.

---

## Core domain model

Canonical in-memory project shape: **`MusicVideoProject`** (`src/components/studio/musicVideoProject.ts`).

### BeatJoinAnalysis

Normalized audio analysis in the UI: beats, onsets, sections, waveform, duration. Name is legacy (“beat join”) but this is the standard type for “audio analysis” in components. Populated via `audioAnalysis.ts` and `/api/essentia/full`.

_Avoid synonym drift:_ prefer **BeatJoinAnalysis** in code discussions; **audio analysis** in user-facing copy.

### Story anchor

Major story beat in a treatment. Must be resolved before confirming the plan: assign real footage (`source`), mark for Generate (`generate`), or bridge with performance (`omit`). Coverage states: `covered` | `weak` | `missing` (auto-ranked against `VideoMoment` captions).

### Story brief / Story seed

User-authored paragraph (`StoryBrief`) feeding treatment generation. Distinct from per-section **story intent** prompts (filled from anchors after confirmation).

### Story section

Song-structure unit (intro, verse, chorus, bridge, outro, etc.) with prompts and timing. Holds **edit slots** the matcher fills. Prompts are overwritten from confirmed **story anchors** via `applyTreatmentAnchorsToStoryBeats`.

### Edit slot

A story section’s footage assignment target — one selected clip per slot in the lane stack, with ranked alternates by **footage lane** role.

### Lyric chunk

Timed lyric text from Deepgram transcription or imported SRT, aligned to story sections.

### Video moment

Usable visual unit for matching — usually a detected scene with caption metadata (`VideoMoment` in `musicVideoProject.ts`). Overlaps PRD “segment” conceptually but is caption-backed and match-facing.

### Detected scene segment

PySceneDetect output: time range, keyframes, optional color/motion analysis, caption status. Feeds **video moments**.

### Committed split

Persisted source-window cut strategy (`SplitMode`: scene, onset/rhythm, scene+rhythm) for uploaded footage. Optional detailed editing tool, not a readiness prerequisite for a generated draft. Aliases in UI: “Rhythm” = onset; “Scene + Rhythm” = scene-onset. Legacy aliases `beat`, `scene-beat` still parse in `sourceTimeline.ts`.

### Semantic match

Ranked assignment of a video moment to an edit slot (`SemanticClipMatch`), built by `semanticEditPlanner.ts` / `buildSemanticEditPlan`. Exposes score + human-readable reasons.

### Resolved edit / Edit plan preview segment

Join-stage timeline item (`EditPlanPreviewSegment`): the saved sequence in song order shared by review and export. Join supports reviewed swaps and existing-footage replacements with undo. Song windows stay fixed; short replacements leave explicit holes. Playback never reranks sources.

### Generation provenance

The immutable record of the references and conditions that produced a take. A later reference replacement does not change that history.

### Current reference authority

The approved reference version used to evaluate a named character now. It may differ from the version used when an existing take was generated.

### Current-reference assessment

Evaluation of an exact existing take and frame range against the current reference authority. It adds evidence without rewriting generation provenance or granting creative approval.

### Reference replacement

An explicit adoption of a new reference version for the same named character and role while retaining the existing cut. It requires renewed evidence and review for affected takes.

### Generated studio asset

Durable generated media bound to its owner/project, current plan signature, shot requirement, song interval, actual reference versions, and generation configuration. Local MiniMax H3 through SwarmUI is the primary video path. A ready candidate may be automatically selected into a draft while its review state remains `pending`; stale, rejected, failed, or undersized assets cannot clear unsupported coverage.

### Draft selection / approval snapshot

Persisted exact candidate IDs and trims for a particular plan and selection revision. Prepared playback hashes that selection. **Use this draft** approves the snapshot actually reviewed after readiness, bindings, and measured duration validation. Changed candidates, references, timing, or story invalidate affected approval; late job completions cannot replace a newer selection. Final export uses the approved selection, while rough-cut review may show explicit holes.

### Footage lane

Evidence-board role for a clip in a section: `performance`, `camera-a`, `camera-b`, `b-roll`, `generated`, etc. (`trackLaneStack.ts`).

---

## Pipeline and infrastructure terms

### Cut event

Beat, onset, section boundary, or other musical moment eligible for segmentation or edit timing.

### Source clip

User-uploaded video before segmentation.

### Clip manifest

Probe metadata for a source clip: duration, dimensions, fps, codec, keyframes, audio presence, thumbnails.

### Segment manifest

Candidate post-cut segments tied to source media and musical cut events (`segmentManifest.ts`).

### Motion descriptor

Continuity scoring payload: dominant angle/magnitude, coherence, camera motion type, residual motion, provenance (`motionDescriptors.ts`).

### Fit policy

When a segment does not fit a slot: **per-slot policy** — prefer trim to required duration; allow gluing adjacent scenes from the same source when the gap is small; flag manual review when impossible. Speed ramp and reject remain options where the pipeline supports them. Never silently invent footage.

### Section preview

Prepared preview asset for a song section. API: `/api/preview/section`.

### Recompute state

Preview work lifecycle. PRD: fresh/ready, stale, recomputing, cancelled, failed. Code (`sectionRecompute.ts`) also uses `idle`, `swapped` — map to PRD terms when writing user-facing copy.

### Readiness tone

Ingest/Split UI status: `ready` | `processing` | `failed` | `waiting` (green / orange / red / gray).

### Media pipeline v2

Trigger.dev tree for video ingest: scene detect → Qwen/LFM caption batches → finalize manifest in RustFS. Operational detail: `docs/architecture/media-pipeline-v2.md`.

### Media gateway / RustFS

Durable object storage for uploads, scene manifests, and caption artifacts (`src/lib/mediaGateway.ts`).

### Scene caption mode

**Smart** (Qwen3-VL Instruct) is the user-facing default — cinematic, detailed captions for matching. **Fast** (LFM) stays in code but is **hidden behind a dev flag** in the UI; smart is pre-selected for normal users. Remove fast entirely once smart **detail presets** ship.

**Detail presets (v1):** length only — `concise` | `standard` | `cinematic` — same instruct model, different system prompt (ComfyUI-style detail level first; style tags deferred).

**Caption timing:** caption actual supplied scenes after **Char 1 + Environment** references are available. Include lyric context when supplied, but do not wait for a vocal stem/SRT. Zero-footage projects have no source-caption work to perform.

**Story treatments** reuse the same Qwen3-VL stack (multimodal, not a second cloud LLM). See **Story treatment** under workflow stages.

### Vocal stem / SRT

Optional source of lyric phrasing, timed chunks, and metadata for story sections. Deepgram transcription uses an available vocal stem; imported SRT is another option. The app must work from the analyzed master song and section timing alone without inventing lyric text.

### Reference asset / Character bible

Named references are required **before smart captions and Story**. Uploaded in Setup (`ReferenceLibrary` in `IngestTab`). Slots:

- **Character 1** (`character-1`) — primary named character; `displayName` feeds captions and story (**required**)
- **Character 2** (`character-2`) — secondary character when applicable (optional unless duet / two-character video)
- **Environment / location** (`environment`) — recurring set/world (**required**)
- **Supplementary slots** — additional uploads use a **category dropdown** (crowd, environment, style/look, custom, etc.) so the user labels what each sheet is for

Smart captions receive character names, location continuity, and reference images via `buildSceneCaptionSettings()` in `StudioApp.tsx`. Names in captions, story, and generation must match declared names. Minimum reference gate: **Char 1 + Environment**; Char 2 and supplementary sheets depend on the video. H3 jobs carry actual owner-scoped reference bytes and roles through the managed SwarmUI backend, not merely names or browser-supplied workflow paths.

### Story treatment (director pass)

**Confirmed before generating the draft.** Top of `StoryTab` via `StoryTreatmentPlanner` (`StoryTreatmentPlanner.tsx`, `storyTreatments.ts`). Existing confirmed stories are reused rather than restarted.

**Provider:** local **Qwen3-VL Instruct** on the homelab stack — same gateway as smart captions. Story authoring and independent semantic review run through the existing `qwen-story-treatment` Trigger task. Deployment and live inference evidence remain separate acceptance gates.

**Grounding:** the approved brief and music sections define the narrative/timing; supplied lyrics add optional meaning, and actual captions describe existing footage. Each anchor exposes `covered` / `weak` / `missing` evidence. With no source footage, anchors can honestly require generation. Do not invent lyrics, footage, or evidence. Resolving an anchor as `generate` records missing work; resolving an anchor as `omit` does not erase the need to cover its song time with an intentional visual.

**Three treatments:** `faithful`, `bold`, and `wildcard` vary proposals within supplied constraints. The chosen/confirmed treatment becomes canon; no variant or later generation may silently replace approved identities, beat order, or physical continuity. `hydrateTreatmentCoverage` ranks available caption-backed moments.

**Trigger.dev path:** `qwen-story-treatment` on `vm100-heavy` → gateway `/story/treatments/author` then `/story/treatments/review` → local backend. A saved approved story does not require re-authoring to finish its film.

**Storyboard replacement** (Generate stage): `StoryboardPlanner` plans 2K Nano Banana boards and whole-shot replacement from the resolved edit. See `docs/plans/2026-08-30-storyboard-replacement-workflow.md` and `docs/protocols/higgsfield-nano-banana-reference-continuity.md` for creative protocol (canonical over older plans).

### Generate → Join gating (product)

| Signal | Color | Blocks Join? | Meaning |
| --- | --- | --- | --- |
| **Missing** (no eligible source or approved replacement) | Red | **No** | Visible hole in the rough cut; blocks final export until filled |
| **Short source** (primary assigned but shorter than slot) | Purple | **No** | Optional whole-shot replacement review; user may continue; UI should surface the issue clearly |
| **Weak match** (score &lt; 45%) | Yellow | **No** | Optional quality reroll in Generate; not a workflow blocker |

**Primary H3 path:** current shot requirement → reference-bound durable job → local MiniMax H3 through SwarmUI → measured durable candidate → automatic draft selection → assembled-draft review → exact snapshot approval. The existing `local-ai-generation` Trigger task carries this job; no separate provider or new task ID is required.

**Optional Seedance handoff:** storyboard → timing reference → external operator packet → import → review remains an advanced alternative. It is not a prerequisite for local H3 generation or finishing the film. Historical issue #61 describes that older replacement path.

**Continuity review (current):** Match, Generate, Join, Effects, and Export consume the same saved arrangement. Join plays the whole song or a selected section, including timed placeholders for missing shots. Final export requires complete coverage. See ADR-0001 for the distinction between review availability and export readiness.

**Local still generation (two lanes):**

| Lane | Tooling | Role |
| --- | --- | --- |
| **Storyboard / composition boards** | Higgsfield Nano Banana Pro (canonical protocol) | 2×2 / 3×3 grids for whole-shot replacement; grid split via fixed splitter only |
| **Gap-fill stills (local)** | SwarmUI → ComfyUI, **Qwen Image Edit 2511** (see `docs/local-generation.md`) | Reference-conditioned stills without Nano Banana; same ingest **reference assets**, different API surface |

Qwen 2511 reference validation is an optional separate track; it cannot block H3 draft completion. Do not assume Nano Banana prompt/manifest wording ports verbatim to Comfy.

### Composition reference vs quality authority

Rushes are usually **low resolution**. A frame pulled from a matched cut or scene thumbnail is **never** a quality, likeness, or texture authority. Think of it as a **low-res placeholder**: the pipeline **replaces** the grab with sheet-driven identity at full resolution — motion blur, soft focus, and compression artifacts from the clip must not propagate.

| Asset | Role | Controls |
| --- | --- | --- |
| **Character sheet** (Char 1, Char 2) | Quality authority | Identity, face, skin, wardrobe — **who** each person is |
| **Environment sheet** | Quality authority (broad) | Venue type, materials, palette, overall lighting language — **which world** |
| **Crowd / custom sheets** | Quality authority (scoped) | Extras, props — per slot rules |
| **Cut / scene frame** | **Composition reference only** | **Which character is in which position**, blocking, camera angle, screen direction, narrative beat — and **localized placement within the room** (e.g. by the door vs the far wall) when the broad environment sheet alone would be ambiguous |
| **Storyboard grid panel** | Composition audition only | Layout to re-create at 2K — not to upscale or inpaint |

The environment sheet may describe the club in general; the composition reference disambiguates **where in that club** the action happens so prompts do not conflict (e.g. “by the door” vs a different zone). That is still blocking/spatial context, not texture or likeness from the grab.

**Whole-shot replacement** means **re-create the shot** from sheets + composition context, not match, enhance, or continue the muddy frame. Prompts must say: re-render from scratch; do not copy low-res texture or identity from the video grab.

**Video paths:**

| Path | Status | Steps |
| --- | --- | --- |
| **Local MiniMax H3 Ref2VA** | Primary integrated video path; requires fresh live acceptance | Requirement + actual named reference images → managed SwarmUI render → durable candidate → draft review |
| **Manual Seedance** | Optional advanced alternative | Operator packet → external generation → import → review |
| **Still-first / composition boards** | Optional preparation | Fresh sheet-driven still or board when useful; not a mandatory H3 dependency |
| **Local Qwen 2511** | Deferred separate validation | Reference-conditioned still experiments; not a film-completion gate |

Match ranks by **captions and timing**, not thumbnail sharpness. Output quality and identity require viewing actual rendered media. Wrong creative intent requires a revised candidate rather than a sharper source thumbnail. ADR-0002's reference-authority rules continue to apply to every provider.

### Story → Match → Generate acceptance (Love Me Tonight fixtures)

Current acceptance is [finish-music-video](workflows/finish-music-video.md), with the existing-film shot audit in [Love Me Tonight finish plan](docs/plans/2026-11-06-love-me-tonight-finish.md).

1. Preserve the existing analyzed master, approved ten-beat Diego/Valentina story, captions, named references, and useful source placements in a safe project copy.
2. Reuse suitable footage; show true gaps distinctly from optional weak/short review. Fast pacing permits intentional rhythmic 1–3s cuts; Balanced retains its 4s minimum. Never create coverage by replaying the same completed action or source frames.
3. Prove one real public-app H3 job with actual references, durable job/result correlation, measured playable bytes, and visual identity/action/continuity review before batching the song.
4. Prove recovery/reload, exact draft approval, complete approved coverage, and durable full-song export. A zero-footage/master-only fixture must also reach the generation/review path without source-caption or lyric gates.
5. Watch the actual full-song MP4 for musical timing, dynamic high-energy narrative progression, continuity, and unwanted gaps. Tests, task inventories, metadata probes, and technical export success alone do not satisfy creative acceptance.

---

## Donor repo

Reference codebase consulted for patterns (e.g. `svelte-video-shaders`, `freecut`, `review-room`). Not the active product. See `docs/roadmap.md` donor map.

---

## Backlog (maybes)

Not scheduled. Capture product intent here so agents do not re-litigate in session.

| Item | Status | Notes |
| --- | --- | --- |
| **Reference name from sheet (vision)** | Maybe | On reference upload, use Qwen3-VL (caption gateway) to read the printed character or location name from the image and set `displayName`. Sheets will always include a visible name somewhere; filenames are unreliable. Manual edit remains. Until then, user supplies names (e.g. Diego, Valentina, Underground Latin Club). |
| **Project database (Convex-style)** | Maybe | Evaluate a proper DB for project metadata, ingest lanes, media catalog, reference assets, scene/caption manifests, and pipeline job state — similar to **Pindac** and **review-room** (both Convex). Today: RustFS blobs + `project.json` + in-browser state; works for solo use but caused orphaned clips and weak catalog queries. Convex is preferred if we pursue this; not committed — migration cost and dual-write period need a spec first. |
| **Ingest parallelism tuning** | Maybe | Investigate whether current parallelism helps or hurts wall-clock time. Today: up to 3 scene-detect children at once, but Qwen captioning is globally serial (`vm100-heavy` concurrency 1) and batches run scenes sequentially inside each child. Parallel scene detect can pile work into the GPU queue and increase wait time vs a simpler one-clip-at-a-time flow. Measure queue wait vs runtime before changing limits. **Out of scope:** routing work to a second remote GPU — the production caption worker stays a single queue to avoid ops confusion. |
| **Section-level preview** | Implemented; browser acceptance in progress | Join plays a selected song section or the full saved arrangement; Generate retains cut and section audition. |
| **Qwen Image Edit 2511 reference validation** | Deferred | Separate still-conditioning experiments; not required for MiniMax H3 film completion. |
| **Studio cleanup (2026-09)** | Historical plan | [September checklist](docs/plans/2026-09-06-studio-story-match-generate-checklist.md) records the earlier manual-provider scope. Current work follows `workflows/finish-music-video.md`. |

---

## Planning doc index (background)

| Doc | Role |
| --- | --- |
| `docs/product/creative-production-brief.md` | Vision, creative roles, donor research |
| `workflows/finish-music-video.md` | Current agreed workflow, scope, and end-to-end acceptance |
| `docs/adr/0003-minimax-draft-first-completion.md` | Four-step, master-first, local-H3 and draft-review decision |
| `docs/plans/2026-11-06-love-me-tonight-finish.md` | Preserve-existing shot coverage and creative acceptance plan |
| `docs/product/music-video-ui-workflow-overhaul.md` | Historical detailed-tool layout; original stage gates superseded |
| `docs/plans/prd-roadmap-spec-workflow-docs.md` | Historical PRD + requirements index |
| `docs/roadmap.md` | Phased delivery phases 0–5 |
| `DESIGN.md` | UI language + Match evidence rules |

Archived: `docs/plans/roadmap-spec-workflow-docs-20260405T010154Z.md` — ignore.
