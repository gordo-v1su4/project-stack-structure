# Responsive preview and scrubbing

## Outcome

Love Me Tonight must play its saved, musically aligned cut without perceptible loading pauses at every shot. The user can scrub the assembled preview while editing and while footage generation continues. Scrubbing preserves the previous paused or playing intent, with a single audible transport and the latest requested position taking precedence.

All work in this batch remains local. No PR, review dispatch, merge, release or deployment is authorized until Robert approves the batch. Do not reload the user's production window: a passive observation found a save conflict and potentially unsaved changes there.

## Measured starting point

The actual native player uses two visible/standby video elements plus a bounded warm pool. In an isolated, muted Chromium test using a 1344x768 technical MP4 and twelve 350 ms noncontiguous trims:

- Equivalent relative source URLs caused thirteen nonempty source loads, versus three with absolute URLs. Canonical assigned-source comparison reduces the relative case to three.
- Both double-buffer cases showed maximum local cut-frame intervals around 34–36 ms. This fixture did **not** reproduce the long production pauses.
- Four scrub jumps performed three or four source loads each. The URL fix alone did not eliminate teardown.
- Reported `playing` status could precede a presented frame by about 35 ms. Status is not frame-readiness evidence.

Frozen baseline/candidate source hashes, events and frame callbacks are in ignored `.tmp/playback-performance-20261109/` artifacts. These measurements do not certify physical display smoothness, GPU acceleration or production network performance.

## Implementation sequence

1. Canonicalize assigned source URLs without trusting stale `currentSrc` after stop. Preserve storage query distinctions and exact trim seek tolerance.
2. Replace destructive segment jumps with cancellable seek preparation. `seekToTime(seconds)` uses elapsed assembled-preview time, matching the existing state clock; it does not reinterpret absolute song timestamps. Reuse prepared decoders and retain the bounded warm pool. Actual stop, replacement load and detach still release resources.
3. Expose an accessible scrub control in the existing preview. Pointer and keyboard movement select arbitrary timeline positions; no project draft mutation or autosave is required per seek. Idle/ended seeks land paused. Late completion from an older seek must not replace a newer requested frame or transport state.
4. Verify decoded-frame readiness and cut handoff separately. Preserve saved source trim bounds, master-song alignment and single-transport ownership. Seek completion alone must not be presented as proof of a displayed correct frame.
5. Evaluate a WebCodecs frame path against the corrected native baseline using actual MP4 footage, codec capability checks, bounded frame ownership and a persistent audio clock. WebGPU composition can consume decoded frames, but cannot by itself remove fetch, demux or decode stalls.

## WebCodecs decision boundary

Beatmaxxer contains both native-video rendering and WebCodecs-related code. Its custom `DecodeScheduler`/`WebCodecsClipDecoder` path has a default unapproved MP4 demux adapter; it must not be copied as an established production playback engine. Inspect the actual MediaBunny-backed frame preparation paths before selecting reusable pieces.

The inspected MediaBunny-backed paths provide a concrete next prototype: `Input`/`UrlSource`/`MP4` with `VideoSampleSink.samples()` for forward decoding and `getSample()` for seeking. Beatmaxxer's native export bounds open inputs to two; its QA remapped source demonstrates a bounded copied-frame cache. These are useful mechanics, not proof that its main player runs this engine. The custom decoder also closes frames immediately after its output callback, so retaining those original frame objects would be unsafe. Do not copy that ownership bug. Do not build a resident full-song frame bank.

A WebCodecs path needs explicit container demuxing, supported codec configuration, cancellation of stale requests, bounded decoding/cache memory, and deterministic `VideoFrame.close()` ownership. Frame processing should move off the UI thread where supported. Keep a capability-gated native fallback. Unsupported codecs or unavailable acceleration must be visible in diagnostics rather than silently represented as GPU playback.

## Acceptance and verification

- Equivalent relative/absolute source URLs reuse a buffer; different object queries load the correct resource.
- Scrub jumps on an already assigned source do not call stop or clear both decoder sources. Rapid repeated seeks settle on the latest position, including while metadata or a prior seek is pending.
- Paused scrubbing remains silent and paused; playing scrubbing resumes from the requested source offset. Gap and end positions have defined behavior, without advancing past or truncating saved ranges.
- Keyboard access, labeled current/total time and pointer scrubbing work in an isolated browser fixture. Seek changes do not save or rewrite the project.
- Browser tests measure first correct frame timestamps, source load counts, waiting events and cut intervals. Compare against the frozen baseline; report any test that does not reproduce the production symptom.
- Inspect the real full-song boundary only after preserving the conflicted user window and coordinating exclusive playback. No overlapping production preview or background test may interrupt Robert.
- Unit tests, affected lint/type checks and the relevant browser measurement verify this batch. Production playback acceptance and any future WebCodecs replacement remain separate gates.

## Local verification checkpoint

The native seek/UI implementation is local and unreleased. The affected playback, frame-clock, ownership, subscription and scrub suites pass 76 tests / 488 assertions; affected ESLint and TypeScript checks pass. The production build passes.

The isolated UI fixture uses the actual React scrub control and keyboard hook with a fake engine: twelve browser assertions pass, including keyboard endpoints, pointer release, focus handling, cleanup, a narrow viewport and no extra React commits during 120 clock updates. This is UI evidence, not media-throughput evidence.

The separate actual-player Chromium fixture freezes engine SHA-256 `db6102099357f878ba9e435958d5d908bda59bca61d0dd1eeb7e798c2256b343`. Paused/reverse/different-source seeks match both presentation timestamps and independent native-video pixel hashes. Repeated same-source paused seeks issue no source loads; rapid requests settle on the last requested frame. Playing seeks retain playback intent; pausing during preparation still lands silently. Gap positioning and resumption pass.

An initial end-position check caught a real error: logical end 5 seconds with a final source trim `[3,4)` displayed source frame 4, outside the trim. The correction keeps logical time 5 but requests an included physical position just before 4. The browser now presents timestamp `3.958333` with the independent expected pixel hash; resuming at the endpoint ends without reloading or replaying the last cut. Endpoint handling does not widen the saved trim.

Evidence remains in ignored `.tmp/playback-performance-20261109/`, including `seek-db6102099357.json`, UI evidence and `build.log`. No production-sized pause was reproduced by the original local fixture. Physical display, production network/full-song playback and the proposed WebCodecs worker path remain unverified here.
