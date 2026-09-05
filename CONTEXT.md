# CONTEXT — Project Stack Structure

Living domain glossary for agents and implementers. Co-canonical with `docs/product/creative-production-brief.md` and `docs/product/music-video-ui-workflow-overhaul.md`. The June 2026 PRD (`docs/plans/prd-roadmap-spec-workflow-docs.md` §3) seeded this file; when terms conflict, **this file wins**.

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

### Upload-first, generate-to-fill

Real uploaded footage is primary. **Generate** fills gaps or weak slots only after the user has reviewed matches — it does not replace approved real footage by default.

### Web-first studio

Browser UI + server GPU workers (Essentia, scene detect, captions, FFmpeg, Trigger.dev). Desktop/Tauri is contingent on benchmark evidence, not assumed.

---

## Workflow stages

Eight guided stages. **Tab key** is the internal `Tab` enum value in code; **UI label** is what users see. Legacy tab keys still exist in types and persistence but are **not** in the nav.

| Step | UI label | Tab key | Panel component | Ready when |
| --- | --- | --- | --- | --- |
| 1 | Ingest | `review` | `IngestTab` | **All lanes complete:** song analyzed, vocal stem/SRT transcribed, character + location reference sheets uploaded to RustFS, clips uploaded, scenes detected, smart captions ready (with named characters/locations in context), storage synced |
| 2 | Story | `story` | `StoryTab` | Treatment chosen + all anchors resolved + story plan confirmed + section map ready |
| 3 | Split | `split` | `SplitTab` | Source-window strategy chosen (commits automatically while the stage is open) |
| 4 | Match | `shuffle` | `MatchTab` | Every edit slot has a reviewed semantic match |
| 5 | Generate | `generate` | `GenerateTab` | No required coverage gaps (purple short-source and yellow weak-match review are optional) |
| 6 | Join | `join` | `JoinTab` | Approved match timeline assembled in song order |
| 7 | Effects | `ramp` | `RampTab` | Join timeline exists; effects reviewed |
| 8 | Export | `compose` | `ComposeTab` | Final preview/export assets usable |

Pipeline gating: `src/components/studio/studioPipeline.ts` (`buildPipelineState`). **Story hard gate:** lyrics/transcript required — the API cannot reliably extract vocals from the master mix; Deepgram needs the vocal stem for phrasing and SRT chunks that drive story sections.

**Ingest UX:** show per-lane readiness (green/orange/red) while the user works, but **do not unlock Story** until every required lane is complete. The user may browse later tabs, but story map generation and captioning that names characters depend on reference assets + lyrics being present first.

**Code gap (2026-09):** `ingestReady` today does not check reference assets or transcript; `storyReady` checks transcript but not references. Product intent requires both — pipeline gating should be tightened to match.

### Match / shuffle naming (current truth)

- **Match** is the user-facing stage: semantic assignment of **video moments** to **story sections** / **edit slots**, with scores and alternates visible (`DESIGN.md` Match UX rules).
- Tab key is still **`shuffle`** — legacy from the old “shuffle clips by motion/color” workflow. The active panel is **`MatchTab`**, not `ShuffleTab`.
- **`ShuffleTab`**, **`BeatSplitTab`**, **`BeatJoinTab`**, and **`ReviewTab`** are orphaned panel files (not imported by `StudioApp.tsx`). Do not wire new work to them; safe to delete in a cleanup pass.
- **`ShuffleMode`** (`simple` | `size` | `color` | `motion`) is an internal continuity-ranking mode still used in arrangement/preview code — not the same thing as the Match stage.
- **Match mode (product):** simplified to a single **balanced** picker in `MatchTab` (no multi-mode UI). Scoring blends semantic/story fit, lyric alignment, **motion continuity** (camera/movement direction between cuts), motion energy, duration fit, and **color continuity** — motion and color are factors, not separate user-facing modes. Legacy `MatchMode` variants (`motion`, `color`, `energy`, etc.) remain in `matchModes.ts` for scoring helpers only.

### Legacy tab keys (nav removed, code paths remain)

| Tab key | Was | Superseded by |
| --- | --- | --- |
| `beatsplit` | Beat-driven split | `split` (`SplitTab`) |
| `beatjoin` | Beat-driven join | `join` (`JoinTab`) |

`StudioApp.tsx` still contains run/preview branches for these keys. Treat as cleanup debt, not active workflow.

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

Persisted source-window cut strategy (`SplitMode`: scene, onset/rhythm, scene+rhythm). Required before Match unlocks. Aliases in UI: “Rhythm” = onset; “Scene + Rhythm” = scene-onset. Legacy aliases `beat`, `scene-beat` still parse in `sourceTimeline.ts`.

### Semantic match

Ranked assignment of a video moment to an edit slot (`SemanticClipMatch`), built by `semanticEditPlanner.ts` / `buildSemanticEditPlan`. Exposes score + human-readable reasons.

### Resolved edit / Edit plan preview segment

Join-stage timeline item (`EditPlanPreviewSegment`): the locked sequence in song order for preview and export. Join does not silently reshuffle — changes go back through Match or Generate.

### Generated studio asset

AI-generated clip (Higgsfield, Seedance, etc.) used as gap-fill or replacement. Lives in Generate stage; may map to footage lane `generated`.

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

