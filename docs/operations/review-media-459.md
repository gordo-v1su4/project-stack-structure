# V1S-459 review media verification

Verified November 12, 2026, in the existing `codex/animatic-motion-source-validation`
worktree. This is candidate acceptance, not a deployment receipt. No project
save, take adoption, approval, AI/GPU generation, server upgrade or public release
was performed. V1S-458 measurements remain in their own evidence record.

## Delivered behavior

- Durable, owner/source-version-bound thumbnails, silent proxies, posters and
  scrub sheets; safe existing-film backfill through an authenticated project
  route, CAS receipts and sequential Trigger child preparation.
- Visible-first still/poster loading; top timeline images explicitly use
  320-pixel viewing derivatives and high fetch priority. No original-video
  fallback on hover and no per-card idle decoder.
- One exclusive silent hover player, starting at the preview trim's beginning
  on every entry. **Pointer movement does not seek.** Robert observed the old
  automatic-playback/pointer-scrub conflict in the visible browser; it was removed
  and the actual left/right gesture was retested. Stored scrub sheets remain
  available as artifacts without an overlapping gesture.
- Only the embedded Story board changes from six to four desktop columns,
  preserving 16:9 frames and compact metadata. Actual image clicks open one
  full-size original; next/close keep review and cut state unchanged.
- Preparation and existing replacement-review controls move into the stage's
  scroll region. Visible testing found the new fixed panel had reduced Story's
  scroll area to zero at 1280×720; the final layout provides 234 pixels and the
  gallery is reachable. This placement-only coupling with V1S-462 is bounded in
  the execution plan; its feature behavior is untouched.

## Visible browser checks

Used the visible in-app browser, including actual clicks, wheel scrolling,
pointer movement, keyboard activation, playback and screenshots. Chrome's
adapter created a blank diagnostic tab but failed navigation with an internal
timeout-options error. **Native Chrome acceptance is not claimed.**

Two deliberately isolated browser surfaces were used:

1. Production `StudioApp` with the saved finishing-film snapshot: 21 sources,
   90 moments, 108 shots and 174 generated assets. All 108 current stills were
   read from existing storage, checked against their recorded SHA-256 and shown
   through the real thumbnail encoder/cache. Film writes and generation return
   403. Local durable-thumbnail fixtures are separate from live RustFS proof.
2. Production `BeatSpine`, `ReviewVideoHover` and preparation panel with the
   same 108-shot timing/stills and deduplicated 194-video inventory. The already
   retained A108 clip is explicitly bound for isolated viewing; this does not
   select it in the saved film. Mock job/readiness transport is labeled in the
   visible page. Actual MP4/WebP bytes decode in the browser.

The second surface verifies interaction/lifetime, not production dispatch. Its
single ready source is intentional; other unavailable media are labeled.

| Interaction / boundary | Observed result |
| --- | --- |
| Top tiny slices above waveform | 108/108 loaded, actual 320×180 pixels, `thumbnail=320` with exact version, `fetchPriority=high`; no board images requested while offscreen |
| Idle media | Studio monitor has two paused buffers with no `src`; no per-card players. Isolated cards have zero videos |
| Tiny A108 hover | One muted 640×360 decoder in a clamped 320×180 floating preview; the cut remains 11.58 CSS pixels wide at the comparable 1280×720 viewport; selection stays empty |
| Left → right → left on playing card | Over 53.8 ms, media advanced 53.827 ms; seeking-event count stayed 12 → 12. No pointer-induced jump |
| Leave / re-enter | Leave removes all hover videos; every recorded re-entry first presented frame has `mediaTime: 0` |
| Master ownership | With pointer on the card and keyboard focus on Play master, keyboard activation produced a real audio-play event: audio unpaused, hover videos zero on the next animation frame |
| View close | Clicking Toggle review view leaves zero cards and zero video elements |
| Missing derivative | Hover shows “Preview unavailable · inspect clip”, with zero videos and no original fallback |
| Story board | Actual wheel scroll reaches four 16:9 columns, 181.67-pixel card width at 1280×720; cards use 320-pixel derivatives |
| Click original | Actual A001 click: modal visible after 146.2 ms; image load/next animation frame after 194.2 ms. A002 next image remains the original 1280×720; close removes the modal |
| Backfill uncertain ACK | First POST intentionally returns 503. After changing the displayed source list, Reconnect uses the same UUID and byte-identical 194-source list. Two HTTP submissions represent the same intent; no duplicate intent |
| Compact completion | One ready row notifies the visible source's poster without reloading the project; 1/194 ready and 193 unavailable are reported honestly. Readiness peak two; no idle video request |

