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

## Remaining acceptance

Earlier isolated browser measurements after the initial cache fixes still
missed the proposed 300 ms warm-stage budget: Draft approximately 542–559 ms,
Story approximately 1,016–1,085 ms. Those runs predate this remount fix. Do not
represent the new CPU measurement as a new browser result.

The browser connector changed during this diagnostic session. Its documented
tab navigation currently fails with an undefined `timeoutMs` error before
navigating, including on freshly created blank tabs. Raw CDP navigation was
rejected by the connector and was not bypassed. Public-browser cold/warm,
selection feedback, visible media readiness, first-frame and playback-lifetime
acceptance therefore remain unverified for this commit. V1S-458 remains open;
later issues remain queued until this gate is resolved.
