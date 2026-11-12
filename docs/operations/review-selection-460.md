# V1S-460 — shared selection and published acceptance

Implementation: `b1cdf29`, publication repair `0429e32`, refresh repair `67cc533`,
exact song-time highlighting/layout correction `f64bf87`, and comparison-jump
audio/video start barrier `07bc3e5`.
Worktree: `D:/StackStructureWorktrees/animatic-motion-source-validation`.
One writer; original projects, source media and approvals remain protected.

Robert changed the acceptance boundary during this ticket: publish the full
accumulated worktree as a **public test build**, exercise it visibly in the live
browser, repair and republish failures, then close the individual Linear ticket.
The combined PR/GrepTile review stays after V1S-464. Successor chats use GPT 6.1
Sol Medium. The stale no-deployment sentence in the copied goal does not override
his subsequent explicit clarification.

## Implementation

- The timing graph accepts clicks throughout each block's height. One shared
  white time band spans the exact selected song interval in the clip strip,
  waveform and timing graph, including partial clips/cues. Orange remains
  musical strength; ◆ identifies focused shot independently. The section
  overview also projects the exact selection, with partial button state.
- Range/duration labels retain millisecond precision. Optional source suggestions
  collapse below the waveform, keeping timeline lanes together. Panel content
  can shrink and cue summaries wrap, retaining both horizontal panel borders.
- Standalone Preview has the same cut/section selection lane, explicit audition,
  focus and viewport controls. Viewing links carry disjoint ranges, focused shot
  and exact viewport in both directions without an autoplay or edit instruction.
- Join uses the shared song-time ranges when displaying and auditioning separated
  cuts. Skipped song intervals are listed as comparison jumps.
- Source-zero playback accepts an initial positive video PTS. Interior in-points
  still wait for the containing frame; exclusive out-points remain exclusive.
- The reported review checkbox uses an 18px dark well, brighter border and orange
  check, preserving native semantics and keyboard operation.

## Publication and checks

The manual exact-revision workflow was installed on trusted main in `a5745b2`.
Only the workflow and its runbook were added there; implementation remains on the
existing branch for the final PR. The private runner executes the deployment
script from the trusted main workflow commit. Hosted builds use the selected
40-character revision and existing checksum/revision/authentication/rollback gates.

