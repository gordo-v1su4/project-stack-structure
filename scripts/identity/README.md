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

Pass only worker-owned temporary paths. The browser must never select a server path or submit an identity proof. Before verification, the worker rehydrates the original reference files as `identity-reference-0`, `identity-reference-1`, etc., checks their raw hashes, and assesses `shot.mp4` before persisting a generated H3 clip. These identity inputs remain the raw authorities even when H3 receives a cropped conditioning image.

```json
{
  "version": 1,
  "assetId": "generated-asset-id",
  "jobId": "h3-job-id",
  "generationModel": "h3-ref2va-int8-v2",
  "videoPath": "/worker/tmp/shot.mp4",
  "mediaSha256": "64-lowercase-hex-characters",
  "frameCount": 124,
  "fps": 24,
  "durationSeconds": 5.166666666666667,
  "verifiedStartFrame": 0,
  "verifiedEndFrameExclusive": 60,
  "generationReferenceHashes": ["ordered-raw-authority-byte-sha256-values"],
  "identityReferenceHashes": ["ordered-raw-identity-authority-byte-sha256-values"],
  "references": [{
    "path": "/worker/tmp/identity-reference-0",
    "hash": "raw-authority-byte-sha256",
    "canonicalName": "Diego",
    "role": "identity"
  }]
}
```

All hashes above are illustrative placeholders; actual input requires exactly 64 lowercase hexadecimal characters. Despite its historical name, `generationReferenceHashes` binds the ordered **raw reference authorities** (`job.referenceHashes`), including environments. The ordered `identityReferenceHashes` must exactly match their `role: identity` subset. The report's `referenceHashes` carries these same raw authority hashes. The job's separate `conditioningReferenceHashes` records the actual image bytes uploaded to H3 after versioned preparation; those cropped-image hashes do not replace the verifier's raw authorities. Byte changes fail before model inference. The decoded frame count/FPS must match the worker probe. Frame bounds are half-open: `0..60` means precisely frames 0–59, the intended 2.5 seconds, while the unused generated handles remain outside this assessment. A legacy `verifiedEndFrame` input alias is accepted; output always uses `verifiedEndFrameExclusive`.

Optional identity reference `faceRegions` contains `{name, rect: [x,y,width,height]}` normalized to the raw sheet. Each declared region must have exactly one quality face. `src/lib/h3IdentityGallery.ts` resolves the fixed `diego-canonical-three-view-v1` gallery only for canonical name `Diego`, role `identity`, and raw SHA256 `47d772694e0c14397707f31b7802fe91d434da1e4b54be7bac3eb00037364381`: front `[0,0,0.285,0.55]`, three-quarter `[0.285,0,0.25,0.55]`, and upper-body `[0,0.55,0.5,0.365]`. The worker supplies those exact regions independently of the portrait crop used for generation. Unknown references receive no resolver override. Without regions, the CLI detects all quality faces in the sheet (maximum nine); that gallery is diagnostic and can contain inconsistent views. A whole multi-panel sheet is never embedded as one face. The fixed three-view geometry preserves benchmark comparability; it does not establish a validated calibration or enable automatic pass.

Optional `provisionalThreshold` records a diagnostic cutoff only. Optional `--sample-count N` measures evenly spaced frames and explicitly leaves scope coverage incomplete when frames are omitted. Production invocation omits this option and examines every frame in the selected trim, bounded to 512 frames.

## Opt-in provisional draft-similarity evidence

This separate policy can identify a **reviewable draft candidate** while the parent identity assessment remains `status: unverifiable`. It never creates an identity certificate, final creative approval, or a general likeness-accuracy claim. Earlier failed quality experiments remain unchanged. Sharpness and lighting diagnostics become warnings under this separate policy because their reference-photograph acquisition envelope was not validated as an identity-validity test for cinematic video.

The server must explicitly add `projectId`, `generationModel`, `draftSimilarityPolicyId` and `draftSimilarityPolicySha256` to CLI input. The initial V2 policy `love-me-tonight-diego-frontal-draft-v1` remains immutable, canonical JSON SHA256 `f23f8186a59c3c893c043b0bba19a335d874dec9d140de54cfd98f6c824fe7d7`. Policy hashes use UTF-8 `json.dumps(policy, sort_keys=True, separators=(",", ":"), ensure_ascii=True)` so checkout line endings do not alter the pin. Package the allowlisted policy JSON files with the worker; each is checked at runtime before use.

