# Deep Interview Spec — Smart Auto Music Video Editor Roadmap, Spec Workflow, and Media Protocols

## Metadata
- Date: 2026-04-05 UTC
- Profile: standard
- Rounds: 4
- Final ambiguity: 10%
- Threshold: 20%
- Context type: brownfield
- Context snapshot: `.omx/context/roadmap-spec-workflow-docs-20260405T010154Z.md`
- Transcript: `.omx/interviews/roadmap-spec-workflow-docs-20260405T012314Z.md`

## Clarity breakdown
| Dimension | Score |
| --- | ---: |
| Intent clarity | 0.87 |
| Outcome clarity | 0.90 |
| Scope clarity | 0.86 |
| Constraint clarity | 0.87 |
| Success criteria clarity | 0.82 |
| Brownfield context clarity | 0.86 |

## Intent
Build a smart music-video editing system that analyzes an uploaded song, ingests supplied video clips, and automatically reorganizes clip chunks so the edit feels musically synchronized and visually coherent—especially by preserving motion flow across cuts.

## Desired outcome
For the first serious version, the product should prove that:
1. audio analysis works reliably,
2. useful analysis is visualized,
3. video clips can be ingested and chunked,
4. the user can vary parameters and section focus,
5. preview playback stays smooth and musically aligned once a section is ready.

## In scope
- Audio upload and hosted analysis integration
- Visual display of useful music structure (beats, onsets, sections, energy/waveform)
- Video ingest from user-supplied clips
- Video probe/decode/chunking pipeline
- Section-scoped reordering/shuffling logic
- Motion-aware matching as a primary ranking signal
- Rich motion descriptors based on global motion field + residual motion + continuity score
- A visual sequencing/preview surface (not necessarily a full NLE timeline)
- Explicit recompute/loading states when preview assets must be rebuilt
- Documentation that standardizes roadmap, spec workflow, scripts, and protocols

## Out of scope / non-goals for the first serious version
- Final export pipeline as a must-have milestone
- Auth, billing, or collaboration
- Model training / fine-tuning
- Full professional timeline editing UX
- Mobile app delivery
- Pretending slider edits are live if the result becomes musically inaccurate

## Decision boundaries
The documentation and roadmap may decide without further confirmation:
- the documentation structure,
- the proposed roadmap phases,
- the recommended scripts and protocols,
- whether to recommend web-first versus desktop-contingent architecture,
- removal of stale older-model references from future project docs/artifacts.

## Constraints
- Documentation only in this pass; no feature implementation required.
- Web-first is acceptable for now, but desktop is an allowed contingency if latency evidence demands it.
- Latency is a product-level constraint.
- Accuracy is preferred over a shallow or quick-scan motion pass.
- Heavier verification/testing may use remote Tailscale-accessible hardware, including a Windows RTX 5090 machine or dockerized GPU pass-through workflows, while local macOS testing remains acceptable for slower validation.
- Playback quality is judged by musical alignment, not just frame continuity.
- Musical alignment always outranks secondary visual matching modes.
- The user supplies the source audio and source video clips.
- The existing codebase is already a Next.js brownfield app and should be treated as the starting point, not discarded casually.

## Testable acceptance criteria for the documentation set
1. The docs identify a clear phase-based roadmap for the app.
2. The docs define a repeatable spec workflow from idea -> deep interview -> plan -> implementation -> verification.
3. The docs separate **current authoritative scripts** from **recommended future scripts**.
4. The docs define a media-processing protocol that avoids overlapping analysis/playback work and prefers explicit recompute states over laggy pseudo-live playback.
5. The docs define ranking precedence where musical alignment is always primary and motion continuity is the default visual continuity mode.
6. The docs identify the primary architecture decision point that would justify staying web-first or pivoting to desktop/Tauri.
7. The docs record that future project documentation should remove stale older-model references and standardize on GPT-5.4-only wording where model mentions are necessary.

