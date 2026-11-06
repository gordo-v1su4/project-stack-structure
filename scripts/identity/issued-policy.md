# Server-issued provisional draft filters

`prepare_policy.py --input request.json --output result.json --model-dir models`
runs CPU-only before a new opted-in render. `verify.py` accepts the resulting
server-issued policy envelope through trusted worker input. Neither command
creates media, contacts a provider, changes project references, or certifies
identity. Use the same pinned Python environment as the existing verifier.

Versioned immutable files under `families/` define the numeric behavior independently
of a project or character name. Their canonical SHA256 registry is in
`issued_policy.py`. The foreground family retains threshold 0.80, the existing
frontal geometry and physical pixel minimums, dominant-face selection before
similarity, bounded nonoverlapping background faces, and a 0.15 lead margin.
The joint family retains exactly two measurable faces, threshold 0.80, the 0.08
bijective assignment margin, and distinct continuous tracks. All selected frames
must resolve. Blur and luminance remain reported acquisition warnings.

Preflight first hashes every ordered raw reference. It detects the raw identity
sheet with the pinned YuNet implementation, bounded to 32 candidates. Each
candidate is re-detected at native detail in a deterministic crop extending
30% of its detected width on either side and 25% of its height above and below,
clamped to the source image. This changes neither the raw source nor generation
conditioning. Re-detection retains the same 128x160 physical pixel minimum,
the requested family's detector-confidence minimum and frontal landmark bounds.
Each selected crop must
contain exactly one detectable face. Overlapping detections of the same face
are deduplicated by box IoU above 0.5. Candidates are ordered by source position.
Every qualifying distinct frontal view is included, up to nine; all pairs must
have cosine at least 0.80. Contradictory qualifying groups abstain rather than
selecting a preferred group. One unambiguous frontal anchor is sufficient.

Returned normalized pixel-derived ROIs, canonical names and raw authority hashes
form the existing ordered gallery profile. The issued body additionally binds
owner/project, generation profile, all reference snapshots, fixed family and
model pins, and preflight evidence hashes. Issued-body JSON uses recursively
sorted keys, UTF8, unescaped Unicode and integral floats serialized as integers.
The historical gallery-profile hash keeps its separate existing encoding.
Issuance timestamps are excluded from the body digest. At verification, raw
files are rehashed, the actual gallery definition is recomputed, and all issued
bindings are checked before the unchanged numerical evaluators run.

The parent proof always remains `unverifiable`. A separate issued filter can
report provisional draft eligibility; final creative review and the server's
canonical policy/approval checks still apply. These editorial operating rules,
correlated frames and reference-sheet consistency checks do not establish a
held-out identity accuracy or false-accept rate. Historical fixed project
policies, rejected clips and their reports remain unchanged when opt-in is absent.

The foreground and joint `frontal-v1` families retain detector confidence 0.94.
The separately pinned `frontal-v2` families use 0.90; all other numeric rules,
including cosine 0.80 and every-frame geometry/tracking, are identical. New UI
intents request v2. Restored intents keep their explicit family or absent field;
parsing and retries never upgrade it. A failed older take remains excluded and
requires a deliberate new creative intent with a fresh render and preflight.
Its earlier attempts and any explicit rejection remain in history.

This operating-point decision was made after observing the P05 detector-only
failure. [OpenCV 4.12's FaceDetectorYN API](https://docs.opencv.org/4.12.0/df/d20/classcv_1_1FaceDetectorYN.html)
documents a 0.90 detection-score default. That default is not a calibrated
likeness threshold or an identity-accuracy claim. Parent proofs remain
`unverifiable`, and final draft review remains required.

Focused tests: `uv run --no-project --python <pinned-python> python -m unittest
discover -s scripts/identity -p test_issued_policy.py`. Local real-media fixtures
are optional; synthetic mismatch and fail-closed tests require no GPU or network.
