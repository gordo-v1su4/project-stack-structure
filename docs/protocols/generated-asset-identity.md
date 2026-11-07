# Generated video identity evidence

New local H3 assets (the `h3-ref2va-int8-v1` profile, or SwarmUI jobs beginning
`h3-`) require worker-produced identity evidence before automatic draft selection,
draft acceptance, or approved replacement coverage. Legacy providers retain their
existing review flow. Explicit candidate playback remains available for assessment.

`generatedAssetIdentityBlockReason()` is the shared UI and eligibility check.
`generatedAssetIdentity.ts` defines the versioned evidence schema. A pass binds
the asset/job/generation model, actual video SHA-256, measured duration/frame count
and frame rate, ordered generation reference hashes and the identity-reference
subset. The face verifier records its model SHA-256, implementation and preprocessing
versions, calibration ID, numeric cosine threshold and sampled frame hashes/scores
with identity-to-track assignments. Cosine scores are not confidence percentages.

Every frame inside the half-open verified frame interval must be examined, with
zero unverifiable or ambiguous frames. That interval must cover the selected source
trim. Unused handles outside it do not disqualify the selected trim. Three distinct
sample times and frame hashes per required identity reference provide supporting
score evidence; they do not substitute for complete coverage of the verified scope.
Missing faces or uncertain person assignment remain **unverifiable**, rather than
being inferred to be a different identity. Such clips require further assessment
and cannot enter the draft automatically.

Only explicit, matching empty identity-reference lists permit `not_required`.
No prompt/name inference, LLM judgment, guessed threshold, or fabricated passing
assessment is allowed. A calibrated production verifier is still required to
produce passing evidence. Evidence metadata is a workflow eligibility record, not
an authorization credential or cryptographic attestation; server workers must bind
it to actual bytes and references rather than accept browser-provided assessments.

Rejection takes precedence over positive evidence. Normalization retains a
rejected review status and clears approval time. A late positive result cannot
select an existing rejected asset ID. Draft review fingerprints include identity
evidence and media bindings for selected candidates and approved replacements;
changing them requires another prepared review. No existing rejected pilot is
reclassified by this contract.

## Private verifier diagnostics and conditional reference reads

Verifier failures retain fixed boundary codes in the private Trigger log and stage
metadata: media read, input binding, policy read/binding, reference download/hash/write,
policy selection, input write, verifier process, report read/parse/validation and
proof binding. Diagnostics contain enum values, a numeric reference index, an optional
bounded HTTP status and a fixed process-failure class. Never include raw exceptions,
subprocess stdout/stderr, credentials, private URLs/paths, report bodies or embeddings.
A diagnostic failure cannot change numerical eligibility or trigger another render.

Reference reads retain the exact pinned `IfMatch` on every S3 GET and require the
returned ETag to match. Only storage HTTP 403 `SignatureDoesNotMatch` permits one
bounded retry of that same conditional GET. A 412, unrelated authorization failure,
response ETag mismatch or reference-byte hash mismatch remains a failure, with no
unconditional GET fallback and no automatic assessment/generation retry.

The P20 prerequisite incident was intermittent: the initial environment-reference
read failed with a missing-signed-header message; later actual SDK reads sent and
signed the exact header and returned both canonical reference hashes. This evidence
does not establish a persistent missing-header bug or a numerical 19/19 rejection.
Historical failed assessment records remain immutable. A new worker release and an
explicitly authorized new exact-range assessment remain separate acceptance steps.
