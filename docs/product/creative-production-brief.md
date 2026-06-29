# Creative Production Brief — Smart Music-Video Editor

## Status
Current product brief for `project-stack-structure`.

This document restores the full planning shape behind the roadmap: the original question/answer workflow, pressure pass, donor-repo research, and creative-production roles. It is meant to be readable by the user, future agents, and implementation workers before they touch code.

## One-Line Direction
Build a music-first auto-editing studio: the user gives the app a song, lyrics/vocal timing, and video clips; the app understands the song structure, logs usable video moments, matches footage to lyrics/story/sections, and prepares a rough music-video edit that stays locked to the music.

## Product Class
This is not just a clip shuffler and not a full NLE.

It is a creative production stack:

1. Music analysis spine
2. Lyric/timing spine
3. Video moment logging spine
4. Story/treatment spine
5. Matching/edit-director spine
6. Preview/render spine
7. Review/critique loop

The app should feel like a small production team built into a web studio.

---

# 1. Brownfield Starting Point

## Active app
`/root/Github/project-stack-structure`

Keep this as the main app. Do not restart greenfield.

## Existing anchors
- `src/components/StudioApp.tsx` — studio shell
- `src/components/studio/audioAnalysis.ts` — Essentia-style audio analysis normalization
- `src/components/studio/mediaUpload.ts` — video ingest, metadata, thumbnails
- `src/components/studio/sourceTimeline.ts` — source timeline / segment logic
- `src/components/studio/segmentManifest.ts` — music-driven segment manifest
- `src/components/studio/motionDescriptors.ts` — motion descriptor contract
- `src/components/studio/motionRanking.ts` — ranking policy
- `src/components/studio/sectionRecompute.ts` — recompute lifecycle
- `src/components/studio/previewGeneration.ts` — prepared preview generation
- `src/components/studio/musicVideoProject.ts` — music/lyrics/story/edit-plan model
- `src/components/studio/panels/StoryTab.tsx` — story page / song-section workflow
- `src/app/api/essentia/full/route.ts` — audio-analysis proxy
- `src/app/api/media/video/jobs/route.ts` — RustFS-backed scene split integration
- `src/app/api/ffglitch/route.ts` — FFglitch capability/proxy route

## Existing product principles
1. Musical alignment first.
2. Motion continuity second.
3. Segment-level analysis over whole-clip guessing.
4. Prepared preview over fake live playback.
5. Explicit recompute/readiness states.
6. Web-first until benchmark evidence says otherwise.
7. React/Next is the studio shell, not the frame-accurate playback clock.

---

# 2. Original Question → Answer Workflow

## Round 1 — Intent

Question:
What is the single primary outcome this app is supposed to deliver, and for whom?

Answer:
The app should become a smart auto music-video editor. The user uploads a song, gets rich analysis back from the hosted analysis endpoint, uploads video clips, and has them chopped/reorganized by music and visual attributes — especially motion — so clips flow together and stay musical. The app should work by song sections such as intro, verse, pre-chorus, chorus, bridge, and outro.

Decision:
The product is an audio-driven, section-aware, motion-sensitive auto music-video editor.

## Round 2 — Non-Goals

Question:
For the first serious version, what should the roadmap/spec explicitly exclude, even if useful?

Answer:
The first serious version should prove:
- audio can load and be analyzed,
- useful song data is visualized,
- parameters can be adjusted,
- videos can be loaded, decoded, chopped, and previewed,
- the user can iterate on sections/chunks.

It does not need:
- final export as the first proof,
- auth,
- billing,
- collaboration,
- model fine-tuning,
- professional NLE timeline depth,
- mobile app delivery.

Decision:
First milestone is not “ship an editor.” First milestone is “prove reliable analysis, moment logging, section planning, and musically correct preview.”

## Round 3 — Decision Boundaries

Question:
What can the planning workflow decide without asking again, and what must remain the user’s call?

Answer:
The workflow may decide:
- documentation structure,
- roadmap phases,
- research approach,
- script/protocol recommendations,
- web-first vs desktop-contingent architecture recommendation,
- removal or archival of stale planning references.

The user should still decide:
- major product priority changes,
- whether final export moves into MVP,
- whether desktop/Tauri becomes the main app,
- what visual/creative direction feels right after seeing the working preview.

