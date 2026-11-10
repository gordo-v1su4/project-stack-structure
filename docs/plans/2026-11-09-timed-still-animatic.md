# Full-song timed still animatic

Robert's next test is every planned image followed by watching the complete
animatic in Preview mode with the original master song. The creative controller
owns film writes and serial local H3 generation. The engineering owner adds the
durable app contract and player; no new model, character sheets or motion batch.

The proposed v5 cut contains 108 shots at 24 FPS, including three retained source
frames and 105 new stills. Its old timeline item IDs are provenance, not timing
authority: six shots cross old edit-item boundaries. Adopt an explicit frame
partition, bound to the current story, master, named references and scene
directions. Each generated still has its own saved intent and exact shot/window
binding, validated again before the GPU request. Existing scene proofs, footage,
rejections and reviews remain intact. Ready does not mean approved.

Persist the plan and per-shot receipts in Story state. Bind requests to shot ID,
plan content, exact frame interval, prompt and reference order. Ordinary saves
and attaching another shot do not invalidate earlier jobs. Story/master/reference
or shot edits do invalidate their dependent work. Recover ambiguous submissions
by GET, using the existing bounded H3 intent/CAS machinery.

Preview uses the song as its sole clock, shows the current still for its exact
frame interval, preloads a bounded current/next image set and supports paused
scrubbing. Missing, stale and failed images remain visible as such. Playback
cannot claim a complete animatic until every slot has a current durable image.
The master is neither sped up nor truncated; the final image holds through the
less-than-one-frame rounding remainder. Animatic review is distinct from scene
direction, motion-take, final-cut and export consent.

Acceptance: all 108 frame intervals survive save/reload; cross-old-cut windows
are admitted only through their exact saved animatic binding; stale, foreign or
altered requests fail before inference; no duplicate POST on recovery; all actual
stored images are readable and inspectable; the full 246.69995464852607-second
master plays with all stills in app Preview and arbitrary seeks show the correct
shot. Unit/route checks and an actual styled browser fixture precede a concrete
reviewable self-hosted release. Real generation, authenticated preview/reload and
human review remain required after deployment. No Vercel or Trigger upgrade.

## Local verification checkpoint

The dedicated adapter retains the existing canonical source/story/reference
validation and derives an exact saved animatic target independently of the
overlapping old placement. API admission, worker revalidation, frozen job store
and browser recovery carry the same shot binding. Video admission is unchanged.

`bun run check` passed: 2,004 tests, 27 fixture skips, zero failures and five
existing lint warnings. The production webpack build passed. The 83 affected
tests include per-shot frame coverage, cross-placement admission, altered/foreign
requests, immutable bindings, same-intent replay, stale image hiding and ordinary
project save/hydration.

The actual styled React components were inspected in an isolated browser using
108 synthetic numbered images and a ten-second silent WAV. Playback reached
A108 and stopped at the master end; paused midpoint seek selected A055 at 5s;
keyboard Home selected A001 at 0s. The preview retained two image elements
(one at the end), narrow rendering had no horizontal overflow, Escape closed the
preview, restored its launch button's focus and released audio. No browser
warnings/errors were observed. Images outside the selected neighborhood do not
mount full-resolution thumbnail elements. These are UI/transport checks, not
actual film, real-song smoothness, production persistence or creative approval.
Local evidence: `.tmp/animatic-ui/`.

The creative controller independently validated the actual saved canonical
source receipt once, then materialized all 105 proposed v6 requests against that
same authorized in-memory project. Exact frame windows and the six substantial
cross-old-item cases passed; original saved JSON remained unchanged. This audit
performed actual read-only storage validation, with no mocks, project writes or
GPU submissions. Its private receipt is `server-controller-preparation.json` in
the v6 creative packet. No new source validation is needed unless that context
or the relevant source changes.

The remaining live gate is the matching self-hosted web/Trigger release followed
by additive plan/source-frame adoption, serial generation with durable recovery,
and the actual complete full-song Preview requested by Robert. The original
project and conflicted window remain untouched. Production activation remains
subject to the carried concrete-batch release approval; the image batch itself
has been explicitly requested.
