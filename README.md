# Project Stack Structure

Smart auto music-video editor foundation built on a Next.js studio prototype.

## Current product direction
The app is being shaped around a few non-negotiable rules:
- **musical alignment first**
- **motion continuity as the default visual mode**
- **accurate segment analysis over shallow quick-scan tagging**
- **explicit recompute states over laggy pseudo-live playback**

## Current codebase anchors
- `src/components/StudioApp.tsx` — main studio UI
- `src/components/studio/audioAnalysis.ts` — hosted audio analysis + waveform normalization
- `src/components/studio/mediaUpload.ts` — current browser-side video metadata/thumbnail preparation
- `src/app/api/essentia/full/route.ts` — hosted audio-analysis proxy

## Getting started
Run the local development:

```bash
bun run build
bun run start
bun run lint
bun run test
bun run check
bun run probe:media
bun run preview:section
bun run bench:latency
bun run bench:compare -- <local-json> <remote-json>
```

## Test fixtures
Local, non-committed media fixtures live in:

```text
.local-fixtures/media/
```

The test suite and media probe script will use that directory by default. To point them somewhere else:

```bash
TEST_MEDIA_DIR=/absolute/path/to/media bun run test
```

For more detail, see `tests/README.md`.

## Canonical planning and architecture docs
- [Roadmap](docs/roadmap.md)
- [Media pipeline architecture](docs/architecture/media-pipeline.md)
- [Spec workflow protocol](docs/protocols/spec-workflow.md)
- [Latency and correctness budget](docs/protocols/latency-budget.md)
- [Implementation checklist](docs/checklists/implementation-checklist.md)
- [Local latency checkpoint](docs/benchmarks/local-latency.md)
- [Remote latency status](docs/benchmarks/remote-latency-status.md)

## Planning artifacts
- Deep interview spec: `.omx/specs/deep-interview-roadmap-spec-workflow-docs.md`
- PRD: `.omx/plans/prd-roadmap-spec-workflow-docs.md`
- Test spec: `.omx/plans/test-spec-roadmap-spec-workflow-docs.md`

## Near-term roadmap
1. Lock canonical ingest contracts
2. Define deterministic section preview behavior
3. Build ranking and fit rules around music-first joins
4. Measure whether web-first remains viable before any desktop pivot

## Notes
This repo intentionally emphasizes documentation and planning right now. The approved architecture stays **web-first** for now, while preserving a **Tauri + sidecar** contingency if browser scheduling and media constraints cannot maintain musically correct preview playback.