V3 uses separate immutable policies: `love-me-tonight-diego-frontal-draft-v2`
(`f0250eadd801010db9885de4a6359c3c526fe6783e7dcd4a8128cbabbb3d9498`) and
`love-me-tonight-valentina-frontal-draft-v1`
(`589ee087db6829a53910659514b50bb1227c705ae6f7302fe2c977ccdb49d637`).
Both explicitly pin `h3-ref2va-int8-v3`, threshold0.80 and the same per-frame
frontal geometry; blur and luminance remain diagnostic warnings. The worker
selects only an exact project/profile/single raw-authority match. Python checks
the allowlisted policy hash, generation profile, raw identity, canonical name,
role, gallery and model/preprocessing pins before computing eligibility.

Valentina's gallery resolves only raw SHA256
`15a317d4bc85ab1b794f0bb0e9e25658b616c41a1b77bc23520ebbecc95ffc67`,
canonical name `Valentina`, role `identity`: front `[0.267,0,0.241,0.508]`,
three-quarter `[0.509,0,0.24,0.508]`, full-body `[0,0,0.266,0.938]`.
Its profile hash is `aabd690a6375029bfc793be8c2cd9b9efc034583aa5b0d0463c111c1c565b9c8`.
The raw profile view remains in the unchanged authority but is outside this
frontal gallery. Cross-pose holdouts do not support an all-pose policy. All
eligible evidence remains `status: unverifiable`; whole-draft review and owner
approval remain separate.

The policy is limited to project `75101b25-fea6-42b1-b2c6-85a9d1deb8eb`, the exact raw Diego authority and three-view gallery documented above, and the pinned model/preprocessing hashes. Missing opt-in or unknown policy IDs produce no eligibility evidence. Requested but mismatched project, policy SHA, raw identity, gallery or model bindings remain unverifiable. This project-wide policy can assess future frontal Diego shots; it is not restricted to one job or media file. The enclosing proof binds each result to its actual job, media, ordered raw references and half-open frame scope.

Every intended frame must have exactly one fully bounded face at least128x160px, YuNet confidence at least0.94, the frozen near-frontal five-landmark geometry (roll at most8degrees and normalized nose/mouth offsets at most0.10/0.12), one continuous unique track with consecutive face-box IoU at least0.15, and cosine similarity at least0.80. At least three intended frames are required. No mean, percentile, sampled-frame or best-frame shortcut can grant eligibility. Missing faces, multiple faces, incomplete coverage or unresolved tracking remain unverifiable; complete observations below the score or geometry criteria are ineligible. The landmark offsets are image-geometry proxies, not calibrated physical yaw angles.

The additional top-level `draftSimilarityFilter` contains `version`, `policyId`, `policySha256`, `status` (`eligible`, `ineligible`, `unverifiable`), `threshold`, `examinedFrameCount`, `eligibleFrameCount`, `outOfScopeFrameCount`, `ambiguousFrameCount`, full-frame `samples` using the parent sample format, and `warnings`. Samples retain numeric scores even when acquisition sharpness/lighting warnings would remove them from the stricter parent identity assessment. Production must bind this evidence to the authenticated project and verify its complete policy/media/reference/frame context before allowing provisional draft selection. The report is evidence, not authorization from client-provided JSON.

## Report and abstention

The separate `love-me-tonight-diego-valentina-frontal-pair-draft-v1` policy applies only to the pinned Love Me Tonight project, v3 generation profile and both exact Diego/Valentina raw authorities. It preserves the three existing single-person policies. Both reference orders have separately pinned combined gallery/preprocessing hashes. Every frame of the selected trim must contain exactly two faces meeting the existing frontal geometry/size limits. A 2×2 cosine matrix is evaluated as a bijection: each assigned face must score at least 0.80 and exceed both its competing face and competing identity by at least 0.08. Each identity keeps a distinct continuous track; consecutive own-box IoU must be at least 0.15 and exceed cross-track IoU. Missing/extra faces, uncertain assignments, track changes and crossings abstain. Per-frame `candidateScores` retains all four numeric candidates alongside the two assignments; feature vectors are not persisted. These conservative project-local settings are provisional, not calibrated identity accuracy. Parent identity status stays `unverifiable`; an eligible draft still needs the existing whole-draft review and approval. The synthetic regression controls establish contract behavior, not real paired-video quality or a false-accept rate.

The top-level report matches `GeneratedAssetIdentityVerification` in `src/components/studio/generatedAssetIdentity.ts`. It binds asset/job/generation model, complete media byte SHA256, ordered raw authority hashes, measured video timing and the exact verification scope. Samples contain decoded frame SHA256, timestamp and per-reference track/cosine scores. `diagnostics` additionally records pinned runtime/model provenance, canonical view pairs and leave-one-view-out scores, per-face boxes/quality and diagnostic assignments.

