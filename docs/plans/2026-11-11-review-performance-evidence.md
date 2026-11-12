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

## Shared current-cut Preview and read-only queue slice

Preview now projects the saved Draft using its existing confirmation, identity,
selection and trim rules. Completed renders remain available without becoming
selected or approved. The response includes a stable cut fingerprint; unrelated
poll updates retain the mounted player input. Video is the default viewing mode,
with explicit still/timing alternatives and labeled gaps. Studio links carry the
shot and bounded selected song ranges without autoplay. Approval details collapse
separately from viewing. Queue loading is independent of Preview and begins only
when opened; a right-activity link discovers it.

The new authenticated project work route rechecks ownership before receipt reads
and conditional responses. It coalesces short-lived per-owner reads, bounds
concurrency, supports cancellation of motion-history reads and returns compact
shot/run/state receipts. Current-plan state is separate from retained history;
unreadable image receipts remain unavailable. Live Trigger activity is explicitly
account-wide. This route never submits, retries, reconciles or approves work.

Full check: 2,077 passed, 27 fixture skips, zero failures; production build passed.
Affected tests cover owner-first access, conditional/coalesced reads, safe errors,
unreadable receipts, bounded URL context, cancellation, and current-cut selection.
One final presentation change removed the duplicate scrub bar found in browser QA.

The mounted browser harness uses the actual CutReviewPlayer and ProjectRenderQueue
under React StrictMode and an existing local MP4 (no new media generation). With
0.1–2.1-second source trims, selection plays master song 0–2 then 6–8 seconds.
Native events show one unmuted audio element seeking to 6.000741 seconds, ending
at 8.007323 seconds, with muted current/standby video. Unmount during replay removes
all media elements and pauses the master at 0.18333 seconds. There are no queue
requests while collapsed. Opening shows the current A001 video as rendering;
including earlier plans adds the retained image, and Shot image targets A001.
Harness and screenshot: `.tmp/review-performance/player.tsx`, `serve-player.ts`,
`player-queue.png`. The fixture intentionally has no live Trigger session; this
does not verify public deployment, production counts or creative approval.

The same existing MP4 exposes a decoder edge case at source in-point zero:
ffprobe confirms its first video frame starts at 0.046029 seconds while audio
starts at zero. The existing frame-presentation gate rejects that first positive
timestamp and reports its bounded five-second decoder failure. This remains open
under V1S-458/460; testing an interior in-point proves range audio behavior, not
resolution of that edge case. No frame-validation gate was weakened.

Still open: project return-context restoration, raw-take review/adoption, durable
thumbnail/proxy preparation and hover scanning, public populated-film performance,
and complete narrow-layout/legacy selection acceptance. No deployment or film
mutation was performed for this slice.

### Explicit return viewing context

Studio Preview links now carry Story/Draft stage as well as shot and ranges.
Back to studio encodes the exact project and the current viewing selection.
The editor's existing owner-checked named-project loader restores that project
without substituting a global local draft. Once the matching project/audio is
restored, ranges clamp to song duration and focus resolves against current spine
slots. Context is consumed once per mount and cannot autoplay, adopt a take or
change timing. Invalid project identifiers are rejected; unknown stages resolve
to Story. Existing save-conflict/identity gates remain in the normal loader.

Verification: 15 affected URL-context, project-selection and playback-subscription
tests pass, typecheck and production build pass; lint has two existing StudioApp
warnings and no errors. This is route/state-model evidence; populated-app return
navigation and unsaved-window behavior remain part of final browser acceptance.

## Source suggestions are inspection, not section-wide adoption

The spine/inspector's old Takes and Other takes controls were section-wide
semantic source candidates wired directly to the Match mutation. They now say
Sources / Source suggestions, label scores as matching fit, and open a viewing-only
inspector instead. The Match placement action remains in its explicit Match flow.
Inspection resolves only the selected section's current candidate and source,
rejects missing/invalid/out-of-bounds ranges and is scoped to project/audio and
focused slot. It cannot change the saved match, draft selection or approvals.
Unavailable source inspection shows a clear message instead of silently doing
nothing. Source-strip images preserve 16:9 and overflow scrolls within the strip.

