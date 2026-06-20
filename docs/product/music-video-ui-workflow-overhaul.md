# Music Video UI Workflow Overhaul

Status: approved for implementation by user on 2026-06-19.

## Product direction

The current UI proves the pipeline but is not yet the desired consumer workflow. The overhaul keeps the valuable persistence behavior while simplifying the workflow into ordered stages.

## Layout principles

- The video preview/player stays persistent while moving through workflow steps.
- The master waveform/timeline stays persistent while moving through workflow steps.
- The master waveform should remain full-width relative to the main work area; it should not be crushed by a permanent half-screen side panel.
- Preview can be docked and expandable/focusable, but should not permanently consume too much horizontal workspace.
- Users may move back and forth to inspect work, but forward actions are gated by required outputs.

## Workflow stages

Replace the flat 9-tab model with a guided sequence:

1. **Ingest** — master song, vocal stem, videos, RustFS upload, audio analysis, SRT, scene detection, video captioning.
2. **Story** — song sections, story beats, SRT/lyric windows, section prompts.
3. **Split** — one split stage with scene split, beat split, onset split, and hybrid split modes.
4. **Match** — lyric/story sections matched to video scene captions, semantic/action/motion/color scoring, missing-match warnings.
5. **Join** — one assembly stage with shuffle/rebuild, semantic continuity, motion continuity, color continuity, beat/onset energy, lock/unlock clips.
6. **Transitions / Effects** — replaces Speed Ramp as the home for speed ramps, transitions, GLSL/WebGPU shader effects, stutter effects, and per-cut effect cues.
7. **Preview / Export** — final preview, source audio toggle, MP4 export, WebGPU/shader capture export, download.

## Consolidation rules

- There should be one **Split** tab, not separate Standard Split and Beat Split tabs.
- There should be one **Join** tab, not separate Shuffle, Standard Join, and Beat Join tabs.
- Speed Ramp should become **Transitions / Effects / GLSL Shader**, not a speed-only main workflow tab.

## Processing visibility

The app should show clear readiness states:

- Green: returned and ready to use.
- Orange: processing.
- Red: failed or missing.
- Muted/gray: waiting for prior step.

Video processing needs first-class visibility, similar to master audio and vocal stem:

- uploaded video count
- RustFS upload/storage status
- scene detection progress
- caption progress
- caption manifest/storage status
- per-cut first-frame thumbnail
- per-cut caption text
- errors in red

## Gating policy

Use soft-gated navigation and hard-gated actions:

- Users can click ahead to understand the workflow.
- Actions remain disabled until required outputs exist.
- Locked panels explain exactly what is missing.

Examples:

- Split actions require uploaded videos.
- Match actions require lyrics/SRT and video captions.
- Join actions require match/edit plan data.
- Export actions require generated preview/final timeline.

## First implementation slice

The first approved implementation slice should:

- Update navigation labels/order to the new consumer workflow.
- Preserve existing backend/domain contracts.
- Add an Ingest readiness panel for audio, stem/SRT, videos, scenes, captions, and storage.
- Consolidate user-facing split/join labels while keeping compatible internal keys if necessary.
- Rename/reframe Speed Ramp to Transitions / Effects.
- Make video caption/cut readiness more visible with green/orange/red statuses and thumbnails where data already exists.
- Avoid deleting advanced logic; move/relabel it into the new workflow structure.

## Verification targets

- `bun run check` passes.
- `bun run build` passes.
- Browser smoke test shows the new workflow labels and Ingest readiness UI.
- Fixture media can still upload/analyze at least through visible readiness states.
- No regression that removes persistent preview/waveform behavior.
