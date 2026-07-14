# Media pipeline v2

Project Stack Structure processes each uploaded video through a visible Trigger.dev parent/child tree:

1. `media-video-pipeline` coordinates one source object.
2. `media-video-scene-detect` downloads and probes the source, detects scenes, and uploads frames, storyboards, optional clips, and an uncaptioned manifest.
3. `qwen-scene-caption-batch` captions at most six scene storyboards per child run.
4. `media-video-finalize` merges caption sidecars and publishes the completed manifest.

## Queues

| Queue | Concurrency | Purpose |
| --- | ---: | --- |
| `scene-detection` | 3 | Independent source download, scene analysis, and artifact extraction |
| `qwen-caption` | 1 | Qwen3-VL inference while llama.cpp remains `--parallel 1` |
| `media-finalization` | 2 | JSON sidecar merge and final manifest publication |

Redis remains the Trigger coordination store. The bottlenecks are source storage, FFmpeg/OpenCV work, and single-GPU Qwen inference; replacing Redis with Dragonfly does not improve those stages.

## Reliability and persistence

- Source downloads use three exponential-backoff attempts. Each attempt writes a temporary partial file, validates `Content-Length` when present, probes the media, and atomically promotes only a valid input.
- Qwen batches allow two retries after the initial attempt. Trigger idempotency reuses completed scene and caption children instead of repeating successful work.
- Idempotency incorporates the source content hash after scene detection, analyzer/pipeline version, Qwen model, prompt digest, batch index, and scene indices.
- Large manifests remain in RustFS. Trigger outputs contain compact storage pointers and counts.
- New derived output lives under `analysis/v2`; worker artifacts use `<source>.analysis/v2/<job>/artifacts`.
- The final manifest includes the v2 schema, source hash, analyzer version, scene boundaries, frame/storyboard/clip paths, captions, caption model metadata, and pipeline version.

## Runtime performance

- The staging worker requires CUDA and NVENC.
- Independent videos can occupy three scene-detection slots.
- Per-scene frame/storyboard uploads use a bounded four-thread I/O pool and overlap with clip encoding.
- Qwen remains concurrency one. Increase llama.cpp parallelism only after VRAM and tokens-per-second measurements show a gain without instability.

## Clean validation baseline

The July 12, 2026 rollout cleared only the `stack-structure` bucket, Project Stack Structure's local Trigger development run history, the saved Studio project key/database, and the ignored local draft cache. Pindeck, Unfold Review Room, models, fixtures, credentials, and unrelated infrastructure were preserved.

The clean synthetic validation produced one three-scene run followed by a 16-video batch. Live Trigger state showed exactly three active scene children and one active Qwen child. All 16 parents, scene children, caption children, and finalizers completed successfully.
