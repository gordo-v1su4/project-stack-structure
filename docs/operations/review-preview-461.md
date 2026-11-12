# Shared Preview and durable render queue — V1S-461

Initial implementation: `45807481a7cada1c690c44aa0e025fb12eb126f8`, on
`codex/animatic-motion-source-validation` in the existing D: worktree.
Public test build: [Actions run 43175693486](https://github.com/gordo-v1su4/project-stack-structure/actions/runs/43175693486).
Scroll repair: `3e359e7a7c7d47f4f5a4c6c401d9224c1f83be78`,
[repair publication](https://github.com/gordo-v1su4/project-stack-structure/actions/runs/43177584047).

## Change

The inherited shared Preview defaults to the selected Draft cut, labels still
fallbacks and timing gaps, and offers image/timing viewing modes. Its queue reads
owner-scoped durable image/video receipts and links exact shots; it never
dispatches or retries work. Right activity links to that same queue.

Unchanged cut fingerprints previously retained the entire old cut snapshot,
hiding newly delivered takes. Reconciliation now preserves only playback
segments, while refreshing availability and review metadata. Current-shot
coverage separates delivered takes, selected windows and currently approved
takes. New video arrivals are announced without adoption. The right queue link
carries stage, shot, song selection and viewport. Unknown receipts do not count
as running; historical-plan rows are explicitly labeled. Cue settings wrap by
available column width as bounded coupling to460.

Scene-direction review, take approval and exact-cut consent retain their
existing separate paths. Coverage does not create any approval receipt.
The103current available takes in the finishing film remain unselected.

## Development verification

- 15 focused tests: snapshot arrival/stable playback, current cut and pending
  selection, owner-checked queue/ETag/failure paths, viewing URL context.
- 13 playback subscription and resolved-selection tests.
- Typecheck passed; affected lint passed with the two existing StudioApp warnings.
- Real protected full-draft hashes before QA match the460 handoff: finishing
  `aace50749de17e84a18ff49cb455063e715a5c2d2732e509f5ff658358a8f6cc`,
  original `db8869edc20b187c6c31bf2df46e8e8bb66fb39433d2447cb4cf1598f79ce20d`.

Public criterion-specific acceptance is recorded below. Private raw receipts belong under `.tmp/review-performance/461-*`;
no project payloads, credentials or media are committed.

## Public acceptance

Initial publication passed hosted **2145 tests / 27 fixture skips / zero failures**,
production build, trusted-main activation and independent exact `/health`.
Visible signed-in in-app browser; native Chrome is not claimed.

- Default Current video cut showed0/108selected windows and103available current
  video takes. Current coverage table showed A0041ready/0selected/0approved,
  and unfilled opening slots0/0/0. Current-cut playback advanced the original
  master to9.843s with both video buffers muted/idle and an explicit still fallback.
- Queue showed206current-plan ready receipts,0waiting/running/failed/unknown.
  Include earlier plans showed275ready and2failed. Expanded retained S02failure
  exposed its durable job/run/time, with Earlier plan labeling. No live active
  job was created to obtain nonzero waiting/running counts; those transitions
  use canonical receipt states and fixture route/state coverage.
- Actual video A103receipt opened exact A103still2048x1152; Next reached A104;
  Close restored review. Image and timing modal modes played the same master;
  closing removed all modal media nodes. The original read-only Preview showed
 13/35selected windows; source video1280x720played muted at7.033759s with the
  sole audible master at7.035160s. It was paused and its QA tab closed.
- Back from Preview restored Story and Draft separately with A012,
  selection29.3–43.84s and the same viewport. Right activity opened the same
  shared queue already expanded, carrying this context. Both returns stayed paused.
- A controlled browser-only existing-take visibility test briefly hid A103
  metadata from one polling response, then restored the real server response.
 103available and New video takes ready for review:A103updated while the exact
  same audio DOM node continued playing, with one audible master. This is polling
  lifecycle evidence, not a new-generation/live-arrival claim. No server data changed.
- At measured CSS970x900, cue controls used2columns and music panel clientWidth
  equaled scrollWidth487px. Exercising controls produced a protected project PUT
  attempt blocked by a browser-only guard; local changes were discarded. This
  guard and the temporary viewport were removed with navigation/reset.

## Scroll defect discovered during public review

Robert observed colored placeholders and repeat loading when scrolling the still
board. The original thumbnail observer set visibility false on every viewport
exit, removing its image node. The repair makes loading one-way, retains viewed
320pxderivatives, and uses a page gate plus the board scroll root to preload
nearby rows without loading an initially offscreen board. Pending thumbnails
now say Loading thumbnail rather than implying their display is ready.

A temporary5000msnetwork-delay/cache-disable diagnostic was active during one
media-loading interaction and could aggravate his observed delay. It was removed
immediately on his report. The image-unmount defect was independently confirmed
in source and repaired. No network override is part of the application.

## Final repair acceptance

Repair run43177584047passed hosted2145tests/27fixture skips/zero failures,
production build and deployment. Independent public `/health` returned exact
`3e359e7a7c7d47f4f5a4c6c401d9224c1f83be78` before QA.

At actual CSS1280x720,18tracked opening thumbnails were320x180and fully loaded.
Real wheel scrolling reached the gallery bottom and returned to the top. All18
were the same connected image nodes; their thumbnail resource count stayed18→18.
96small derivative images were retained after visiting those regions.

Robert's specific middle-gallery case was repeated: A043–A060,18loaded images,
scroll up then down to the identical923.333pxscrollTop. All remained connected
and loaded; their recorded request count stayed36→36(no additional requests).
Native final screenshot: `.tmp/review-performance/461-final-public.jpg`.
The initial layout can prefetch30/108small derivatives as the board approaches
the viewport during player initialization; this is not zero offscreen work or
an eager full-original gallery download. Newly visited cards still need their
first fetch/decode. Returning to visited cards no longer destroys their images.

In the separate QA tab, temporary5000mslatency/cache-disable was applied inside
try/finally. A052and nextA053original images both had complete=false/naturalWidth0;
Next and Close worked before either completed. Finally restored normal network
and cache settings. No overrides remain. Source:461-delayed-media.json.

Final authenticated readback exactly matched both original full-draft hashes
above and protected revisions: finishing`cc65ad585238c4398526b995005e8822`,
original`e4833a39ffeac77a83e7a6657b3923f1`. No scene-direction, take, exact-cut
approval, adoption, generation or original-project write was made.

Linear Done read back at2026-11-12T07:55:25.147Z, completedAt
2026-11-12T07:55:25.120Z; evidence comment90bb3852-b0f1-452c-b1dd-4ce6789298de.
Fresh native458–464snapshot passed the boundary checker: no errors, no active
primary, nextV1S-462. Exact criterion evidence is in the execution plan.