## Transfer, first frame and cold/warm conditions

All 108 still sources total **237,334,433 bytes**. Their actual 320-pixel WebP
responses total **592,162 bytes** (99.75% fewer image bytes), plus response
headers. The cold browser sends no original still request. Only explicit A001
and A002 inspection later request originals. Source SHA checks and the fixture's
write block protect the original film.

Cold means first derivative preparation with empty local derivative/runtime
caches and browser responses; source reads traverse existing remote storage.
First thumbnail request starts at 2479.5 ms after document navigation; first
image loads at 2857.4 ms; all 108 finish at 9995.4 ms: **7.516 seconds from first
request to final image**. This is an explicit cold preparation delay, not an
instant-load claim. Queueing, transfer and encoding are included.

Warm means prepared copies exist and the same document is reloaded with the
browser cache available. First request starts at 2780.9 ms; all images finish at
2838.1 ms: **57.2 ms from first request to final image**, zero network transfer
bytes for those cached image responses. This does not erase the separate
approximately 2.8-second populated-app startup/model cost from V1S-458.

Prepared-hover tests use the existing A108 original: 1,797,090 bytes,
1344×768, 124 frames at 24 FPS. Its silent proxy is 165,506 bytes, 640×360 with
the same 124 frames; poster 3668 bytes, scrub sheet 59,453 bytes. Full proxy
size is 90.79% smaller than the source. The source SHA-256 remains
`65803e4f4e1cb3bd0d30669e3acfca3c7980a4329a5d30a771280e8054c4283a`.

Final gesture-corrected hover measurements include the 280 ms dwell:

| Condition | Enter → first presented frame | Decoder mounted → frame | Native decoder processing |
| --- | ---: | ---: | ---: |
| Cold HTTP cache, tiny A108 cut | 348.3 ms | 22.6 ms | 6.7 ms |
| First card repeat, HTTP cache enabled | 354.6 ms | 31.8 ms | 7.1 ms |
| Further warm card entries | 334.1 / 332.8 / 333.6 / 332.9 / 350.2 ms | 13.7–41.0 ms | 6.0–10.1 ms |

All these prepared-hover samples meet the unchanged **under-500-ms** target.
Pre-correction samples were 358.3 ms cold /333.9 ms warm; final acceptance uses
the gesture-corrected samples above. Derivative-not-ready time is not counted as
prepared-hover success.

An explicit click on the same original's native Play control presents its first
frame in 43.1 ms on loopback, decoder processing 7.1 ms. Original range requests
transfer 776,132 body bytes in this observation; proxy responses carry 165,506.
The short-clip decoder processing times are similar. The evidence supports
substantially smaller transfer and decoder resolution, not a universal decode
speedup. Hover has an intentional dwell, so its total latency is not compared
directly to a click that has no dwell. No zero-latency claim is made.

## Automated boundaries and limitations

Full `bun run check`: **2139 passed, 27 fixture skips, zero failures**, with five
existing lint warnings. After final panel placement and pointer-scrub removal:
affected backfill/hover/poster/thumbnail tests, lint (zero errors), typecheck and
production build pass. The Bash runner isolates the new route test; this is a
necessary test-isolation change, not a diagnostic runner workaround.

Coverage includes auth-before-storage, exact owned-project legacy authorization,
bounded requests, immutable intent/source/parent bindings, private metadata
families, CAS contention, sequential children, durable receipt requirements,
ready-artifact reuse, changed sources, cancellation and no original fallback.
The actual S3 SDK/FFmpeg loopback integration validates private manifest
publication, original-byte integrity and reusable derivatives. It is not a live
Trigger/RustFS acceptance run. No shared storage privacy contract is altered.

The final release still needs compatible web/worker publication and signed-in
public-browser dispatch, live storage/readiness and playback verification. That
release gate is intentionally separate from this no-deployment batch.

Local raw evidence and screenshots are retained, uncommitted, under
`.tmp/review-performance/459-*`: film cold/warm load receipts; corrected hover,
pointer-motion, master-play-event and original-comparison JSON; backfill receipt;
timeline-loaded, story-gallery, image-enlarged, tiny-cut-hover and card-playing
JPEGs. The full application/interaction harnesses use existing media only.
