# Populated-film navigation evidence — V1S-458

## Scope and current gate

V1S-458 is the sole active issue in the sequential V1S-458–464 batch.
This record distinguishes model/render measurements from browser acceptance.
No source media was generated or replaced, and no saved project was written.

## Story remount bottleneck

The existing populated-film diagnostic snapshot contains 108 shot slots. Story
constructed its placement model inside the conditionally mounted Story panel.
Consequently, switching away and back discarded that panel's `useMemo` result.

StudioApp now owns the pure preview-model memo and passes it to Story. Its
dependencies include analysis, source footage, section drafts, lyric transcript,
edit settings and confirmed treatment/source context. Stage and focused-beat
changes do not invalidate it. Actual Story confirmation still separately builds
and validates the arrangement before publishing it. Hidden panels/players are
not retained to obtain this reuse.

Same-input production React server-render comparison on the existing populated
fixture, November 11, 2026:

| Story render path | Three samples (ms) |
| --- | --- |
| Rebuild placement model on mount | 376, 393, 369 |
| Reuse parent-owned model | 8, 8, 7 |

Both paths produced byte-identical rendered markup. A SHA-256 comparison of the
input film before/after remained identical. This is a CPU/render measurement in
Bun, excluding browser layout, transfer and decoding; it does **not** establish
the public-browser stage-switch or selection budget.

The local reproducible harness and measurement output are ignored diagnostic
artifacts under `.tmp/review-performance/measure-story-remount.ts` and
`story-remount-model.json`. The committed Story test checks identical output
through the parent-owned model path and forbids project publication on render.

Validation: Story-filtered tests passed; the final five StoryTab tests passed
with 42 assertions. Type checking and the production build passed. Affected
Story/test ESLint checks passed. StudioApp retains two pre-existing warnings.

## Browser verification after connection recovery

The in-app browser returned after the connection change. The following checks
used supported browser APIs in separate diagnostic tabs at 1280 × 720. Existing
user/save-conflict tabs were not reloaded or saved. Production project/draft
writes were blocked in the public diagnostic tab before view changes. The
candidate harness rejects all writes and generation and serves a private copy
of the populated film: 21 sources, 90 moments, 108 shot slots and 174 assets.
Its missing media responses deliberately separate CPU/UI work from delivery.

Measurements stop after the destination DOM marker commits and two animation
frames pass. An unconditional two-frame timer can finish before a deferred
React update; those misleading samples are excluded. Accessibility snapshots
were collected after the timed interval, not used as the clock.

| Boundary | Existing public app | Controlled candidate |
| --- | --- | --- |
| First Draft mount | 2,334.7 ms | 481.0 ms |
| Repeat Draft navigation | 2,981.9 ms | 389.2, 346.8 ms |
| Story return | 7,186.3 ms | 787.5 ms first; 597.7, 625.6 ms repeat |
| Select A013 in Story | 1,649.3 ms | 293.3 ms |
| Select A013–A015 in Draft | not sampled | 83.5, 109.5, 73.0 ms |

The same isolated harness before the latest autosave/context/hidden-panel fixes
recorded Draft at 898.9/959.0 ms and Story at 783.3/751.9 ms. The public and
isolated environments are **not** a production before/after comparison: public
uses real media and the deployed bundle, while the isolated fixture excludes
media delivery. No candidate improvement is claimed deployed.

**Budget misses remain explicit:** the proposed 300 ms warm-stage budget is
missed; Story selection misses 100 ms, and one Draft selection sample was
109.5 ms. The requirement says to report misses rather than silently relaxing
them. These results establish the bounded diagnosis/repair outcome, not a claim
that all proposed budgets have been achieved. Prepared delivery and its final
500 ms hover check remain V1S-459's boundary.

### Separate delivery, decoding and browser work

- Two public populated-project reads transferred 2,101,786 bytes and expanded
  to 14,204,363 bytes, taking 1,256.4 and 819.4 ms. The fresh document response
  took 252.0 ms; DOM-ready was 329.0 ms and load 374.8 ms. These do not include
  later project normalization and thumbnail readiness.