Only an explicitly opened suggestion mounts a single bounded native player;
it does not request media until Play source. It uses existing playback ownership
and cleanup, with no warm-source cache or presentation raster. Its source-audio
mode is labeled separately from current-cut master-song playback.

Full check: 2,080 passed, 27 fixture skips, zero failures; production build passed.
New tests prove current-candidate/source binding, range validation, immutability,
fit labeling and no eager media mount. Browser harness mounts the real inspector
and viewer under StrictMode with the existing MP4: zero media nodes/requests
before inspection; opening creates one paused video with zero media requests;
Play requests one source and stops before the exclusive two-second out-point
(native time 1.973079). Opening an unavailable source removes the video and shows
the fallback; the selected cut remains A001. Evidence:
`.tmp/review-performance/sources.tsx` and `source-suggestion.png`.

V1S-462 remains open for actual same-shot take comparison, explicit destination-
bound adoption, durable multi-shot replacement marks and submission reconciliation.
The harness does not verify these future actions or production film acceptance.

### Exact-shot take comparison and explicit Draft selection

The inspector now separately lists completed video takes for the selected planned
shot. The displayed segment retains its original target metadata; resolving a
partial selected-media window requires one unambiguous containing base shot.
Inventory requires the exact target song range, plan, section, destination and
animatic reference/review binding. Neighboring, overlapping or stale-plan takes
are not mislabeled as variants. Rejected or identity-blocked takes stay viewable
with their block reason; they cannot be selected through this panel.

Inspect take mounts one existing native saved-take viewer without selecting,
approving or fetching media. Use for this shot explicitly changes only the Draft
selection through the existing identity/selection rules, guarded by project,
exact current target and draft revision. Rejected/stale gestures preserve the
current draft rather than replacing it with an empty old-plan selection. The
asset bank and prior take remain intact, and pending approval stays pending.

Full check: 2,084 passed, 27 fixture skips, zero failures; production build passed.
Four regressions verify exact inventory/ref binding, selection/history/approval
separation, stale project/target/revision protection and split-window resolution.
Actual mounted panel under StrictMode: inspecting Take B leaves Take A selected
at revision 1, creates one paused video and makes zero media requests. Explicit
Use changes selection to Take B at revision 2; both assets remain banked/pending.
Playing and pausing uses the existing MP4. Evidence:
`.tmp/review-performance/takes.tsx`, `shot-takes.png`. No film writes or generation.

V1S-462 still needs durable multi-shot replacement marks, explicit submission
reconciliation and populated-film browser acceptance. These checks do not claim
the saved film has been selected, reviewed or approved through the new controls.

Follow-up restore ordering: the editor's persisted workflow activeTab was applied
after the initial URL-stage effect, so it could override an explicit return stage.
The project-bound return stage is now resolved after persisted UI settings and
only until viewing context is consumed. A regression covers saved Story → requested
Draft, the reverse, other-project isolation and ordinary saved-tab restoration.
Ten affected URL/project-selection tests, typecheck and affected lint pass (two
existing StudioApp warnings). This does not replace populated-browser acceptance.

## Durable replacement marks independent of the film draft

Story/Draft and standalone Preview now share a replacement review panel. Selecting
one or several exact cuts/sections can mark/unmark their planned shot targets.
Notes and marks use their own owner/project RustFS artifact and conditional ETag,
through an authenticated project-owned GET/POST route. They never autosave the film
draft, change media selection/approval, invalidate the cut or dispatch generation.
This avoids turning a review note in a second tab into a competing film writer.

