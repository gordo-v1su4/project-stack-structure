# Music-video editing contract

User clarification, September 8, 2026. This governs the Story reconstruction
work and supersedes its earlier blanket rejection of uncertain semantic matches.

## Editorial priorities

1. Preserve the song's timing, phrase structure, accents, and readable cut lengths.
2. Prefer a good visual join: subject movement, camera movement, action phase,
   and the viewer's point of attention across the cut.
3. Use story meaning and lyrics to guide selection within those choices.
4. Use color as a secondary preference, not the main reason to choose a shot.

Performance, story, and B-roll are complementary editorial roles. A singer
performing to camera need not enact the plot. A crowd, insert, landscape, or
partial view of a lead can support a sequence without showing every character
and action in the story description. Keep those lanes useful and selectable.
Do not make the user classify every model uncertainty before assembling a cut.

Separate factual certainty from editorial usefulness. Uncertain identity,
relationship meaning, time of day, or busy action should normally be advisory.
Do not rename an unidentified performer or claim a clip proves an unshown event.
Keep explicit source decisions, original uploads, real duration gaps, and the
project's repeat setting. For the current practice project the user explicitly allows repeated shots; variety is a preference, not a hard rule. Actual contradictions with a specifically
required shot remain visible: paired dancing does not establish a solo arrival,
an intact floor does not show its collapse. A supporting insert can accompany
that event without being labeled proof that the event occurred.

## Continuity references and measurable checks

The [Film Art authors distinguish graphic matching from narrative continuity](https://www.davidbordwell.net/blog/2011/05/25/graphic-content-ahead/).
Similar movement or composition can connect unrelated spaces; it need not imply
one continuous scene. Preserve screen direction when continuing an established
action. Do not apply one scene's axis to an unrelated performance or B-roll cut.

[Adobe's continuity guide](https://www.adobe.com/creativecloud/video/hub/ideas/what-is-continuity-editing-in-film.html)
describes match-on-action, eyeline matching, eye trace, and the 180-degree axis.
For implementation, distinguish the action axis from the screen center: crossing
the image center is not automatically crossing the action axis. A deliberate
reset or discontinuity is an editorial choice, not an invalid project.

[Match Cutting: Finding Cuts with Smooth Visual Transitions](https://arxiv.org/abs/2210.05766)
studies pairs of shots and human-labeled match cuts. Pairwise comparison is the
relevant unit for a join, rather than isolated clip labels.

Measure outgoing and incoming boundary windows at the actual trim points:
camera transform separately from residual subject movement, direction, strength,
acceleration/action phase, and confidence. Attention/eyeline/axis judgments need
appropriate evidence; optical-flow angle alone does not establish gaze or the
180-degree axis. Unknown measurements must remain unknown, not a fabricated
passing score or a reason to make the clip unusable.

## Current implementation audit

- `semanticEditPlanner.ts` combines semantic, lyric, and action text at 0.70
  versus motion continuity at 0.10 in the pre-change weighted score. The new score uses duration 0.24, motion continuity 0.40, motion energy 0.10, semantic 0.10, lyrics 0.04, action 0.08, and color 0.04; repetition is a preference penalty.
- `musicVideoProject.ts` builds the approved sequence with a variety-first
  picker now compares available segment motion before variety at each join.
- `motionRanking.ts` and `manifestRanking.ts` already provide motion comparison
  and musical-first ranking, but are not consistently used by the Story path.
- The sibling video worker computes Farneback flow over sampled segment frames.
  Its camera class is inferred from average flow, and residual strength is an
  approximation from coherence. This is not a fitted camera transform with
  separate subject tracks, nor an analysis of every actual trim boundary.

## Required acceptance

- With equally suitable musical windows, a compatible movement join beats a
  stronger keyword match with an abrupt reversal; color does not overturn it.
- A deliberate contrast/performance cut stays available, without inventing a
  narrative relationship or applying another scene's axis.
- Busy action, unnamed performers, partial cast views, and B-roll remain useful
  suggestions. Explicit solo, damage-state, forbidden-action, and ordered-event
  requirements retain honest scores and explanations, never semantic gate failures. Actual missing media, invalid trims, stale placements, and uncovered song duration remain technical blockers.
- Test left/right and up/down movement, opposite directions, static holds,
  camera versus subject movement, missing/low-confidence descriptors, trim-point
  changes, and explicit user choices. Use real source boundary footage for the
  final visual judgment, not just synthetic numeric tests.
- Preview, edit/undo, reload, FX, and export consume the same saved placements.
  Do not reselect sources in a renderer. Whole-song timing and original uploads
  survive; omitted or unavailable footage does not get secretly repeated.

Implementation and the real-media acceptance above are ongoing. A scoring change
alone does not prove motion analysis or the final cuts are correct.

## Story ideation and project intent

Caption supplied clips first, then combine observations, song and optional brief. Offer Faithful (straightforward), Bold (a twist), and Wildcard (potentially a different or surreal interpretation when the user has not locked the premise). Preserve accepted story edits. Broad establishing, solo lead, together, crowd/performance, destruction and ending roles help matching without requiring every shot to depict the whole beat.

Model factual-fit judgments are always advisory in this music-video workflow. Low scores must not disable source selection, manual swaps, preview, or export of technically valid placements. Preserve uncertainty and contradictions in explanations rather than inventing facts. A future project preset may express stricter story intent; it is not implemented by this clarification. Repeats are permitted for the current practice cut through the existing reuse policy, with song windows and original media preserved.

## Verification checkpoint

September 8 local verification: 693 tests passed across the shared suite and four isolated lanes; the additional approved-placement motion test passed in its six-test file. Typecheck, production build and lint passed (8 existing lint warnings, no errors). Coverage includes persisted low-fit source reuse, preserved factual warnings, movement ranking in four directions, source bounds, missing media, exact song duration, real FFmpeg preview/export fixtures and original-audio preservation. Production browser Story-to-export acceptance and actual trim-boundary motion analysis remain pending.

### Preserve intentional holes

The user's later clarification distinguishes permission to repeat from permission to fill everything. Low-fit candidates are available for explicit selection, not automatic filler. Unassigned story requirements stay holes so missing material can be planned or generated later. Join's Remove from cut reopens the selected fixed song window, preserves the source library, invalidates prepared output and supports undo. Enabling reuse must preserve manually opened holes. A future workflow choice may offer fully autonomous assembly or checkpoints for feedback; this patch does not implement those presets.

Intentional-hole follow-up: `bun run check` passed 695 tests (8 existing lint warnings, no errors) and production build passed. A final added story-choice regression passed with its 22-test file: low-fit alternatives remain suggestions, explicit selections work, and null decisions stay empty. Browser acceptance follows deployment.
