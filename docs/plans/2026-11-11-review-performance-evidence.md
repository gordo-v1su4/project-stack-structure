# Review performance diagnosis and implementation evidence

## Public-browser baseline

Read-only inspection of the existing populated finishing project on November 11
found 160 image resource entries, 114 distinct image URLs, 313.68 MB encoded
image bodies and 136 image requests larger than 1 MB. Forty-one image URLs had
multiple resource entries; the longest recorded image request was 12,773 ms.
These are cumulative entries from an already-open session, not a clean cold-load
measurement or a causal React benchmark. Images displayed around 78–318 CSS
pixels included 1280×720 and 2048×1152 source images. The media proxy sends full
source bytes with private/no-store headers. Gallery code used those original
URLs, so shrinking the CSS did not shrink downloads or decoded image memory.

## First slice: viewing thumbnails

- The existing authenticated media route accepts only fixed 320/640 thumbnail
  sizes, after the same owner/path/bucket checks as source playback. Metadata
  and byte ranges cannot be transformed. Originals keep their existing behavior.
- WebP viewing images fit inside a 16:9 bound, retain aspect ratio and never
  enlarge the source. Full-quality inspection links/viewers retain source URLs;
  thumbnails do not enter conditioning, approval bindings or export inputs.
- Preparation has a 20 MB compressed input limit, 40 million decoded pixel limit,
  five-second Sharp processing timeout, two active conversions and 64 pending
  entries. A 32 MB / 256-entry / ten-minute in-process LRU and coalesced requests
  avoid repeated preparation. Cache keys include owner, source, size and version.
  Authorization runs even for cache hits and conditional 304 responses.
- This first cache is deliberately a bounded runtime cache, not a claim that
  durable RustFS thumbnail/sprite/proxy preparation is finished. That remains
  part of V1S-459, together with ingest/generated finalization and backfill.
- Story and standalone still grids share viewport-bounded thumbnail cards.
  Story now uses the standalone six-column desktop proportion, rather than
  96-pixel cards that display only selected neighbors. Cards use compact duration/
  readiness metadata; titles remain accessible and available on hover/inspection.
  Clicking opens full-size inspection. Scene-proof and still-generation inline
  images also use viewing thumbnails with full-quality links preserved.
- Animatic spine thumbnail projections use the small derivative; the top
  filmstrip's layout/size is unchanged.

## Verification

Affected tests: animaticDraft, spineSlots, animaticPreviewRoute and
storagePrivacyRoutes. The route tests use real Sharp output and check dimensions,
byte reduction, conditional requests, authorization after caching, source-byte
preservation, concurrent coalescing, invalid input and bounded streaming.
Full `bun run check` passes: 2,065 tests passed, 27 fixture skips, zero failures;
lint has five existing warnings and no errors; type checking passes. Final
production build is checked for the slice commit as well. React best-practices
review covers effect cleanup, viewport-bounded fetching, explicit source versus
derivative URLs, accessible shot labels, and no per-card video players.

An isolated local browser mounts the real card and image-viewer components using
108 synthetic shots and the production-built CSS. Initial viewport: 18 mounted
320×180 images, each 1,084 bytes (19,512 bytes total), no original-image requests.
Clicking A001 loads its 2048×1152 original; Next opens A002. After closing and
scrolling to shots A049–A072, 24 small images are mounted, all 320×180; the only
two original-image requests remain the two explicitly inspected shots. This is
component/derivative proof, not a substitute for populated-film production QA.
Local evidence: `.tmp/review-performance/gallery.png`, `cards.tsx`, `serve.ts`.
No real media generation or saved-project edit is used by that harness.

## References supplied by Robert

Review Room is the thumbnail/sprite reference; Trailer Feed is the preferred
playback behavior reference, with either available as supporting evidence.
Read-only source inspection confirms Review Room prepares separate durable
thumbnail and sprite files and serves version-specific owner media. Trailer Feed
uses native HTML video for the active artifact/version and a focused preview or
lightbox with its own scrub/transport controls. Its poster preparation scales to
640 pixels. These facts guide reuse of delivery/player patterns; they do not
establish that changing React to Svelte would solve this application's lag.

SwarmUI/ComfyUI investigation and generation-workflow tuning are excluded by
Robert. Neither is needed to test the existing-media review path.

## Linked range selection slice

Diagnosis: section/cut selection was wired to Join only, whereas the timing graph
kept a separate local suggestion ID. Markers painted over its block buttons
intercepted pointer input. The preview spine also divided its local elapsed
clock by full-song duration, which points at the wrong song position during a
mid-song or separated-range audition.

Story, Draft and Join now share an ephemeral song-time selection. Ordinary click
replaces it, Shift-click extends from the original anchor, Ctrl/Cmd-click or the
visible multi-select mode toggles ranges, and Shift-drag adds whole intersected
blocks. Section zoom is emitted to the graph; graph markers are pointer-transparent
so buttons respond through their full height. Missing selected footage is shown
separately from musical timing suggestions. Selection does not save, rearrange,
dispatch work or start playback.

Play selection prepares a separate audition in song order, with each segment's
absolute master-song position preserved. Partial windows trim at normal speed;
short footage and missing intervals remain gaps rather than being stretched or
silently skipped. Separated selected ranges are explicitly labeled comparison
jumps. The audition retains its own range snapshot while the next selection is
edited; Return to full cut pauses and restores the normal preview. Project/audio
context and source-array guards prevent old audition snapshots being reused for
a different project or changed media selection. The spine maps the local audition
clock back to song time, and seeks map song positions to local audition offsets.

Five model regressions verify immutable selection, toggle/subtraction, anchored
extension/addition, exact source/master clipping and visible missing coverage.
Affected selection, cue-map, subscription and footage-label tests pass. Full
check before the final presentation-only audition label: 2,070 passed, 27 fixture
skips, zero failures; lint retains five existing warnings. Final typecheck and
production build also run for this slice.

Browser proof mounts the actual BeatSpine, MusicCutExplorer and selection-bar
components with a synthetic sixty-second song: Chorus 1 and Ctrl-click Chorus 2
select 10–20 and 30–40 seconds; focusing each updates both views. Play selection
prepares precisely those two windows, in order. Shift-click A016→A019 selects
30–38 seconds. A real Shift-drag adds cuts A023–A024 (44–48 seconds) without
removing the choruses. Center-clicking the 34–38-second suggestion replaces the
selection; the visible multi-select button adds 52–56 seconds without modifiers.
Evidence: `.tmp/review-performance/selection.png`, `selection.tsx`,
`serve-selection.ts`. This harness verifies component gestures and preparation,
not audible playback or full StudioApp/project persistence acceptance.

Still open in V1S-460: actual mounted-player master audio across skipped ranges,
the standalone shared Preview integration under V1S-461, legacy Join editing
selection reconciliation, narrow layouts and real populated-film browser proof.
No project data or generation is used for these synthetic checks.
