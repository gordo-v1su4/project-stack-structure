# Current Product Goal Spec — Smart Auto Music Video Editor

## Metadata
- Updated: 2026-06-18 UTC
- Status: current source spec
- Active repo: `project-stack-structure`
- Supersedes: older April 2026 deep-interview notes in this file

## Standing Goal
Build `project-stack-structure` into a smart, web-first auto music-video editor where the user supplies one song and a set of video clips, the system analyzes the song, prepares music-aligned section previews, ranks candidate clips/segments by musical fit first and motion continuity second, and gives the user an explicit recompute/preview workflow that stays musically correct.

The product is not trying to be a full professional NLE. It is a music-first auto-editing studio: upload audio, upload clips, analyze, segment, rank, recompute sections, preview prepared assets, refine parameters, and eventually export.

## Desired End State
A successful product state means:

1. The app accepts a source audio track and user-supplied video clips.
2. Hosted or proxied audio analysis returns normalized beats, onsets, sections, waveform, and useful musical metadata.
3. Video ingest probes clips into a canonical manifest with duration, codec/container, dimensions, fps, keyframe/audio presence, and thumbnail/supporting metadata.
4. Candidate segments are derived from music-driven cut events, not arbitrary fixed-duration chunks.
5. Post-cut segments receive descriptor data suitable for ranking and continuity checks.
6. Ranking always preserves musical alignment first.
7. Motion continuity is the default visual continuity mode after musical fit.
8. Section preview generation is explicit: stale → recomputing → ready/cancelled/failed.
9. Playback only consumes ready prepared preview assets, never half-computed state.
10. UI surfaces progress, stale states, errors, and readiness instead of pretending edits are live when they are recomputing.
11. Benchmarks and latency evidence decide whether the web-first path remains viable or a Tauri/sidecar pivot is required.
12. Agents can implement slices from this spec without reopening product direction.

## Non-Negotiable Product Rules

1. **Musical alignment first.** Beat/onset/section alignment outranks every visual heuristic.
2. **Motion continuity second.** Motion continuity is the default visual continuity mode, not random ordering.
3. **Prepared preview over fake real time.** If a change requires recompute, show recompute state and swap only when ready.
4. **Segment-level analysis.** The atomic unit for ranking is the post-cut segment, not only the whole source clip.
5. **Accuracy over shallow quick scan.** Avoid simplistic whole-clip/cardinal-direction tags as the primary engine.
6. **Web-first until evidence says otherwise.** Stay in Next.js/browser workflow unless benchmark evidence proves it cannot preserve musical correctness.
7. **Reference repos are references.** `svelte-video-shaders` can inform low-latency/WebCodecs ideas but is not the active product repo.
8. **No secret leakage.** Agents must not print or commit credentials, tokens, or local secret values.

## Current Brownfield Context

Active repo anchors:

- `src/components/StudioApp.tsx` — main studio UI/control shell.
- `src/components/studio/audioAnalysis.ts` — audio analysis and waveform normalization.
- `src/components/studio/mediaUpload.ts` — browser-side video metadata and thumbnail preparation.
- `src/components/studio/previewGeneration.ts` — preview/concat generation integration.
- `src/components/studio/ffglitchApi.ts` — FFglitch integration.
- `src/app/api/essentia/full/route.ts` — hosted audio-analysis proxy.
- `src/app/api/ffglitch/route.ts` — FFglitch proxy/capability route.
- `docs/architecture/media-pipeline.md` — current media-pipeline architecture.
- `docs/roadmap.md` — current roadmap, to be kept in sync with this source spec.

Package scripts currently include:

- `bun run dev`
- `bun run build`
- `bun run start`
- `bun run lint`
- `bun run test`
- `bun run typecheck`
- `bun run check`
- `bun run probe:media`
- `bun run preview:section`
- `bun run bench:latency`
- `bun run bench:compare`

## Primary User Journey

**UJ-1. Creator generates a musically aligned section preview.**

A creator opens the studio, uploads a song, uploads source video clips, runs or reuses audio analysis, and sees song sections/waveform structure. The app probes clips and prepares candidate segments around musical events. The creator selects a section or changes parameters. The UI marks that section stale/recomputing, generates a prepared preview asset, then swaps it into playback only when ready. The creator previews a section that cuts on musical events and preserves motion continuity where possible.

Value is delivered when the preview feels musically locked and visually coherent without the user hand-editing every cut.

## Agent Success Definition

An implementation agent succeeds when it can:

1. Identify the relevant FR/story before editing.
2. Keep edits inside the active repo: `project-stack-structure`.
3. Use `svelte-video-shaders` only as a reference when explicitly useful.
4. Run real verification commands or browser checks.
5. Report actual output and blockers, not assumptions.
6. Avoid broad redesign unless the story requires it.
7. Preserve musical correctness and recompute-state rules.
8. Avoid exposing secrets.

## Out of Scope for MVP

- Auth, billing, collaboration.
- Mobile app.
- Full professional timeline/NLE feature set.
- Model training or fine-tuning.
- Final export as the first proof if section preview correctness is not yet stable.
- Desktop/Tauri pivot without benchmark evidence.

## Open Questions for User Review

1. Is final export still later, after section preview/ranking are trustworthy?
2. Should the first user-facing win be “section preview” or “whole-song rough cut”?
3. How much of the `svelte-video-shaders` low-latency engine should be ported versus used only for ideas?
4. Should motion descriptors start simple but typed, or immediately use FFglitch/motion-vector data?
5. What minimum latency feels acceptable for section recompute before web-first is questioned?
