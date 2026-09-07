# Dedicated Studio audio analysis

## Outcome

Replace Studio's legacy `/analyze/fast` call with one purpose-built analysis job. The editor needs master duration, BPM, beat/onset timestamps, timed normalized energy, and functional song sections. It does not consume genre, mood, instrument, pitch, key, or vocal classification; lyrics continue through the separate vocal-stem transcription flow.

The user's desktop API code through `ce58f95` already includes All-In-One and the SBic repair. Both legacy fast/full routes still use SBic. A real full-song call to the public All-In-One route on September 7 returned Cloudflare 524 after 125.64 seconds, with health responsive throughout. That is not evidence of successful structure analysis.

## Contract and implementation

- Add routes to the existing `essentia-endpoint` repository and existing FastAPI Docker service. The temporary Git worktree is not a new repository or service. Preserve legacy endpoint paths, request/response schemas and default analysis behavior; Studio startup/storage failures must not disable the older routes.
- Authenticated `POST /analyze/studio/jobs` accepts multipart audio and an idempotency key, returns a job identifier promptly.
- Authenticated `GET /analyze/studio/jobs/{id}` returns status/stage and the completed `studio-audio-v1` result or an explicit error. Job ownership is isolated by API-key identity.
- One bounded background worker persists job state and results, limits upload/queue/storage size, and reports interrupted jobs after restart. Idempotent retry must not start duplicate inference.
- Essentia supplies rhythm/onsets/energy; All-In-One supplies functional sections. No duration-based fallback or inferred verse/chorus labels can silently replace a failed model.
- All-In-One source separation and model inference must use CUDA, with an explicit failure when CUDA is unavailable; no CPU/MPS fallback. The old deployment explicitly forced CPU despite a working RTX 4090. Its first inference finished after approximately 585 seconds, but the synchronous client had already timed out. Standard Essentia C++ rhythm/RMS primitives are CPU algorithms, not GPU neural models.
- Validate finite times, ordered intervals and analyzed duration against the whole uploaded song. Preserve model provenance; detected labels remain editable model predictions.
- Return energy sample timing explicitly. The app resamples onto the editor's uniform duration domain so dropping frame-hop metadata does not move musical accents.
- Trigger polls the job and exposes real stages in existing live production feedback. Results and source audio remain in RustFS. Public app routes retain session authentication and never expose service credentials.
- Preserve service BPM through parsing, persistence and display instead of discarding it and using the generic display fallback.

## Verification

Unit-test job isolation, duplicate submission, capacity, restart/failure states, temporal validation, client polling/failure handling and energy timing. Run affected app checks and full required checks before integration. Verify the deployed API with the exact full-song fixture and inspect returned section timing, provenance, beats/onsets and energy. Then run the visible Studio upload/reanalysis path and verify the actual saved structure. Health or Swagger alone is not acceptance. Do not submit duplicate full-song inference while an earlier request may still run.

The current six-video/three-reference story E2E remains pending behind this repair. UI redesign and image prompting remain deferred; no new image/video generation is part of this change.

## Deployment and real-song checkpoint — September 7

The existing API repository, desktop checkout and existing Docker service are synchronized to `c701463`. The temporary worktree was removed. All twelve legacy OpenAPI paths, schemas and authentication definitions match the pre-deployment snapshot. Twenty-two dedicated job/compatibility tests passed; Studio app integration remains uncommitted and undeployed.

The first public Studio job (`535741ec64d743b78682197fdb94b043`) completed in 30.5 seconds with CUDA provenance, full decoded duration 246.69995 seconds, BPM 131.9413, 525 beats, 1,344 onsets and 21,250 timed RMS samples. Transport, persistence and full-duration coverage passed. **Semantic structure acceptance failed:** all twelve model intervals returned raw `chorus` labels. The adapter did not create those labels. Do not treat this result as correct song structure or wire it into the saved story. Investigate the GPU model and preprocessing before another acceptance run; do not substitute a generic structure or force label diversity.

Evidence: `.tmp/essentia-studio-live-20260907T042559/`. Retain model intermediates in a scoped diagnostic run to distinguish CUDA inference from preprocessing; production job cleanup removes successful-run inputs and scratch files.

An isolated CUDA diagnostic reproduced the bad labels without preceding Essentia processing. Its log repeatedly reported `NATTEN was not built with cuda:0 support.` The installed attention dependency lacked CUDA kernels although PyTorch could use the GPU; All-In-One continued and returned finite but unusable outputs. Repair the existing image's NATTEN build and fail Studio admission to inference when its CUDA backend is unavailable. Checking PyTorch CUDA availability alone is insufficient. No CPU fallback or fabricated section labels are an acceptable repair.

### Repaired GPU acceptance

Canonical API commit `59550eb` pins the official NATTEN 0.17.1 CUDA 11.8 / Torch 2.1 / CPython 3.11 Linux x86_64 wheel with SHA256 verification. Studio now rejects an unavailable NATTEN CUDA backend before inference. Real 1D and 2D CUDA attention calculations passed in the deployed container. The service image is `sha256:86b7699795e387091286e6a5a85d481f2e81d5f9e2fcb9b753d211331f83491d`; legacy paths, schemas and authentication remain unchanged. Twenty-four job/compatibility tests passed.

Public job `50777a8db1464560b59f57d085643dee` completed in **37.5 seconds**, including submission and polling, with CUDA provenance and full duration 246.69995 seconds. It returned BPM 131.9413, 525 beats, 1,344 onsets and 21,250 RMS samples. Grouping adjacent equal labels for this report only, the model detected:

| Start (s) | End (s) | Detected label |
| --- | --- | --- |
| 0.00 | 14.75 | intro |
| 14.75 | 60.20 | verse |
| 60.20 | 89.29 | chorus |
| 89.29 | 127.48 | verse |
| 127.48 | 156.57 | chorus |
| 156.57 | 196.57 | bridge |
| 196.57 | 243.85 | chorus |
| 243.85 | 246.70 | end (neutral section, raw label retained) |

The API retains sixteen individual model intervals rather than altering those boundaries. Predictions remain reviewable; this is evidence of functioning inference, not a guarantee of the artist's intended musical labels. The actual response also passed the prepared Studio normalizer without changing duration or BPM. Evidence: `.tmp/essentia-studio-live-20260907T045646/completed.json` and `studio-normalized.json`.

**API repair acceptance passed.** App/Trigger integration remains prepared but undeployed, and the saved Studio project has not been reanalyzed. Story work and the new earthquake footage remain paused until the user is ready.