**Caption timing:** block smart caption jobs until **Char 1 + Environment + vocal stem/SRT** are uploaded; run captions once with full character, location, and lyric context. Do not auto-caption immediately after scene detect when refs or stem are missing.

**Story treatments** reuse the same Qwen3-VL stack (multimodal, not a second cloud LLM). See **Story treatment** under workflow stages.

### Vocal stem / SRT

Required before **Story** unlocks (product intent: complete during Ingest). Deepgram cannot extract vocals from the master mix. Provides lyric phrasing, timed chunks, and metadata for story sections.

### Reference asset / Character bible

Required **before smart captions and Story**. Uploaded in Ingest (`ReferenceLibrary` in `IngestTab`). Slots:

- **Character 1** (`character-1`) — primary named character; `displayName` feeds captions and story (**required**)
- **Character 2** (`character-2`) — secondary character when applicable (optional unless duet / two-character video)
- **Environment / location** (`environment`) — recurring set/world (**required**)
- **Supplementary slots** — additional uploads use a **category dropdown** (crowd, environment, style/look, custom, etc.) so the user labels what each sheet is for

Smart captions receive character names, location continuity, and reference images via `buildSceneCaptionSettings()` in `StudioApp.tsx`. Names in captions must match names used in the story map. Minimum hard gate before captions/Story: **Char 1 + Environment**; Char 2 and supplementary sheets depend on the video.

### Story treatment (director pass)

**Required before Split.** Top of `StoryTab` via `StoryTreatmentPlanner` (`StoryTreatmentPlanner.tsx`, `storyTreatments.ts`).

**Provider (target — replace OpenAI):** local **Qwen3-VL Instruct** on the homelab stack — same model and gateway as smart captions. One model: **scene captions** (multimodal, per scene storyboard) then **story treatments** (text-in, JSON-out).

**Grounding rule:** Story must be **caption-grounded**, not invented. Ingest already ran Qwen on each scene storyboard; those captions are the evidence catalog of what exists (e.g. river/drowning vs fire). The story director pass reads **caption text + user brief + lyrics/sections** — it does **not** re-send video frames. If a beat is not supported by any caption, mark it as generate/omit later; do not write a story about imagery that is not in the rushes.

**Three treatments (existing UI):** `faithful` (user brief is canon), `bold` (location/system as antagonist), `wildcard` (late reveal). User picks one; `hydrateTreatmentCoverage` then ranks anchors against `VideoMoment` captions.

**Trigger.dev path:** new `qwen-story-treatment` task on `vm100-heavy` → caption gateway text route → same llama.cpp backend. Do not change scene detection, caption batches, or match/join pipelines.

**Current code gap:** Story treatments now dispatch through Trigger + local Qwen (`qwen-story-treatment` → gateway `/story/treatments`). Deploy the updated caption gateway to homelab before production use.

**Storyboard replacement** (Generate stage): `StoryboardPlanner` plans 2K Nano Banana boards and whole-shot replacement from the resolved edit. See `docs/plans/2026-08-30-storyboard-replacement-workflow.md` and `docs/protocols/higgsfield-nano-banana-reference-continuity.md` for creative protocol (canonical over older plans).

### Generate → Join gating (product)

| Signal | Color | Blocks Join? | Meaning |
| --- | --- | --- | --- |
| **Missing** (no primary match) | Red | **Yes** | True coverage hole — return to Match or approve a generated import |
| **Short source** (primary assigned but shorter than slot) | Purple | **No** | Optional whole-shot replacement review; user may continue; UI should surface the issue clearly |
| **Weak match** (score &lt; 45%) | Yellow | **No** | Optional quality reroll in Generate; not a workflow blocker |

**Seedance external handoff order** (whole-shot replacement): select resolved cut → **2×2 storyboard frame grid** for that section (Nano Banana) → prepare Video_1 timing reference → copy operator packet → generate externally → import completed clip → approve exactly one candidate for Join. Storyboard is the first creative step; the current Generate UI buries this flow and needs clearer step-by-step guidance (see GitHub issue #61).

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
| **Ingest parallelism tuning** | Maybe | Investigate whether current parallelism helps or hurts wall-clock time. Today: up to 3 scene-detect children at once, but Qwen captioning is globally serial (`vm100-heavy` concurrency 1) and batches run scenes sequentially inside each child. Parallel scene detect can pile work into the GPU queue and increase wait time vs a simpler one-clip-at-a-time flow. Measure queue wait vs runtime before changing limits. **Out of scope:** routing work to the local 5090 as a second remote GPU — homelab VM100 stays the single caption worker to avoid ops confusion. |

---

## Planning doc index (background)

| Doc | Role |
| --- | --- |
| `docs/product/creative-production-brief.md` | Vision, creative roles, donor research |
| `docs/product/music-video-ui-workflow-overhaul.md` | UI layout + gating (7 stages; Generate added in code as stage 5) |
| `docs/plans/prd-roadmap-spec-workflow-docs.md` | Historical PRD + requirements index |
| `docs/roadmap.md` | Phased delivery phases 0–5 |
| `DESIGN.md` | UI language + Match evidence rules |

Archived: `docs/plans/roadmap-spec-workflow-docs-20260405T010154Z.md` — ignore.
