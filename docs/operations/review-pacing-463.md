# V1S-463 protected pacing review

Sole implementation chat `01a1ced8-376e-77a2-8bcd-0595772d7743`, existing
`codex/animatic-motion-source-validation` worktree. Implementation `b575639`,
overlay protection correction and public candidate `77ae7c5`.

Music and cut timing now has explicit Prepare, conflict/gap review, Apply and
Undo. Slider and pace changes remain suggestions. Preparation yields a paint
without unloading the current cut. It never saves, dispatches work or selects
footage. All existing source placements, exact trims, manual gaps and bound
animatic/generated/reused shot windows are retained. Only unbound empty windows
can be regrouped and divided at suggested cues within their existing story item.
This intentionally reports conflicts instead of automatically replacing chosen
footage or shuffling story beats. A fully bound film can correctly have no safe
timing changes; the UI states that and disables Apply.

Apply rechecks the entire project snapshot, take/reference/story context and
recomputed proposal. Newer edits or changed suggestion controls require Prepare
again. Undo checks the exact post-Apply project and context before restoring the
previous project. No speed changes, stretched source media, automatic generation
or approval occur. Gaps identify exact ranges for targeted replacement review.

The existing deliberate swap workflow now warns when source content moves between
story items and requires a checkbox for that exact reviewed proposal before
Apply. Its existing stale proposal checks and Undo arrangement remain intact.

Development verification: 23 focused pacing/arrangement tests passed with
203 assertions. Typecheck passed; affected lint has zero errors and two existing
StudioApp warnings. Windows runner uses Git Bash with Bun on its PATH, preserving
the repository's process-isolated runner. No real-service generation tests run.

The first build was cancelled before deployment to include selected generated
overlay protection. Successful public test build:
[run 43183551633](https://github.com/gordo-v1su4/project-stack-structure/actions/runs/43183551633),
full revision `77ae7c572b52c27e26bccd2f87df9c571f4a6e41`, trusted main workflow.
Hosted full check: **2,151 pass / 27 unique fixture skips / 0 fail**; production
build, image/transfer verification, activation, anonymous API denial and exact
public/origin revision gates passed. Independent public `/health` matched the
full candidate SHA. Four affected component tests also passed locally.

## Visible public acceptance

Signed-in visible in-app browser at actual CSS **2432×1592**, no viewport,
network or cache overrides. Native Chrome acceptance is not claimed. Native
`tab.getScreenshot()` captures are under `.tmp/review-performance/463-*`.

- Real finishing film: actual Cue density key gesture and Balanced selection,
  then Prepare, kept all 108 displayed cuts unchanged. Review showed 30 protected
  conflicts and 27 underlying gaps with existing unsuitable/replacement reasons.
  Bound shots meant no safe timing changes; Apply correctly disabled. This is
  not a creative cut approval. `463-real-film-proposal.png`.
- Apply and Undo used a clearly labeled **browser-only response fixture**. A
  finishing-project GET returned read-only original-project data under the
  fixture label; the original editor was never opened. All project and dispatch
  writes were denied locally before the network. Existing source media remained
  real. The public implementation, controls and playback were unchanged.
- Sliders/Prepare kept the fixture's 35 blocks/22 gaps; separate review proposed
  141 windows/128 gaps and 13 protected conflicts. Actual Apply changed the gap
  map, and Undo pacing restored the displayed cut. A second cue setting produced
  146 windows/133 gaps, retaining all 13 source placements. Exact aria-label/title
  lists before and after Undo match. `463-fixture-applied.png`.
- Current playback survived Prepare: the **same playing master audio node**
  advanced 13.773823→14.074096s while the separate proposal appeared. No player
  replacement or cut edit occurred. `463-preparation-playback.json`.
- Changed Cue density after Prepare disabled Apply. A real newer manual Remove
  also disabled the existing proposal with a stale alert. Undo arrangement
  restored the source. Raw selected innerText differs because the ◆ focus is
  view state; exact label/title comparisons verify the cut. Model tests also
  reject same-revision edits, changed project/take context and tampered proposals.
  `463-stale-proposal.png`.
- Deliberate cross-beat swap: warning displayed, Apply initially disabled,
  checked→enabled, unchecked→disabled, checked + actual Apply changed the cut;
  Undo arrangement restored its exact label/title list. Any omitted tail and
  residual gap were visible before consent. `463-cross-beat-warning.png`.
- Retained manual source at song **3.750–7.73199987411499s** stayed present after
  Apply. Actual selected-range playback showed the same cave-entry footage,
  one audible master at 3.846951s and muted source at 3.894184s, playbackRate 1.
  Native end sample: master 7.736296s, source 7.783245s; these are event samples,
  not frame-exact end claims. Undo pacing restored the exact pre-Apply cut.
  `463-retained-playback.png/json`; pure regression additionally preserves the
  exact 3.25–8.25 manual source trim and editPlan story order.

Actual library open/close, pointer entry/movement/leave and public wheel scrolling
were exercised. Prepared-hover startup was not measured for this ticket.
The two CPU viewing-copy requests inherited from 462 remain waiting (~29 minutes
at the end); 464 owns diagnostic follow-up, not runtime tuning.

## Cleanup and protected state

The fixture's artificial Save failed badge belongs to its write guard. Neither
the guarded Save attempts nor autosave reached the project API. A temporary
save-payload observer obtained no candidate payload and supplies no acceptance
claim. The fixture was discarded by navigating to read-only finishing Preview;
final document has no guard, fixture or observer. No fixture-labeled localStorage
or sessionStorage entries existed. No override or persistent injection remains.

Final clean Preview is **0/108 selected, 103 current video takes available**.
Both complete saved-draft hashes and revisions exactly match pre-QA/handoff:

| Project | Draft SHA-256 | Revision |
| --- | --- | --- |
| Finishing `75101b25-fea6-42b1-b2c6-85a9d1deb8eb` | `aace50749de17e84a18ff49cb455063e715a5c2d2732e509f5ff658358a8f6cc` | `cc65ad585238c4398526b995005e8822` |
| Original `5fc48d59-01e4-4bfb-90c1-e054a0307575` | `db8869edc20b187c6c31bf2df46e8e8bb66fb39433d2447cb4cf1598f79ce20d` | `e4833a39ffeac77a83e7a6657b3923f1` |

Receipts: `463-protected-before.json`, `463-protected-final.json`,
`463-final-public.png`, hosted `463-deploy-complete.log`. No generation, creative
adoption, approval, original-editor write, service tuning or framework migration.
All five Linear checkboxes were updated individually as verification passed.