Decision:
Agents may keep planning and execution moving, but must preserve musicality, story alignment, and verification evidence.

## Round 4 — Pressure Pass: “Zero Latency”

Question:
What does “zero latency” practically mean for the first serious version, and what behavior would make the architecture unacceptable?

Answer:
“Zero latency” does not mean every slider must mutate the video live. The user prefers an explicit “recomputing this section” state with progress over fake live playback that falls behind. Playback must be smooth and musically aligned once ready.

Unacceptable behavior:
- lag causes clip switches to miss beat accents,
- preview no longer feels audio-driven,
- stale preview pretends to be current,
- background analysis races active playback,
- UI gives no useful progress/status.

Decision:
Use prepared section previews and visible recompute states. For rapid-cut live preview, build a separate low-latency engine instead of driving frame timing through React state.

## Refinement — Motion Analysis

User pressure:
Do not use coarse direction tags as the real engine.

Decision:
Motion descriptors should prefer:
- global motion field,
- residual motion after camera-motion estimation,
- continuity score between joins,
- motion magnitude/coherence/confidence.

Accuracy beats quick scan.

## Refinement — Ranking and Fit

User pressure:
Music is always first. Motion continuity is the main default visual rejoin mode.

Decision:
Ranking order:
1. Musical alignment
2. Motion continuity
3. Color/mood continuity
4. Random/experimental ordering

Allowed fit fallbacks:
- slight trim,
- speed ramp in/out,
- reject placement,
- layered overlap when architecture supports it.

---

# 3. Donor-Repo Research: What We Are Taking

## `project-stack-structure`
Role: primary app.

Keep:
- Next/React studio shell,
- audio analysis proxy,
- manifest/ranking/recompute contracts,
- preview generation,
- story/edit-plan work.

## `svelte-video-shaders`
Role: major runtime and creative-interaction donor.

Use for:
- WebCodecs predecoded frame buffer,
- instant random frame access,
- audio-as-master-clock playback,
- section clip buckets,
- section waveform overlays,
- trigger system: onsets + MIDI + density + deterministic skip,
- energy-curve speed remap preprocessing,
- shader/effect catalogue,
- Deepgram/SRT/Kimi/auto-edit path from the M3 copy.

Important staged copy:
`/root/Github/_incoming/m3/svelte-video-shaders`

Important donor files from the M3 state:
- `src/lib/deepgram-utils.js`
- `src/lib/srt-utils.js`
- `src/lib/kimi-story-engine.js`
- `src/lib/auto-edit.js`
- `src/lib/story-prompt-utils.js`
- `src/lib/srt-auto-edit.test.js`
- `src/lib/webcodecs-frame-buffer.js`
- `src/lib/VideoWorkbench.svelte`

## `stutter-blaster`
Role: strongest rhythm/runtime reference.

Use for:
- Essentia API client patterns,
- analysis cache,
- audio master clock,
- beat/onset quantization,
- loudness filtering,
- musical moments,
- scheduler/worklet ideas,
- A/V sync helpers,
- WebCodecs frame decode/cache,
- WebGPU compositor.

## `video-timeshaper`
Role: audio-reactive preview/remap reference.

Use for:
- audio feature extraction,
- envelope/transient/low/mid/high band features,
- time engine,
- edit engine,
- trigger ordering,
- speed-curve preprocessing,
- curve editor.

## `auto-video-scrambler`
Role: backend processing and motion continuity reference.

Use for:
- beat split / beat join / shuffle / speed ramp behavior,
- FFmpeg processing patterns,
- job model,
- motion-vector extraction,
- motion-sequence sorting.

## `fftron-sync`
Role: music-performance scheduling reference.

Use for:
- onset switch scheduling,
- rapid cut timing,
- time-shaper algorithms,
- music-first switching behavior.

## `review-room`
Role: reviewer-development app and client-facing media review workflow donor.

This is the “reviewer app” reference: not an editor, but a polished review room where media is the hero.

Use for:
- premium dark client-facing review feel,
- media cards and fast browsing,
- hover scrub / quick inspection patterns,
- ratings, shortlist/selects, comments, approvals, status/facets,
- smart views driven by metadata instead of manual board dragging,
- restrained UI where the footage stays central.