## Pressure-pass finding
Earlier intent emphasized “zero latency.” The pressure pass clarified that the real requirement is **smooth, musically accurate playback after explicit section recompute**, not reckless real-time mutation. This changes the architecture target from “live-update everything” to “section-scoped preparation + trustworthy playback.”

## Brownfield evidence vs inference
### Evidence from the repository
- `package.json` currently exposes only `dev`, `build`, `start`, and `lint`.
- `StudioApp.tsx` already models the control surface for split/join/shuffle/ramp and audio-driven segmentation.
- `audioAnalysis.ts` already performs upload + waveform decode + analysis normalization, but all orchestration is still UI-thread-adjacent.
- `mediaUpload.ts` currently probes duration and thumbnails in-browser but does not yet establish a deterministic preview/render protocol.
- `/api/essentia/full` already proxies a hosted analysis backend.

### Inferences used in this spec
- The existing app is best treated as a proving ground for a smarter preview architecture, not yet a production editor.
- The largest product risk is not missing UI controls; it is unstable media orchestration and latency under section recompute.
- Current scripts are too shallow to govern future media workflows; a more explicit script taxonomy is needed.

## Technical context findings
### Current repo shape
- App shell: Next.js App Router
- Main product surface: client-heavy `StudioApp`
- Existing external analysis contract: hosted Essentia-compatible endpoint
- Existing local browser media work: waveform decode, video metadata read, thumbnail capture
- Missing foundation: deterministic section preview pipeline, media diagnostics scripts, latency budget protocol, docs workflow

### Current industry-grounded protocol findings
### Motion-analysis direction (refined requirement)
- Do not treat cardinal direction tags like `N`, `SE`, or `W` as the main matching engine.
- Use them, if at all, as a derived UI summary only.
- The primary analysis model should favor:
  - global motion field,
  - residual motion after camera-motion estimation,
  - continuity score between adjacent candidate clips/segments,
  - accuracy over quick-scan throughput.
- This implies the roadmap should prefer offline/precompute or section-scoped feature extraction over shallow whole-clip tags.

1. **WebCodecs** gives low-level frame/chunk access and is suitable for editor-style media processing, but it has its own async processing queues and **does not demux containers itself**. It is useful for advanced local preview paths, not as the only foundation. Source: MDN + W3C WebCodecs docs.
2. **MediaCapabilities.decodingInfo()** can evaluate whether a candidate decode configuration is supported and likely smooth/power-efficient. This is valuable as a runtime gate before choosing preview formats. Source: MDN MediaCapabilities docs.
3. **WebGPU** is powerful for compute, but MDN marks it as limited-availability. It should be treated as an optimization lane, not the baseline requirement for first-pass preview correctness. Source: MDN WebGPU docs.
4. **FFprobe** is the best authoritative inspection layer for container/stream metadata in machine-readable form (including JSON output). Source: FFprobe docs.
5. **FFmpeg** supports stream copy (`-codec copy`) when cuts and containers allow it, and also supports segment/concat/list workflows when deterministic chunking is needed. This makes FFmpeg/FFprobe the safest core media backbone for first-pass correctness. Source: FFmpeg and FFmpeg formats docs.
6. **Tauri sidecars** can bundle external binaries such as FFmpeg/FFprobe and constrain execution permissions. This is the cleanest desktop contingency if browser-only latency becomes unacceptable. Source: Tauri v2 sidecar and shell plugin docs.

## Recommended architecture stance
### Recommended baseline
Adopt a **web-first, FFmpeg/FFprobe-backed, section-precompute architecture**.

### Why this is the best first serious stance
- It optimizes for correctness and musical alignment before chasing fully live mutation.
- It matches the user’s explicit preference for “show recomputing” instead of lag.
- It leaves room for browser preview UX while keeping hard media operations in a deterministic backbone.
- It preserves an upgrade path to Tauri if the browser execution model cannot meet the latency target.

### Architecture decision rule
Stay web-first **unless** section preview cannot reliably remain musically aligned after explicit recompute and caching. If that failure persists after workerization + precompute + asset gating, the roadmap should escalate to a Tauri desktop shell with FFmpeg/FFprobe sidecars.

