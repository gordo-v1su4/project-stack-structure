# Deterministic character-face measurements

`verify.py` is a CPU-only SFace/YuNet verifier CLI. It performs no generation, network requests, LLM calls, face repair or automatic approval. **No validated likeness calibration exists; identity-conditioned clips always return `unverifiable`.** A provisional threshold cannot change that status. Only an explicit shot with zero identity-conditioning references can return `not_required`.

The user-rejected H3 pilot remains rejected. A useful cosine score is not a probability or a guarantee of an acceptable likeness. Do not copy OpenCV's example benchmark cutoff into this app.

## Install and build

Use Python 3.12 and the exact locked CPU dependencies. Production packages are installed into the Trigger image by its build extension; inference never installs packages or downloads models.

```powershell
uv venv --python 3.12 scripts/identity/.venv
uv pip sync --python scripts/identity/.venv/Scripts/python.exe --require-hashes scripts/identity/requirements.lock
uv run --no-project --python scripts/identity/.venv/Scripts/python.exe python scripts/identity/download_models.py --model-dir scripts/identity/models
uv run --no-project --python scripts/identity/.venv/Scripts/python.exe python scripts/identity/verify.py --input request.json --output report.json --model-dir scripts/identity/models
```

On Linux the venv interpreter is `.venv/bin/python`. The Trigger image uses `/opt/stack-identity/.venv/bin/python` and `/opt/stack-identity/models`; invoke that existing interpreter through `uv run --no-project --python /opt/stack-identity/.venv/bin/python python ...`. A corrupt Windows uv cache previously produced `Missing .dist-info directory`; rebuilding the isolated environment with `uv --no-cache pip sync ...` repaired the cache-only failure. Do not change the shared ComfyUI Python environment.

The official immutable OpenCV Zoo model URLs, model SHA256 values and sizes are in `model-manifest.json`. `download_models.py` verifies complete bytes before promoting each temporary download. Runtime independently rechecks both model hashes. Preserve the [SFace Apache-2.0 license](licenses/SFACE-APACHE-2.0.txt) and [YuNet MIT license](licenses/YUNET-MIT.txt) when distributing the runtime and weights. These files come from the same pinned official repository commit.

## Worker input

Pass only worker-owned temporary paths. The browser must never select a server path or submit an identity proof. The worker already holds hydrated `0.png`, `1.png`, etc. and `shot.mp4` before persisting a generated H3 clip.

```json
{
  "version": 1,
  "assetId": "generated-asset-id",
  "jobId": "h3-job-id",
  "generationModel": "h3-ref2va-int8-v1",
  "videoPath": "/worker/tmp/shot.mp4",
  "mediaSha256": "64-lowercase-hex-characters",
  "frameCount": 124,
  "fps": 24,
  "durationSeconds": 5.166666666666667,
  "verifiedStartFrame": 0,
  "verifiedEndFrameExclusive": 60,
  "generationReferenceHashes": ["ordered-image-byte-sha256-values"],
  "identityReferenceHashes": ["ordered-identity-image-byte-sha256-values"],
  "references": [{
    "path": "/worker/tmp/0.png",
    "hash": "image-byte-sha256",
    "canonicalName": "Diego",
    "role": "identity"
  }]
}
```

All hashes above are illustrative placeholders; actual input requires exactly 64 lowercase hexadecimal characters. Every generation reference has one local file binding, including environments. The ordered `identityReferenceHashes` must exactly match those generation references declared `role: identity`. Byte changes fail before model inference. The decoded frame count/FPS must match the worker probe. Frame bounds are half-open: `0..60` means precisely frames 0–59, the intended 2.5 seconds, while the unused generated handles remain outside this assessment. A legacy `verifiedEndFrame` input alias is accepted; output always uses `verifiedEndFrameExclusive`.

Optional identity reference `faceRegions` contains `{name, rect: [x,y,width,height]}` normalized to the actual sheet. Each declared region must have exactly one quality face. Without regions, the CLI detects all quality faces in the sheet (maximum nine); that gallery is diagnostic and can contain inconsistent views. Region selection and gallery-consistency criteria must be frozen with a future calibration profile. A whole multi-panel sheet is never embedded as one face.