Important docs:
- `/root/Github/review-room/init-docs/00-Creative-Brief.md`
- `/root/Github/review-room/init-docs/01-PRD.md`
- `/root/Github/review-room/init-docs/02-Design-Spec.md`

Do not copy its “not an editor” limitation into this project. For this project, copy the review/workflow feel and media browsing patterns, then combine them with the editor/runtime donors below.

## `freecut`
Role: browser media/runtime/editor primitives donor.

This is one of the main places to study how a serious browser editor handles video.

Use for:
- timeline schema ideas,
- media library import/proxy/thumbnails,
- hover/scrub/preview handoff patterns,
- audio fade curves,
- source calculations,
- browser-local preview/runtime paths,
- WebCodecs/WebGPU/export pipeline ideas,
- optical flow / scene detection reference.

Important areas:
- `/root/Github/freecut/src/runtime/`
- `/root/Github/freecut/src/features/timeline/`
- `/root/Github/freecut/src/shared/state/playback/`
- `/root/Github/freecut/src/features/export/`

## `MasterSelects`
Role: successful high-end preview/playback/render-target donor.

Use for:
- WebGPU preview architecture,
- RAM preview caching,
- source monitor behavior,
- multi-preview/output windows,
- render target registration,
- playback health/debug monitoring,
- fallback behavior when browser video paths are fragile,
- native helper contingency patterns.

Important areas:
- `/root/Github/MasterSelects/docs/Features/Preview.md`
- `/root/Github/MasterSelects/src/engine/`
- `/root/Github/MasterSelects/src/services/ramPreviewEngine.ts`
- `/root/Github/MasterSelects/src/components/preview/`
- `/root/Github/MasterSelects/tools/native-helper/`

MasterSelects is evidence that the preview/rendering side can be treated as a serious engine, not just a React component.

## `audio-ui-curves`
Role: ramp/envelope UI donor.

Use for:
- curve controls,
- speed ramp UX,
- envelope visualization.

## `storyception`
Role: story/treatment layer reference.

Use for:
- story arc over sections,
- treatment generation,
- visual motif planning.

---

# 4. Creative Production Workflow

Use a BMAD-inspired workflow, adapted for music-video production.

## Phase A — Brownfield Inventory
Goal: know what already exists before inventing schemas.

Questions:
- What code already exists?
- Which services already work?
- Which repo is the active product?
- Which repos are donors only?
- What contracts already exist?

Output:
- source map,
- donor map,
- active repo decision,
- risk list.

## Phase B — Creative Product Brief
Goal: state the real product and MVP.

Questions:
- Is this a web studio, CLI pipeline, or both?
- What does a successful first preview look like?
- What media does the user provide?
- What does the AI need to generate a story?
- How much manual override is required?

Output:
- product brief,
- non-goals,
- success criteria,
- pressure-pass decisions.

## Phase C — Architecture Spine
Goal: define the data and engine boundaries before coding.

Questions:
- What is the canonical audio analysis schema?
- What is the lyric chunk schema?
- What is the video moment schema?
- What is the edit plan/timeline schema?
- What must stay outside React state?
- What is prepared FFmpeg preview vs low-latency engine preview?

Output:
- architecture doc,
- schema contracts,
- engine boundaries,
- verification gates.

## Phase D — Epics and Stories
Goal: cut the work into implementation slices.

Questions:
- What can be tested in pure TypeScript first?
- What needs browser verification?
- What needs real media fixtures?
- What is safe for subagents?
- What proof is required before “done”?

Output:
- implementation stories,
- test specs,
- verification commands,
- browser QA checklist.

## Phase E — Review Critique
Goal: test the creative result, not just the code.

Questions:
- Do cuts land near beats/downbeats?
- Do lyrics and visuals make sense together?
- Does chorus/drop feel bigger than verse?
- Are clips repeated too much?
- Are captions synced?
- Are there black frames, silence, loudness issues, drift, or stale previews?

Output:
- review report,
- edit-plan patches,
- rerender requests,
- next creative pass.

---

# 5. Creative Agent Roles

## Executive Producer / PM
Owns:
- goal,
- MVP,
- scope,
- success criteria,
- product decisions.

Key question:
What is the first version that proves the idea without becoming a full NLE?