## Segment ranking policy
- Primary ranking rule: musical alignment wins first.
- Default continuity mode: motion continuity.
- Secondary/alternate continuity modes may include color continuity and random ordering modes, but they do not outrank musicality.
- If a candidate clip does not fit a section cleanly, preferred fallback options are: slight trim, speed ramp in/out, reject placement, or layered overlap when the architecture supports it.

## Recommended media protocol
### Protocol A — Audio analysis plane
1. Upload source audio.
2. Run hosted analysis once per source track.
3. Normalize beats/onsets/sections/waveform into a canonical analysis model.
4. Cache analysis by asset fingerprint.
5. Never rerun full audio analysis due to mere UI slider changes unless the user changes the analysis mode itself.

### Protocol B — Video ingest and probe plane
1. Accept only user-supplied clips in first serious version.
2. Probe every clip for duration, dimensions, fps, codec, keyframe structure, and audio presence.
3. Normalize all clip metadata into a canonical clip manifest.
4. Reject or flag clips that are incompatible with the chosen preview path.
5. Use thumbnails/waveform-like summaries for fast browsing; do not treat them as the playback pipeline.

### Protocol C — Section recompute plane
1. User changes section or parameters or continuity mode.
2. Mark previous preview job stale.
3. Compute only the affected section, not the entire song.
4. Show explicit “recomputing section” progress.
5. Swap in the new section preview only when ready.
6. Preserve musical alignment as higher priority than apparent immediacy.

### Protocol D — Playback concurrency rules
- Only one active preview generation job per section key.
- Only one preview asset version may be marked current at a time.
- Playback must read from stable prepared assets, not partially computed state.
- Analysis tasks must not silently overlap with active playback in a way that causes drift.
- Stale jobs must be cancelable.

### Protocol E — Preview/render policy
- Prefer **stream copy / remux / segment reuse** when cuts align with what the media allows.
- Allow controlled speed-ramp accommodations when needed to preserve the musical hit while improving section fit.
- Fall back to **section-scoped re-render** when keyframes, codecs, or transitions require it.
- Do **not** promise fully live frame-accurate mutation from the browser as a first-pass invariant.
- If using browser-side advanced preview, gate candidates with `MediaCapabilities.decodingInfo()` and reserve WebCodecs for specialized pipelines, not container management.

## Testing and compute policy
- Local macOS testing is acceptable for correctness work, even when slower.
- Remote validation on Tailscale-accessible hardware is allowed and desirable for heavy media experiments.
- A Windows RTX 5090 machine or dockerized GPU-pass-through environment is an accepted test lane for high-cost analysis or benchmarking.
- The documentation should treat this as an execution/testing option, not a hard dependency for the first serious version.

## Recommended scripts and protocols policy
### A. Current authoritative scripts (already present)
| Script | Status | Meaning now |
| --- | --- | --- |
| `dev` | current | local app development |
| `build` | current | production build verification |
| `start` | current | run built app |
| `lint` | current | linting |

### B. Recommended next scripts (documentation target; not implemented in this pass)
| Script | Purpose |
| --- | --- |
| `typecheck` | `tsc --noEmit` verification lane |
| `check` | aggregate quality gate: lint + typecheck + tests |
| `probe:media` | inspect clip/audio assets via ffprobe and emit normalized JSON |
| `analyze:audio` | run or replay canonical audio-analysis fixture flow |
| `preview:section` | generate a deterministic preview asset for a target section |
| `bench:latency` | measure section recompute and ready-to-play timings |
| `doctor:media` | detect missing codecs/binaries/capabilities |
| `docs:spec:new` | scaffold a new feature spec from a template |
| `docs:spec:check` | validate required spec sections before implementation starts |

### C. Script governance rule
Scripts should be grouped by responsibility:
- **quality scripts**: lint/typecheck/test/check
- **media scripts**: probe/analyze/preview/bench/doctor
- **docs scripts**: spec scaffolding and validation