Optional `provisionalThreshold` records a diagnostic cutoff only. Optional `--sample-count N` measures evenly spaced frames and explicitly leaves scope coverage incomplete when frames are omitted. Production invocation omits this option and examines every frame in the selected trim, bounded to 512 frames.

## Report and abstention

The top-level report matches `GeneratedAssetIdentityVerification` in `src/components/studio/generatedAssetIdentity.ts`. It binds asset/job/generation model, complete media byte SHA256, ordered conditioning hashes, measured video timing and the exact verification scope. Samples contain decoded frame SHA256, timestamp and per-reference track/cosine scores. `diagnostics` additionally records pinned runtime/model provenance, canonical view pairs and leave-one-view-out scores, per-face boxes/quality and diagnostic assignments.

SFace alignment follows OpenCV's five-landmark `FaceRecognizerSF.alignCrop` to 112x112. Recognition uses ONNX Runtime CPU only, intra-op threads 2/inter-op 1, sequential execution; input is RGB float32 NCHW, scale 1 and mean 0, matching the official implementation. Features and their mean template are L2-normalized. OpenCV detection is CPU only with two threads and OpenCL disabled. No features or demographic classifier are sent to an LLM.

The initial quality limits (face minimum 64 pixels, detection confidence 0.9, blur variance 50, luminance 30–225) and association margins are explicitly **provisional diagnostic settings**, not calibrated guarantees. Missing/small/dark/blurred faces, tied face assignments, duplicate actor assignment or changed required-character tracks cause abstention. The current geometric tracker is conservative diagnostic scaffolding; it cannot authorize a pass. The report cannot turn `passed` until a separately reviewed, pinned production calibration and its acceptance policy are implemented. Never lower a cutoff to make a rejected shot pass.

## Verification

```powershell
$env:IDENTITY_TEST_MODEL_DIR = (Resolve-Path scripts/identity/models).Path
uv run --no-project --python scripts/identity/.venv/Scripts/python.exe python -m unittest discover -s scripts/identity -p 'test_*.py'
```

The tests cover fail-closed behavior even with perfect synthetic scores, missing and ambiguous faces, sampled coverage, byte-binding tampering, no-identity bypass attempts, trim/region bounds, and numerical agreement with the official OpenCV SFace feature preprocessing. Without model files, only the final numerical model test skips.

The November 6 diagnostic used the exact pinned NumPy 2.2.6/OpenCV headless 4.12.0.88/ONNX Runtime 1.23.2 environment. Three explicit Diego sheet views had leave-one-view-out cosine 0.786678–0.901793. All 60 frames in the rejected pilot's intended 0–2.5s trim were examined: diagnostic nearest-face scores ranged 0.478575–0.754058 (median 0.690734), and 32 frames failed provisional quality checks. The result is `unverifiable`, never approved. Repeating the assessment produced identical per-frame scores, quality and frame hashes. The full 124-frame file was assessed separately; unused handles are not substituted for the intended-trim result. Automatically detecting four faces from the whole sheet gave a lower minimum reference holdout score (0.654355), demonstrating that gallery/preprocessing changes require their own calibration.

These reference views and a single rejected video do not validate a production threshold. Source 2 footage remains unlabelled comparison material, not a user-approved identity-positive control. Keep automatic pass disabled until independent accepted/rejected video examples establish a suitable operating point without overlap, plus quality/coverage validation. Adjacent frames are correlated validation observations.

## Primary references

- [Official OpenCV face detection/recognition tutorial](https://docs.opencv.org/4.13.0/d0/dd4/tutorial_dnn_face.html).
- [Pinned official SFace model and license](https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_recognition_sface).
- [Pinned official YuNet model and license](https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_detection_yunet).
- [OpenCV 4.13 implementation defining alignment and RGB feature preprocessing](https://github.com/opencv/opencv/blob/4.13.0/modules/objdetect/src/face_recognize.cpp).

Worker-internal CLI integration is preferred: it reuses the Trigger task's trusted media and reference files, has no new service or Swarm backend restart, and persists a report beside the job. The installed Swarm backend has an InsightFace loader and face-editing tools but no numeric comparison/report node; a custom node would add installation/restart and provenance work without improving the deterministic algorithm.