`diagnostics.galleryProfile` records a stable SHA256 of the ordered raw identity hashes, canonical names and actual normalized region definitions, including whole-sheet defaults. That SHA is appended to `verifier.preprocessVersion` as `-gallery-v2-<sha256>`, so whole-sheet and three-view measurements cannot share a preprocessing identifier. Local file paths do not affect this hash. The fixed Diego three-view profile hashes to `6e3acaeea694c1a1d1df4fbd8f2a5365aa801cca8fd2a07faf8f6634af4dd9e7`; `calibrationId` remains `uncalibrated-no-automatic-pass-v1`.

SFace alignment follows OpenCV's five-landmark `FaceRecognizerSF.alignCrop` to 112x112. Recognition uses ONNX Runtime CPU only, intra-op threads 2/inter-op 1, sequential execution; input is RGB float32 NCHW, scale 1 and mean 0, matching the official implementation. Features and their mean template are L2-normalized. OpenCV detection is CPU only with two threads and OpenCL disabled. No features or demographic classifier are sent to an LLM.

The initial quality limits (face minimum 64 pixels, detection confidence 0.9, blur variance 50, luminance 30–225) and association margins are explicitly **provisional diagnostic settings**, not calibrated guarantees. Missing/small/dark/blurred faces, tied face assignments, duplicate actor assignment or changed required-character tracks cause abstention. The current geometric tracker is conservative diagnostic scaffolding; it cannot authorize a pass. The report cannot turn `passed` until a separately reviewed, pinned production calibration and its acceptance policy are implemented. Never lower a cutoff to make a rejected shot pass.

## Verification

```powershell
$env:IDENTITY_TEST_MODEL_DIR = (Resolve-Path scripts/identity/models).Path
uv run --no-project --python scripts/identity/.venv/Scripts/python.exe python -m unittest discover -s scripts/identity -p 'test_*.py'
```

The tests cover fail-closed identity behavior even with perfect synthetic scores, missing and ambiguous faces, sampled coverage, byte-binding tampering, no-identity bypass attempts, trim/region bounds, and numerical agreement with the official OpenCV SFace feature preprocessing. Separate provisional-filter tests cover immutable policy/project/gallery bindings, exact thresholds, geometry, missing/multiple/discontinuous tracks and warning-only acquisition metrics. When the local pinned models and diagnostic media are present, real fixture tests assess all37intended frames of the observed v2 pickup as a provisional candidate while the parent remains unverifiable, and ensure the original rejected pilot stays outside eligibility. Model/media-dependent tests skip when their explicitly required local fixtures are absent.

The November 6 diagnostic used the exact pinned NumPy 2.2.6/OpenCV headless 4.12.0.88/ONNX Runtime 1.23.2 environment. Three explicit Diego sheet views had leave-one-view-out cosine 0.786678–0.901793. All 60 frames in the rejected pilot's intended 0–2.5s trim were examined: diagnostic nearest-face scores ranged 0.478575–0.754058 (median 0.690734), and 32 frames failed provisional quality checks. The result is `unverifiable`, never approved. Repeating the assessment produced identical per-frame scores, quality and frame hashes. The full 124-frame file was assessed separately; unused handles are not substituted for the intended-trim result. Automatically detecting four faces from the whole sheet gave a lower minimum reference holdout score (0.654355), demonstrating that gallery/preprocessing changes require their own calibration.

These reference views and a single rejected video do not validate a production threshold. Source 2 footage remains unlabelled comparison material, not a user-approved identity-positive control. Keep automatic pass disabled until independent accepted/rejected video examples establish a suitable operating point without overlap, plus quality/coverage validation. Adjacent frames are correlated validation observations.

## Primary references

- [Official OpenCV face detection/recognition tutorial](https://docs.opencv.org/4.13.0/d0/dd4/tutorial_dnn_face.html).
- [Pinned official SFace model and license](https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_recognition_sface).
- [Pinned official YuNet model and license](https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_detection_yunet).
- [OpenCV 4.13 implementation defining alignment and RGB feature preprocessing](https://github.com/opencv/opencv/blob/4.13.0/modules/objdetect/src/face_recognize.cpp).

Worker-internal CLI integration is preferred: it reuses the Trigger task's trusted media and reference files, has no new service or Swarm backend restart, and persists a report beside the job. The installed Swarm backend has an InsightFace loader and face-editing tools but no numeric comparison/report node; a custom node would add installation/restart and provenance work without improving the deterministic algorithm.
