# Media Pipeline Architecture

## Summary
The media pipeline should be designed around **music-driven segmentation**, **post-cut segment analysis**, and **prepared section preview**.

The core rule is simple:
- **musical alignment wins first**,
- **motion continuity is the default visual mode**,
- preview playback must use **ready assets**, not partially computed state.

## Baseline Architecture Choice
### Chosen baseline
**Web-first UI + FFmpeg/FFprobe-backed section-precompute pipeline**.

### Why this baseline
- It matches the existing Next.js brownfield app.
- It gives a deterministic backbone for media probing and preview generation.
- It allows the UI to stay responsive while avoiding fake real-time playback claims.
- It preserves a later Tauri/desktop path if browser limits become unacceptable.

## Media Planes

### 1. Audio analysis plane
Responsibilities:
- upload source audio,
- call the hosted analysis endpoint,
- normalize beats/onsets/sections/waveform,
- cache the result by asset identity.

Rules:
- Audio analysis should not rerun for ordinary UI tweaking.
- Beats, onsets, and section structure are authoritative inputs to segmentation.

### 2. Video ingest and probe plane
Responsibilities:
- accept user-supplied source clips,
- probe each clip for duration, dimensions, framerate, codec/container, and keyframe structure,
- normalize the result into a canonical clip manifest.

Rules:
- Thumbnail extraction is browsing support, not the playback pipeline.
- Unsupported or risky media should be flagged early.

### 3. Segment generation plane
Responsibilities:
- derive candidate cut points from beats/onsets/sections,
- cut clips into candidate segments aligned to music events,
- produce a segment manifest that downstream ranking can use.

Rules:
- The atomic analysis unit is the **post-cut segment**.
- Fixed-duration chunking is not the primary segmentation model.
- Do not blindly quantize onsets/transients onto an arbitrary grid.

### 4. Segment analysis plane
Responsibilities:
- analyze every resulting segment,
- compute motion descriptors,
- prepare continuity scores for rejoin ranking.

## Motion Analysis Strategy
### Do not rely on coarse direction tags as the core engine
Tags like `N`, `SE`, or `W` may be useful as UI summaries, but they are too coarse for primary ranking.

### Required motion descriptor shape
The preferred model is:
- **global motion field**
- **residual motion** after camera-motion estimation
- **continuity score** between candidate joins

Additional useful fields may include:
- dominant motion angle
- motion magnitude
- motion coherence
- camera motion class
- subject motion strength
- confidence

### Why this is preferred
It is more accurate than shallow clip tagging and better matches the product’s continuity goal.

## Ranking Policy
### Hard ranking precedence
1. **Musical alignment**
2. **Motion continuity**
3. alternate continuity modes such as color continuity or random ordering

A visually attractive join must still lose if it weakens the musical hit.

## Fit Policy
When a segment does not fit a target section cleanly, acceptable fallback behaviors are:
- slight trim,
- speed ramp in/out,
- reject placement,
- layered overlap when supported by the final architecture.

This allows the engine to preserve musical correctness without forcing ugly quantization.

## Section Recompute Protocol
### Desired behavior
When the user changes a section, parameters, or continuity mode:
1. mark previous work stale,
2. recompute only the affected section where possible,
3. show explicit recomputing/progress feedback,
4. publish the new preview only when it is ready.

### Anti-drift rules
- only one current preview asset version may be active,
- stale jobs must be cancelable,
- playback must not race against half-computed outputs,
- active playback should never silently degrade because analysis is overlapping.

## Preview / Render Policy
### Preferred path
- Prefer stream reuse / remux / segment reuse when media constraints allow it.
- Fall back to section-scoped rerender when accuracy requires it.
- Allow controlled speed-ramp accommodations when needed to preserve the musical hit.

### Not acceptable
- pretending a stale preview is live and correct,
- silently missing beat accents,
- allowing playback lag to break the feeling of audio-driven editing.

## Compute and Test Policy
### Local baseline
Local macOS testing is acceptable for correctness-first development even if it is slower.

### Remote heavy-compute lane
When deeper benchmarks are needed, remote testing over Tailscale is allowed, including:
- Windows + RTX 5090
- dockerized GPU pass-through workflows

These are optional execution lanes, not a hard dependency of the product architecture.

## Desktop Pivot Condition
Move to a Tauri + sidecar architecture only if:
- browser scheduling or decoding prevents musically correct preview playback,
- section recompute cannot be made trustworthy under load,
- or the performance checkpoint shows the browser path cannot satisfy the product’s correctness standard.