## Music Analyst
Owns:
- BPM,
- beats,
- downbeats,
- onsets,
- sections,
- energy curve,
- Deepgram timing,
- lyric chunks.

Key question:
Where does the song want the edit to move?

## Video Moment Logger
Owns:
- clip ingest,
- ffprobe,
- scene detection,
- thumbnails,
- visual summaries,
- motion/intensity/color/person/object descriptors.

Key question:
What usable visual moments exist, and when do they fit?

## Edit Director
Owns:
- story treatment,
- motif recurrence,
- section-to-visual matching,
- chorus impact,
- visual variety,
- pacing.

Key question:
Why is this clip here, for this lyric, at this musical moment?

## Renderer Engineer
Owns:
- FFmpeg concat/render,
- prepared preview,
- captions,
- loudness,
- Remotion/polish path,
- low-latency engine boundary.

Key question:
Can we produce a preview that is musically correct and reviewable?

## Review Critic / QA
Owns:
- drift checks,
- invalid timestamps,
- repeated clips,
- caption sync,
- beat alignment,
- black frames,
- silence/loudness,
- UX status clarity.

Key question:
What makes this feel wrong, even if the code technically passed?

## Technical Writer / Archivist
Owns:
- source maps,
- schemas,
- decisions,
- roadmap,
- change log,
- donor-repo evidence.

Key question:
Can the next agent understand why the current plan exists?

---

# 6. What the AI Needs From the User

Minimum for story generation:

1. Song audio or analysis
2. Lyrics or Deepgram transcript/SRT/word timing
3. Song structure sections, either detected or user-edited
4. Video clips or generated clip moments
5. Optional creative direction: mood, genre, visual style, story premise

Best input package:

```text
audio/song.wav
lyrics/deepgram.json or lyrics.srt
clips/raw/*
analysis/audio_sections.json
analysis/beat_grid.json
analysis/lyric_chunks.json
analysis/clip_moments.json
brief/style.md
```

The AI should produce:

```text
story/treatment.md
edit/edit_plan.json
edit/timeline.json
review/qa_report.md
renders/preview.mp4
```

---

# 7. Current Next Work

## Slice 1 — Source Map and Research Landing Page
Make the current docs point to the donor-repo research and this brief.

Proof:
- README links this brief.
- Roadmap names donor roles.
- No one has to hunt through archived chat/context to find the plan.

## Slice 2 — Song/Story Input Contract
Unify:
- Essentia analysis,
- Deepgram chunks,
- Kimi treatment,
- section labels,
- visual moments,
- edit plan.

Proof:
- unit tests around `musicVideoProject.ts`.
- Story page demo still works.

## Slice 3 — Fast Trigger Schedule
Build pure TypeScript schedule from:
- beats,
- onsets,
- sections,
- MIDI markers when available,
- density/min spacing,
- deterministic seed/skip.

Proof:
- tests down to rapid-cut intervals.
- React is not required for frame timing.

## Slice 4 — Low-Latency Engine Shell
Create an imperative engine that owns:
- audio master clock,
- trigger cursor,
- active section,
- active clip/moment decision,
- throttled UI snapshots.

Proof:
- engine can simulate clip/frame decisions without renderer.
- snapshots update UI at coarse cadence only.

## Slice 5 — WebCodecs Frame Buffer Prototype
Adapt donor idea from `svelte-video-shaders`.

Proof:
- decode count and memory are visible,
- random frame access works for small fixture clips,
- fallback to prepared preview remains available.

## Slice 6 — Renderer / Review Preview
Render schedule decisions to canvas/WebGL or prepared FFmpeg preview.

Proof:
- preview lands on musical accents,
- late-trigger counters or recompute state visible,
- review critic can evaluate story/lyric/visual alignment.

---

# 8. Pressure Checklist Before Any Implementation Slice

Before coding, answer:

1. What user-visible outcome does this slice improve?
2. Which song section / lyric / visual moment workflow does it support?
3. Does it preserve musical alignment first?
4. Does it keep frame-accurate timing outside React state?
5. Does it make stale/recompute states clearer?
6. Which donor repo is informing it?
7. What is the test proof?
8. What is the browser/manual proof?
9. What can fail, and how will the user see that failure?
10. Does this move us closer to a reviewable rough music-video edit?

If those questions cannot be answered, the slice is not ready.