The first build, [43166596289](https://github.com/gordo-v1su4/project-stack-structure/actions/runs/43166596289),
failed before activation in the existing VFR derivative integration test. The
initial test partition reported 1,620 pass, 27 skip and one failure. Public
revision `251517b` remained active.

The failure reproduced in FFmpeg 7.1.5 in an isolated temporary container limited
to two CPUs and 2GiB: filter-level PTS reset yielded 20 decoded frames from 21.
Normalizing the input clock before filtering (`-copyts` and `-itsoffset`) retained
21/21 frames with zero relative PTS error, keeping the source edit list intact.
No frame-count or timing threshold was relaxed. The source frame-count, timestamp,
SHA, audio stripping, rotation and cancellation assertions remain unchanged.
The container was removed; no service/runtime upgrade was performed.
FFmpeg documents [input timestamp preservation and offsets](https://ffmpeg.org/ffmpeg.html#Advanced-options).

Local affected tests passed (34 selection/viewport/subscription tests; 24
presentation/selection tests, overlapping those 34; and three media integration
tests with 48 assertions). Typecheck and lint passed with five existing unrelated
warnings. The production build passed with existing Windows standalone trace-copy
warnings. Hosted checks/build and public interactions are separate gates.

Second public test build:
[43168758099](https://github.com/gordo-v1su4/project-stack-structure/actions/runs/43168758099),
candidate `0429e32ae71a4a101434f6359f7d93fb9cbe285c`.
Its full hosted check passed 2,141 tests with 27 fixture skips and zero failures;
image build, activation, exact revision/authentication checks and managed readback
passed. Public `/health` independently returned the candidate's exact SHA.

That public load exposed preparation panels accumulating on every refresh.
Preparation, replacement and queue siblings shared the same React key. Fix
`67cc533` gives each sibling a distinct identity in Preview and Studio, and puts
Preview's range/duration controls beside its timeline above the large video.
The next public test build is
[43169643982](https://github.com/gordo-v1su4/project-stack-structure/actions/runs/43169643982).
It passed the full hosted check (2,141 pass, 27 skip, zero failures), build,
activation and exact public revision check.

Robert's public review then exposed a misleading visual selection: the
16.347–17.715s cue outlined both overlapping clips in full. `f64bf87` removes
whole-clip/cue outlines for partial intersections and reuses the same exact-time
projection in all lanes. Local affected tests passed18/18, typecheck passed,
affected lint had zero errors and two existing Studio warnings. Its public run
is [43172029633](https://github.com/gordo-v1su4/project-stack-structure/actions/runs/43172029633).

## Public browser acceptance

Initial published interactions verified adjacent sections `0–29.3s`, separated
sections `0–14.75s / 29.3–43.84s`, visible multiselect removal, and Shift-selected
cuts `14.75–24.458333333333332s`. Graph top/bottom edge clicks selected
`14.750–16.347s` and `16.347–17.715s`; their hit areas span 94.32px inside the
95.99px graph including its borders. Audio remained paused at zero. The Preview
link carries A009, the exact cut range, and viewport `14.75–29.3s`.

On `67cc533`, actual public Studio→Preview→Back navigation preserved focused
A009, disjoint ranges14.75–17.125s/22–24.458333333333332s and viewport14.75–29.3s.
Two separated windows played using one unmuted master audio: start14.75s,
comparison seek22s after approximately2.468s, pause24.466309s. Source video buffers
remained muted. The missing finishing-copy footage stayed explicit; no available
take was adopted. The read-only original Preview also played its existing
74.74–76.74s cut with actual1280×720 video frames and matching master audio.

The 18px checkbox showed its orange check in a native screenshot, then was
unchecked without submitting an approval. Preparation remained one panel over
multiple ten-second refreshes. Raw receipts include native input events,
requestVideoFrameCallback records, media clocks and screenshots. Native Chrome
is not claimed; this is visible in-app-browser proof.

Protected-state readback after these gestures matched the finishing copy's
complete draft SHA256 and original revision. Individual story/generated-review/
asset hashes also match the initial baseline. The original remained at
`e4833a39ffeac77a83e7a6657b3923f1`, last updatedNovember6; the finishing copy at
`cc65ad585238c4398526b995005e8822`, last updatedNovember11. No creative approval,
cut/source change, render generation or original overwrite occurred.

Final exact-band build `f64bf87787b0918b6a34292e5454c1b722115a6f` passed the hosted
check with2,141pass/27skip/zero failures, production image build, activation and
independent public health revision readback. Real top/bottom edge clicks again
selected14.750–16.347s and16.347–17.715s without autoplay. For the1.368s selection,
all three lanes have identical CSS edges282.3828125px/424.2057189941406px at the
normal viewport. At the smaller1125×1000CSS viewport they share
183.4114532470703px/240.46874237060547px. Whole overlapping clips have no selected
outline/scale. The focus badge is separate.

Native wheel scrolling at the smaller width reveals the graph while the cut
strip/waveform stay visible. Document scrollWidth equals innerWidth1125; the
music panel closes at740.51px and its content does not overflow horizontally.
Source suggestions are collapsed. The override was reset after checking. Native
screenshots are `460-exact-bands-public-final.jpg` and460-narrow-public.jpg; raw
lane geometry is retained alongside them. Viewport dimensions are the actual
CSS values, not the requested override size, because desktop scaling affects it.

Adjacent Intro+Verse1 selected0–29.300s; Shift A006→A009 selected
14.750–24.458333333333332s (9.708s). PlainA006+CtrlA009 selected two windows,
14.750–17.125s/22.000–24.458333333333332s (4.833s). The actual Preview link retained
those ranges, A009 focus and14.75–29.3s viewport. Source gaps/approval stayed
unchanged. Final playback/navigation readback follows below.

On that build the separated gap/still audition started14.75s, jumped22s and
paused24.472021s (14ms endpoint sampling). The actual Back to studio action
preserved the exact ranges/focus/viewport. Preparation remained one panel.
The checkbox was visibly checked/unchecked without submitting a review. A013
enlarge→Next→A014→Close used actual controls.

The additional original-video audition exposed a real synchronization failure:
selecting Intro0–14.75s plus Chorus2 at74.74–89.29s caused video to advance during
the606.5ms master-audio seek, ending the2s chorus source window at11.548026s
instead of approximately10.917s. This was treated as failed460 acceptance,
not a passing audio-only test. `07bc3e5` pauses/awaits the native audio seek and
play promise before source playback; prepared standby decoders only start early
for contiguous cuts. Delayed-seek and cancellation regressions pass alongside
the existing cut-clock/seek/ownership tests:85tests/538assertions, zero failures.
Typecheck and affected lint pass. Public repair run:
[43173696389](https://github.com/gordo-v1su4/project-stack-structure/actions/runs/43173696389).

The corrected run passed the full hosted check **2,143pass/27skip/zero failures**,
production build, activation and independent exact `/health` revision check for
`07bc3e5929569847eca77d9dfbe35b0a364492df`.

The same public original-video selection played0–14.75s then74.74–89.29s. Its
native audio seek took541.1ms, with video paused until audio `playing`, then video
`playing`0.8ms later. The chorus source stopped at10.942863s, approximately26ms
from its10.917s endpoint, instead of the previous631ms excess. The48 decoded
chorus frame callbacks were1280×720 and muted; maximum sampled frame/song clock
difference was44.191ms (callback clocks, not a display-latency measurement). One
unmuted master stopped at89.297415s. Contiguous original cuts proceeded without
additional master seeks; only the intentional comparison jump sought the song.
Raw evidence:460-repaired-source-public.json.

After reloading the final published build, the exact1.368s band was selected
again and a native screenshot saved as460-complete-public.jpg. Final authenticated
saved-state readback matched both complete draft fingerprints, finishing
story/generated-review/asset fingerprints and both protected revisions. The
original's complete draft fingerprint also matched the pre-repair observation.
No cut, approval or media adoption was saved. Browser acceptance is complete;
the next bounded ticket is461 on the same accumulated worktree.

Linear Done was read back at2026-11-12T07:20:19.667Z (completedAt
2026-11-12T07:20:19.657Z), evidence comment3bcb1b67-e512-4a54-9933-b9d4ab1bcc9c.
A fresh native Linear snapshot of458–464 passed the ticket-execution boundary
checker with no errors, no active primary and nextV1S-461. The execution plan
maps all five exact criteria to evidence and the published implementation SHA.

Baseline project fingerprints are retained privately in
`.tmp/review-performance/460-public-before.json`.
