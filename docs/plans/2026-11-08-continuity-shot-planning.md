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
The new planning task explicitly requests `small-2x`: canonical reference
validation reads image bytes before text planning, so it must not inherit the
512 MiB default implicated in the separately diagnosed live H3 worker crash.
The installed SDK accepts the preset name; live resource mapping and sufficient
capacity remain release checks, not conclusions from the source setting.

Validation: app check passed (1,592 tests, 24 skipped, 7,615 assertions), typecheck,
lint (zero errors; five existing warnings), and production build passed. Independent
API/worker review found no concrete P1/P2, with 25 focused tests passing. All 78
offline gateway tests passed without network, model or service calls. These checks
do not prove live model quality, integration, video or final-film acceptance.

## Remaining end-to-end slice

Browser integration now prepares canonical directions before new automatic
requests, polls the owned run, and reads the durable result once. It preserves
existing nonterminal packets and explicit retry prose/reference authority, and
does not replan saved batches, pickups or revisions. Composed shot prose includes
the reviewed entry and exit states. The companion gateway critic reviews that
literal composition (homelab source `513fd48`; 79 offline tests passed).
The integrated UI slice passed the full app check and default production build
(38 pages; lint zero errors and five existing warnings). A synthetic DOM fixture
verified zero video dispatch before planning and after a stale reply. A synthetic
composed prompt passed strict H3 skill lint at 124 frames / 24 FPS. None of these
fixtures proves actual model prose, visual continuity, identity or live acceptance.

The source now refines the complete requirement at applied footage boundaries.
For a selected 0–3 second pickup, planning retains that media as context and
prepares the exact remaining 3–10 second window. It reuses the existing approved
and selected overlay order, carries explicit asset provenance, and binds stable
media/target/trim facts without runtime URLs or unrelated bank entries.

Canonical H3 jobs supply prior requested directions; editable asset descriptions
cannot substitute for them. The server independently checks owned jobs, range
assessments, issued policies and current-reference records. A browser's explicit
cached-range projection is advisory only and cannot enable that mode server-side.
Editorial imports supply media context with unknown action. Every prior direction
is intent, not observed or completed action; the author/critic must reject
unsupported continuity rather than assume the action happened inside a trim.

Only actual missing windows can become new or retried requests. Missing browser
URLs cannot turn canonical covered footage into a content gap. Planning's new
provenance is excluded from legacy prepared-review fingerprints, preserving their
byte identity when playback is unchanged.

Validation: the full app check passed (1,631 tests, zero failed, 24 skipped), then
the final covered-source guard passed nine affected tests and typecheck/lint.
The companion gateway source is `1ea6978`; all 82 offline gateway tests passed.
Independent review found the covered-source dispatch gap and it was fixed with
an absent-URL regression covering both new and retry paths. No model, runtime,
project/media write, PR or feature deployment occurred in this source slice.
The separately released H3 worker demonstrated that this self-hosted platform's
`small-2x` maps to 1 GiB; the new planning task itself remains undeployed.

1. Verify the connected browser workflow through the real canonical planning
   task, owned run status, and stored result. Verify reload/recovery and changed
   context handling, including partially covered windows and uncertain footage evidence.
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