Do not let feature-specific scripts become ad hoc one-offs without a clear owner and input/output contract.

## Recommended spec workflow
### 1. Intake
Use deep interview when the request is ambiguous, new, or cross-cutting.

### 2. Spec creation
Create a short feature spec with these mandatory sections:
- Problem / intent
- User outcome
- In-scope
- Non-goals
- Architecture touchpoints
- Data contracts
- UI states
- Performance constraints
- Acceptance criteria
- Verification plan

### 3. Plan gate
Before implementation, create a plan artifact that translates the spec into:
- work phases,
- file/module touchpoints,
- test strategy,
- rollback / risk notes.

### 4. Implementation gate
No implementation should begin until:
- non-goals are explicit,
- acceptance criteria are explicit,
- latency / performance constraints are stated,
- verification steps are named.

### 5. Verification gate
Every media-affecting change should verify:
- no drift between preview and musical accents,
- no silent overlapping background jobs,
- no regression in section recompute behavior,
- no unsupported media format sneaking into the active path.

## Canonical documentation tree recommendation
```text
.omx/specs/
  deep-interview-*.md
  feature-*.md
  architecture-*.md
.omx/plans/
  prd-*.md
  test-spec-*.md
/docs/
  roadmap.md
  architecture/media-pipeline.md
  protocols/spec-workflow.md
  protocols/latency-budget.md
```

## Roadmap recommendation
### Phase 0 — Documentation and measurement foundation
- Define roadmap, spec workflow, and latency vocabulary
- Add media diagnostics/spec templates
- Record the architecture decision rule for web-first vs desktop pivot

### Phase 1 — Reliable ingest and canonical manifests
- Stabilize audio analysis contract
- Stabilize video probe contract
- Produce canonical source manifests for audio + clips
- Ensure section metadata is trustworthy

### Phase 2 — Deterministic section preview
- Build section recompute protocol
- Make progress/loading states explicit
- Ensure preview swaps only when assets are ready
- Measure recompute-to-play latency

### Phase 3 — Smarter ranking and sequencing
- Formalize motion-aware matching around global motion field + residual motion + continuity score
- Make motion continuity the default rejoin mode
- Add alternate rejoin modes such as color continuity and random mode
- Add section-aware shuffle/reorder heuristics
- Improve clip continuity scoring and fit policies, including trim/ramp fallback rules

### Phase 4 — Performance checkpoint
- Compare workerized web path vs desktop/Tauri contingency
- Decide whether browser path can satisfy the musical-alignment requirement under load
- If not, escalate to Tauri + sidecar media tooling

### Phase 5 — Later capabilities
- Final export
- richer editing controls
- remote asset sourcing or collaboration
- packaging/distribution hardening

## Documentation protocol for model references
- Future project documentation should remove stale older-model references.
- Where model references are necessary, standardize on GPT-5.4-only wording for this project’s documentation layer.
- Treat this as a documentation hygiene policy, separate from application behavior.

## Recommended source links
- MDN WebCodecs API: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- W3C WebCodecs spec: https://www.w3.org/TR/webcodecs/
- MDN MediaCapabilities decodingInfo: https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo
- MDN WebGPU API: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- FFprobe docs: https://ffmpeg.org/ffprobe.html
- FFmpeg docs: https://ffmpeg.org/ffmpeg.html
- FFmpeg formats docs: https://ffmpeg.org/ffmpeg-formats.html
- Tauri sidecar docs: https://v2.tauri.app/develop/sidecar/
- Tauri shell plugin docs: https://v2.tauri.app/plugin/shell/

## Handoff options
### Recommended next handoff: `$ralplan`
Use this spec as the requirements source of truth and turn it into canonical roadmap / PRD / test-spec artifacts.

Suggested invocation:
```text
$plan --consensus --direct .omx/specs/deep-interview-roadmap-spec-workflow-docs.md
```

### Alternative handoff: refine further
Only needed if the next round should focus specifically on ranking heuristics, section UX, or desktop-pivot criteria.
