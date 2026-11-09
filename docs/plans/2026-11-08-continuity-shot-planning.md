# Continuity-aware shot planning

Tracked by [V1S-446](https://linear.app/v1su4/issue/V1S-446), under the existing
full-film objective. This is an implementation checkpoint, not feature acceptance.

## Contract and persistence foundation

`buildH3ShotPlanningInput` captures the current placement plan, full ordered
requirement windows, approved direction and structured constraints, named subjects,
pacing and actual padded H3 frames/FPS. A SHA-256 binding changes with those inputs.
Disjoint remaining holes are insufficient context: plan the complete requirement
once so completing one candidate does not restart its entire action sequence.

`parseH3ShotPlanningResult` requires the exact ordered window keys, matching
adjacent entry/exit state text, and each declared action-sequence index once in
order. Input/output counts, text and UTF-8 bytes are bounded. These are structural
checks: they do not prove that free text follows the story or that a rendered
person, action or transition is correct.

The internal owned storage seam uses existing RustFS JSON conditional writes.
One immutable result belongs to each owned named project and input binding.
Identical replay reads the existing result; a different result conflicts. Lost
acknowledgements reconcile through readback without another write. This seam
does not authenticate a browser, approve a shot or authorize video generation.

## Authenticated planning checkpoint

The source now includes an authenticated canonical planning API, an owned
`qwen-h3-shot-planning` Trigger task, immutable cache reuse, and a fresh binding
check after inference. Existing source captions and exact source trims supply
advisory continuity evidence. They do not establish visible action or identity.

The dedicated author/critic transport divides each requirement into at most
24-window chunks, carries the preceding state and completed action prefix, and
checks separate digest-bound review before accepting a result. Requests and
responses, total time and explicit dispatch attempts are bounded. There is no
automatic repair, retry or fallback to unreviewed directions.

The companion canonical homelab gateway source includes both routes and its
packaged module. Deadline expiry kills and reaps the local HTTP exchange child
before releasing the gateway lock; it does not prove remote model cancellation.
Neither gateway changes nor the new worker task have been deployed. The source
inventory has 18 tasks; the last verified production worker still has 17.

Validation: app check passed (1,592 tests, 24 skipped, 7,615 assertions), typecheck,
lint (zero errors; five existing warnings), and production build passed. Independent
API/worker review found no concrete P1/P2, with 25 focused tests passing. All 78
offline gateway tests passed without network, model or service calls. These checks
do not prove live model quality, integration, video or final-film acceptance.

## Remaining end-to-end slice

1. Connect the browser's automatic missing-shot workflow to the canonical
   planning task, owned run status, and stored result. Verify reload/recovery and
   stop on changed context before preparing any video request.
2. Review the concrete coordinated gateway/worker/web release before activation.
   No gateway, service, queue or infrastructure deployment is included here.
3. Verify admitted chunks fit the actual model context and yield useful reviewed
   directions; aggregate admission is not a context-window guarantee.
4. Preserve explicit manual pickup/revision directions and frozen submitted or
   pending requests. Bind durable unsubmitted overrides to the same inputs.
5. Resolve automatic missing-shot requests from the stored directions. Keep
   reference selection, identity checks, draft revision and stale-result guards.
   Do not render existing source windows merely because they supplied context.
6. Compile/lint actual padded H3 duration/FPS using the dynamic compiler profile;
   inspect adjacent states and real generated results. Then verify authenticated
   Trigger dispatch, reload, review, prepared playback and export.

The existing Love Me Tonight draft and sole live controller remain authoritative.
The separate zero-footage live fixture is still scheduled after finishing the film.
No existing prompt, submitted job, selected cut or project record is rewritten by
this foundation. V1S-446 stays In Progress until the complete slice is verified.