Each mark retains its exact project/plan/destination/time/reference binding and
original note. Current status requires agreement between the displayed targets and
the server's fresh saved targets. Changed plans/references become stale marks;
they are not rebound automatically. A stale view cannot mark the new selection.
Marks can be cleared individually, by selection or as an explicit stale group.
Concurrent annotation updates reject stale revisions without losing locally typed
notes. Refresh preserves unsaved note text, and authorization failures hide cached
mark records. Malformed saved records fail closed rather than resetting history.

The endpoint bounds JSON writes to 2 MiB and marks to 512 entries / 2,000-character
notes, requires JSON content type and authenticates project ownership before any
artifact read/write. It reuses existing direct RustFS conditional object storage;
there is no local production fallback, new credential or environment variable.
Review list content mounts only when expanded and initially renders at most forty
rows. Merely loading Studio/Preview makes no marks request and loads no media.

Full check before final client stale-view/error presentation refinements: 2,091
passed, 27 fixture skips, zero failures; production build passed. Added domain,
store and isolated route tests cover binding changes, multi-mark/notes, persistence,
owner isolation, stale CAS, unknown targets, JSON/body bounds and safe failures.
Final client refinements are checked with typecheck/lint and mounted browser proof.

Browser proof mounts the actual panel with 108 synthetic shot targets and the real
review-store/domain functions backed by an isolated local fixture JSON artifact.
Two marks and a note survive reload; all 108 and the note survive a server-process
restart. The open list mounts forty textareas and no media; collapsing mounts zero
rows. Changing the reference image produces 108 stale marks. A second window whose
displayed plan is old also shows those marks as stale against the server's current
targets. Competing note saves produce a conflict; refreshing keeps the first
window's unsaved note text. Evidence: `.tmp/review-performance/marks.tsx`,
`serve-marks.ts`, `replacement-marks.png`. This fixture proves UI/store protocol,
not public RustFS persistence; production integration remains a release gate.

V1S-462 remains open for explicit multi-shot replacement preparation/submission
through existing generation/review gates and populated-film acceptance. Marking is
not a render request. No protected film data, media or jobs were changed for QA.

## Song-lane alignment and themed controls

User clarification: clips, waveform, time position and orange timing blocks need
matching time geometry rather than a separate playhead on every lane. The master
position remains full-song; a section viewport is a distinct, shared zoom scope.

The mounted selection fixture measured three different origins before correction:
clip strip x=12.667, waveform x=21.333 and timing graph x=37.333 CSS pixels. Nested
padding and a different scrolling width caused this mismatch. The fixed spine and
scrolling review panels now reserve the same stable scrollbar gutter; lane content
uses matching 16px panel insets. Removed the timing graph's extra nested frame and
the waveform's horizontal inset. Waveform CSS width retains fractional pixels;
the backing bitmap still rounds to physical pixels in the existing painter.

With an independently scrolling lower panel at 1280px viewport, clip strip and
timing graph both start at x=28.667 with width=1202.667; waveform starts at the
same x with width=1202.656 (less than 0.02px browser rounding). At 390px, both lanes
have width=312.667, waveform=312.656, with no horizontal document overflow. Choosing
Verse 1 shows A011–A015 and timing blocks 20–24 / 24–30 seconds together. No extra
playhead was added to the timing graph. This is component integration evidence,
not acceptance against the deployed film. Evidence: ignored local selection
fixture and `.tmp/review-performance/alignment.png`.

Twenty-three selection/cue/subscription tests and eight waveform/viewport tests
passed, along with typecheck. Affected lint has no errors and two pre-existing
StudioApp warnings. Production build passed before the final fractional-width
adjustment; the final adjustment passed typecheck and mounted-browser verification.
No film state or media changed. Full-song master-position behavior, real-film
navigation/performance and production acceptance remain open requirements.

Separate commits f2756bb and e3cdb2a theme parameter/time controls and checkboxes:
thin rails with rectangular handles/position lines, dark gray checkbox wells,
light gray borders and orange checks, preserving native keyboard and disabled
behavior. Checkbox production build and Chromium visual/input checks passed.