- Image observation attached at 9,110.2 ms after navigation, with four images
  already ready. It observed 77 visible image loads between 9,294.3 and
  15,704.7 ms. At the recorded sample 81/117 image elements were ready. This is
  a partial cold-load observation, not an invented exact first-image timestamp
  or a claim that every thumbnail succeeded. An earlier settled public sample
  had 108/117 ready.
- Existing native take playback presented a 1344 × 768 frame at media time
  0.041667 s, **1,162.8 ms after the actual Play click**, measured with
  `requestVideoFrameCallback`. A repeat source assignment reached metadata in
  1,180.1 ms and decoded data in 1,276.3 ms. The open-to-play orchestration gap
  is excluded from the 1,162.8 ms measurement. This is a baseline for original
  playback, not prepared-hover acceptance.
- Captured browser CPU profiles distinguish React render/commit stacks from
  repeated synchronous project/policy hashing. Examples include the autosave
  sanitizer, monitor animatic context and take identity display calculations.
  Native `(program)` samples are not mislabeled as React, decoding or network.
  The separate model/SSR experiment above measures pure render/model cost;
  it is not substituted for browser click-to-paint timing.

### Demonstrated repairs and lifecycle checks

- Stage changes reuse the already sanitized content snapshot for named-project
  autosave. Save timestamps are refreshed cheaply when writing; server
  validation, revision guards, uncertain-ACK handling and project epochs remain.
- Monitor context and displayed take/identity calculations reuse exact immutable
  inputs; action-time checks still run. Selected legacy takes retain their
  identity warnings. No global approval cache was introduced.
- Closed advanced Draft controls previously mounted 12,186 hidden DOM nodes;
  the full Draft contained 19,106 nodes. Before first opening, the advanced
  panel now contains only its summary and Draft has 6,823 nodes. Opening mounts
  the controls; closing retains their 12,186 nodes/state until leaving Draft,
  avoiding disposal of work merely because the disclosure closes.
- With six media requests deliberately delayed by three seconds, A013 selection
  painted in 286.4 ms while six requests remained pending. This is a liveness
  test with missing-media responses, not a video-decoding throughput claim.
- Existing public take inspection played without adopting footage; leaving
  Draft removed its take player. The observed post-navigation state had zero
  playing media elements and zero saved-take players. Candidate disclosure and
  navigation checks likewise ended with zero active media. Existing ownership
  and transport lifecycle tests passed in the full check.

Private raw profiles, samples and screenshots stay ignored under
`.tmp/review-performance/`: `public-navigation-baseline.json`,
`public-cold-load.json`, `candidate-navigation-final.json`,
`media-loading-liveness.json`, `navigation-after-dedup.cpuprofile`,
`selection-isolated.cpuprofile`, and `navigation-current-evidence.png`.

Validation for this slice: full check 2,130 passed / 27 fixture skips / zero
failures, production build passed. After the final legacy-selected warning
inclusion and save-timestamp preservation, the six live-draft tests, thirteen
save-session tests and type check passed. Two pre-existing StudioApp lint
warnings remain. No deployment, AI/GPU generation, PR or GrepTile review ran.

## Historical incomplete checkpoint

Earlier isolated browser measurements after the initial cache fixes still
missed the proposed 300 ms warm-stage budget: Draft approximately 542–559 ms,
Story approximately 1,016–1,085 ms. Those runs predate this remount fix. Do not
represent the new CPU measurement as a new browser result.

The browser connector changed during that earlier checkpoint. Its documented
tab navigation failed with an undefined `timeoutMs` error before
navigating, including on freshly created blank tabs. Raw CDP navigation was
rejected by the connector and was not bypassed. Public-browser cold/warm,
selection feedback, visible media readiness, first-frame and playback-lifetime
acceptance were then unverified for fc099ef. The recovered-browser evidence
above supersedes that temporary verification blocker.
