# Live draft review

Implement Robert's request to drop into Draft during a batch, inspect its queue,
and watch arriving clips without waiting for the entire film. This is a web-only
slice on `codex/live-draft-review`, based on `05da59e`.

## Behavior and acceptance

- Show saved, queued and rendering work alongside completed selected and banked
  takes, including takes awaiting identity evidence. Opening a clip is read-only,
  opt-in playback, never approval or a claim of streaming unfinished output.
- Keep polling while reviewing. Make pause upcoming submissions prominent. An
  in-flight request continues unchanged; creative selection/rejection/revision
  waits for it to settle. Revision notes remain editable and survive reload on
  this browser for this project.
- An explicit revised take preserves the other pending requests, renders only
  that revision, then pauses again. Neither notes nor viewing changes future
  prompts. Existing intent, attempt, plan, project and draft revision guards stay.
- Stale Story approval permits read-only progress and playback only. It pauses
  future submissions and disables generation, selection, rejection and acceptance.
- Whole-film acceptance, current-reference and likeness gates remain separate.

## Verification seams

Use isolated Bun tests at the requested public seams: arrival projection and
read-only playback, persisted batch pause/revision/reload, existing unknown-ACK
reconciliation, and late delivery selection guards. Typecheck and lint affected
files. Use a local styled fixture of the actual component for browser proof;
no real project writes, provider work, GPU, deploy or PR. This fixture does not
certify a production film or real generation integration.

## November 8 implementation continuation

The original untracked plan and three behavior tests were retained. The branch
was fast-forwarded from `05da59e` to production base `74963c7`, then received the
reviewed playback ownership/bounds fixes `01f298f`, `0326b9a`, `e8210b3`, and
`a04924b`.
The two stale imports in the original tests now use the existing `h3Project`
fixture and `h3GenerationServer` materializer.

The panel projects completed selected and banked takes from persisted assets and
ready jobs without changing their review state. A single explicitly opened take
mounts its bounded player; it joins the shared playback ownership group and
releases its source and callbacks on close. Saved queue packets remain
inspectable and polling continues while a take is open. Revision notes use a
bounded, versioned browser store scoped to the project.

Explicit revisions prepend one new attempt to a paused batch without replacing
its pending packets. A persisted request marker pauses after that revision.
Pausing during an in-flight request survives completion, and checking an
existing render no longer clears that pause. Current Story approval is passed
explicitly from StudioApp. The panel sits ahead of the stage's blocked-content
wrapper so stale Story still exposes progress/playback; creative actions remain
disabled and arrivals are banked without automatic selection.

Verification uses source fixtures and isolated Bun suites only: live review,
static panel rendering, H3 planning and unknown-ACK recovery, generated draft late
delivery guards, current-reference bank actions, native audition, frame clocks,
and ownership. Typecheck passes. Focused ESLint reports zero errors and two
pre-existing StudioApp warnings. No browser, audio/playback, project writes,
provider jobs, GPU, deployment, or PR actions were performed. Browser interaction
and production integration remain unverified, as required by this continuation's
scope.

After root source review, an ignored ReactDOM/HappyDOM fixture at
`.tmp/live-draft-dom/check.tsx` exercised the actual panel under StrictMode with
five mocked job-list GETs. It opened one saved take without playing or loading
its source; saved notes through React's textarea handler; unmounted/remounted
the same project and recovered the notes; and switched projects without leaking
notes. Closing the take released its source and ownership listener. Stale-Story
create/select/reject/revise/accept buttons remained disabled and clicks caused
zero action callbacks, zero mutations, and zero play calls. Enabling Story in
the synthetic fixture made create/select/reject available, proving the stale
guard rather than unrelated prerequisites caused those disabled states. This is
DOM interaction proof with mocked media, not real browser/media acceptance.
