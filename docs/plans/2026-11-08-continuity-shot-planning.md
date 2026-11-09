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

## Remaining end-to-end slice

1. Build the complete canonical planning scaffold on the authenticated server,
   preserving exact musical windows and existing source evidence. Recheck fresh
   project/story/reference bindings before using model output.
2. Add bounded authoring and separate semantic/transition review through the
   existing Qwen infrastructure. The current story-author endpoint enforces a
   treatment schema; shot JSON cannot be sent there as if it were supported.
   A dedicated shots transport needs strict schemas, streaming request byte caps,
   fixed server model/instructions, GPU-lock/lifecycle reuse and one deadline.
   No gateway, service, queue or infrastructure deployment is included here.
3. Budget smaller contiguous inference batches explicitly. Foundation limits
   describe aggregate data admission, not a claim that the full song fits one
   model context or output. Carry boundary context without repeating actions.
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
