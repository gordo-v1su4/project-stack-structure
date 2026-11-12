# Review service topology and latency — V1S-464

Verified November 12, 2026. This is a diagnostic record for V1S-464 and
[V1S-458](https://linear.app/v1su4/issue/V1S-458). It does not authorize a runtime
upgrade or attribute browser lag to Python. Endpoints are resolved from the
existing environment and canonical private operations index; credentials and
private project payloads are excluded.

## Source paths and responsibilities

All application API paths below require the signed-in owner. Dispatch adds the
owner's Trigger tag; polling/realtime is scoped to that owner. The Next server
dispatches work; the browser does not receive service credentials.

| Work | Application and task source | Service / storage / GPU responsibility |
| --- | --- | --- |
| Master audio | `src/app/api/essentia/full/route.ts:10`; `triggerEssentiaAnalysis`, `src/lib/triggerOrchestration.ts:156`; `src/trigger/essentia.ts:30`; `src/lib/essentiaStudio.ts:6` | TypeScript task downloads stored audio, submits idempotent `/analyze/studio/jobs`, polls the same job, normalizes and stores JSON. VM100 Essentia Python/FastAPI/Uvicorn owns analysis; CPU timing and optional model/GPU work are separate from browser review. |
| Smart caption | `src/app/api/caption/scene/route.ts:117`; `triggerSmartSceneCaption`, orchestration:178; `src/trigger/caption.ts:126` | TypeScript task checks the Qwen lifecycle, reads source/reference bytes, posts `/caption/scene`, persists evidence JSON. VM100 Python/FastAPI/Uvicorn gateway fronts the separately managed llama.cpp Qwen GPU service. Gateway alive does not mean model ready. |
| Video ingest / scenes | `src/app/api/media/video/jobs/route.ts:17`; `triggerMediaSceneDetection`, orchestration:129; `src/trigger/media.ts:361-410` | TypeScript pipeline awaits scene detection, caption batches and finalization. Queued path submits media API `/video/jobs` and polls; configured direct path uses `/video/analyze`. VM100 Python/FastAPI/Uvicorn worker runs FFmpeg/PySceneDetect and shares a GPU lock; RustFS/media API owns durable manifests and queue records. |
| Review copies | `src/app/api/storage/review-video/route.ts:10`; orchestration:67; `src/trigger/reviewVideo.ts`; `src/lib/prepareStoredReviewVideo.ts:14`; `src/lib/prepareReviewVideo.ts:78` | CPU-only TypeScript task in its own concurrency-one queue reads a pinned ETag/size, runs FFmpeg/FFprobe and Sharp in the Trigger image, writes proxy/poster/sprite/ready manifest to RustFS. No Python caption or Swarm generation call. Source video and film selection remain unchanged. |
| Project review backfill | `src/app/api/studio/projects/[projectId]/review-preparation/route.ts:39`; orchestration:54; `src/trigger/reviewBackfill.ts` | Separate concurrency-one parent awaits sequential review-copy children and exact durable receipts. It does not choose takes or save the film. |
| Preview / export | `src/app/api/preview/section/route.ts:16`, `src/app/api/preview/gateway/route.ts:42`; orchestration:404; `src/trigger/ffmpeg.ts` | TypeScript Trigger task materializes stored inputs and invokes FFmpeg in its worker. Media-assembly queue, not the Python caption service. Output is persisted to RustFS. Live final-export acceptance was not run for this diagnostic. |
| Local generation | `src/app/api/generate/local/route.ts:31`; orchestration:274; `src/trigger/localGeneration.ts:120,214` | TypeScript task routes native Swarm calls or workflow calls through SwarmUI's managed `ComfyBackendDirect` prompt/history/view path, then persists output in RustFS. The Windows GPU host owns generation. A raw ComfyUI port is not a separate provider. No generation, Swarm inspection or tuning was performed for this ticket. |
| Objects / browser media | owner-protected storage and project routes; `src/lib/prepareStoredReviewVideo.ts:14` | VM114 RustFS stores originals, projects, generated objects and derivatives. Node/Express media API uses AWS SDK/Sharp; this is not a Python service. Browser fetch/decompression, media decode, React/layout/paint and master playback are client work. |

`uv` is Python package/environment tooling; Uvicorn is the ASGI HTTP server.
No Robyn evidence was found in these checked Stack services. Historical product
tables and old Vercel notes are not live runtime proof.

## Live proof, separate from source configuration

Read-only SSH/container/process/health checks, approximately 08:50–08:55 UTC:

| Boundary | Live observation | Limit |
| --- | --- | --- |
| VM100 web | `project-stack-structure-web` healthy; `node server.js`, Node `24.22.2`; installed Next `16.2.1`, React `19.2.4`; revision `77ae7c572b52c27e26bccd2f87df9c571f4a6e41` | Node standalone serving, not Bun as HTTP runtime. Publication build/tooling is a separate boundary. |
| VM100 Essentia | `essentia-api` healthy, entrypoint ends in `uvicorn main:app` on container 8000; host mapping per canonical index; Uvicorn `0.52.4`, CPython `3.11.0rc1`; health version `4.1.0` | Health is not a newly executed analysis job or GPU-stage measurement. |
| VM100 video worker | `stack-structure-video-worker` healthy; live command `uvicorn worker:app` on VM-local 18090; Uvicorn `0.38.0`, CPython `3.12.14`; health reports CUDA/NVENC/device available, processing enabled and no last error | Its scene-detection queue is separate from Trigger review-copy tasks. No new video analysis was submitted. |
| VM100 caption | systemd active; ExecStart is gateway virtualenv Uvicorn `app:app` on 18091; health identifies `fastapi-llama-cpp-gguf` | Qwen backend inactive/unhealthy on demand, service not busy. Kept inactive; no inference/lifecycle action. |
| VM114 media | `rustfs-media-api` running; Node `22.23.3`, Express `4.22.3`, Sharp `0.34.5`; image's existing command runs its start script; `/health` OK, video job count 0 | Node framework/package versions checked inside live container. No secret environment dump. |
| VM114 objects | `rustfs-server`, `rustfs/rustfs:1.0.4`, running; media API connects to its internal S3 service | No bucket enumeration or storage mutation. Browser/project reads prove the particular objects separately. |
| Trigger | webapp/supervisor/Postgres/ClickHouse/registry healthy; no execution runner visible in the container inventory | Snapshot only. Docker CPU: webapp 1.50%, supervisor 0.18%, ClickHouse 2.69%, Essentia 0.08%, video worker 0.05%. Does not establish historical load causality. |
| Current app worker | production `worker_cmwckt8ik00pr3zoed2mh9e1z`, `20261111.2`, deployment `7uak5u59`, SDK `4.5.16`, Bun `1.3.3`; deployed at 2026-11-11 20:33:22 UTC | Database registration is exact live inventory, not proof that this branch's new task definitions were released. |
| SwarmUI | configured Windows SwarmUI frontend with managed ComfyUI behind it, per source and canonical private index | Configuration evidence only; live inspection excluded by Robert's scope correction. Existing H3 output is not evidence of a new test. |

## Exact queued requests and timing separation

The two inherited viewing-copy requests are:

| Run | Created / queued UTC | Exact live state |
| --- | --- | --- |
| `run_cmwd9t2rh00pw3zoekcnrxly8` | 2026-11-12 08:12:58.313 / .311 | `PENDING_VERSION`, `TASK_NEVER_REGISTERED`, startedAt null, usage 0 ms |
| `run_cmwd9w0v000pz3zoeo0ews785` | 2026-11-12 08:15:15.814 / .813 | `PENDING_VERSION`, `TASK_NEVER_REGISTERED`, startedAt null, usage 0 ms |

At the query they had waited 2348 / 2210 seconds respectively. Worker
`20261111.2` registers 19 tasks and lacks **both** `prepare-review-video` and
`prepare-project-review-videos`. Those waits are for a compatible task version,
not measured encoding, Python inference or GPU processing time. No retry,
duplicate dispatch, cancellation or queue edit was issued.

A previous service-health run `run_cmwckxwva00ps3zoe1kthyzzh` queued at
20:36:53.549, started .802 and completed 20:36:56.697 UTC on November 11:
253 ms queue-to-start, 2895 ms start-to-completion, usage counter 970 ms.
Wall duration and billable/service usage are different quantities. Historical
`local-ai-generation` run `run_cmwc71mgg00pn3zoek7uelfu7` waited 280 ms and
ran 225591 ms wall / 224269 ms usage. Neither is a new performance experiment.

Public signed-in browser at actual 2432×1592, normal cache/network/viewport:

- Finishing-project GET: 716.6 ms fetch-to-headers, 845.1 ms body read, 33.2 ms
  text decode/JSON parse, 14,204,363 expanded bytes. Original read: 301.7 ms,
  124.2 ms, 7.3 ms, 4,218,922 expanded bytes. Browser handled HTTP gzip before
  the body reached JavaScript; no separately measured decompressor cost or exact
  server compute time is claimed. Fetch-to-headers includes server and network.
- V1S-458's browser CPU/model/render measurements are in
  [review-performance-458.md](review-performance-458.md). Its original playback
  click-to-first-presented-frame was 1162.8 ms. That is not queue latency.
- V1S-459's [prepared-media evidence](review-media-459.md) separately records
  cold/warm derivative transfer and decoder processing; its controlled prepared
  hover first frame was 348.3 ms including dwell, decoder processing 6.7 ms.
  Those candidate/fixture measurements do not prove production worker readiness.

## Qualification and unresolved checks

The branch's web checks/build/publication, public visible acceptance and final
protected-object readback are recorded below as they complete. Web publication
alone cannot register Trigger tasks. The production task-bundle release and
end-to-end durable review-copy receipt remain a separate unresolved integration
gate until explicitly qualified. No new media generation is needed to diagnose it.

The running worker image is pinned to digest
`sha256:2cdf4f416f1ab7c0ed39be33f7e5262b64425c8be627a727dce526e2743fc28d`.
Runtime alignment is not silently included: build/runtime Bun versions must be
qualified explicitly rather than upgraded as incidental diagnostic work.

Both protected full-draft hashes and quoted revisions matched the inherited
baseline before diagnostics. Original opened through GET only, never its editor.
No service restart, upgrade, framework replacement, credential/configuration
change, BWS mutation, Swarm dispatch or film adoption was performed.
