# Story bible and prompt continuity batch

The user wants Joey's Story Bible Builder available alongside ONE SHOT, with the existing approved story reusable as canon for future model-specific prompts. Preserve the current film and keep local changes together for later review; do not open a PR or deploy without the user's explicit batch approval.

## Installed and prepared

- Canonical builder: Hermes vault, `10-Infrastructure/Agent Skills/skills/story-bible-builder/`.
- Original upstream SKILL SHA256: `c3f44e2d8e890da070fb1b41bd498cd9bfb71d3550048f1c74d4bea5e00f8145`.
- Installation repairs the archive's reference layout and adapts its name/appearance/output defaults to the user's exact-name and uploaded-reference rules. Original source remains intact under `source/upstream.md`; installation provenance is in `INSTALLATION.json`.
- Tool links share the canonical copy; the vault installer registers the builder.
- `love-me-tonight-canon/SKILL.md` was initially seeded from approved treatment revision59/R41 plus the user's explicit dark-club and continuity corrections. The 2026-11-09 paired continuation reconciled the endorsed separate journeys and whole-song scene proofs in the canonical vault source (SHA256 `9ea11ed3b661b356a5846568c7162bdb538d2cbd1c492b572f9511bcfe2da154`). Proposed palette/topology remain subject to visual review. Missing biography, voice, movement, world history and thesis stay `[TBD]`.
- `love-me-tonight-canon/canon.json` is a normalized historical projection, pinned to revision59's authored story and three named RAW reference authorities. It has not been rebound to the newest amendment and must not be projected as the amended app story. Neither file modifies the live saved project.

## Local product foundation

The previous six-file uncommitted foundation was preserved before being carried onto the current approved base. Original worktree remains untouched.

The adapter validates bounded detached canon, provenance, exact names and project/story/reference bindings. It excludes proposed/private/unknown facts, separates positive context from review constraints, persists optional treatment canon and invalidates confirmation when canon changes. Treatments without a bible retain historical signature behavior.

## Local authoring integration

The continuation adds a Story Bible panel inside the treatment planner, exact approved-story extraction, bounded structured import, proposed fact edits and explicit human fact confirmation. Current named references supply names; name changes belong in Setup. Stale story bindings display prior facts alongside the revised story before an explicit review/rebind action. Project/reference changes require current canon rather than an implicit migration.

The planner accepts the actual saved project ID/revision and an optional `onPrepareStoryContext` CAS-save hook from its parent. Bible-bound author/revise requests await that hook once per intent and use its fresh saved revision; input changes during preparation cancel dispatch. No confirmed-placement gate is required for initial Story work. The authenticated story route fresh-reads the owner-scoped project, requires exact persisted canon equality and current metadata bindings, and rejects stale/foreign context before Trigger dispatch. The author receives confirmed public positive facts; the independent reviewer receives those same facts plus confirmed review/exclusion constraints. Private, proposed and unknown facts remain out of model context. Context budgets fail explicitly instead of truncating canon.

Model story revisions preserve the original Bible without silently rebinding it or accepting model-authored canon. Using a story with stale canon saves an unconfirmed draft and exposes the review panel. Changed canon invalidates existing story confirmation. The ordinary no-Bible/unsaved story path remains available.

Verification: 98 affected tests pass, alongside TypeScript, targeted ESLint and diff checks on the local combined authoring batch. Independent review found and prompted fixes for stale-reference recovery, unsaved fact text on metadata edits and missing relationship review controls; targeted helper tests cover those fixes, with browser checks still required. Resetting stale canon is explicit, exposes the previous JSON/download, and inherits no approval. That panel backup is temporary local UI state, not a durable saved recovery copy. Tests use synthetic projects and mocked dispatch; no model generation, deployed browser acceptance or live project recovery is established by those results. Root owns actual saved-ID/revision/CAS-save propagation, StoryTab confirmation guard, integrated browser checks and later release review.

## Remaining app work

The installed agent skills can supply canon to future prompt-writing work now. Local treatment author/reviewer injection and the downstream H3 shot-planner adapter below are implemented in source, but have not been released. Integrated save/reload/browser acceptance, deployed model-service execution and prompt-adapter acceptance remain incomplete. Do not claim deployed integration from this local source batch.

## Downstream shot-planning continuation

The next local slice threads the confirmed treatment into the identical browser/server planning-input builder. Each requirement receives an optional scoped canon projection bound to its current story/reference metadata, named subjects and selected identity/environment authorities. It omits unrelated anchors, other leads, whole-film logline/synopsis, biography, private/proposed/unknown facts and an ending before its proper anchor. Positive facts and review constraints remain separate. A Bible-free input retains the historical body and hash exactly.

The author wire carries only that scope's positive facts and public source hashes. Independent review receives the same author input plus the matching review constraints; both responses must acknowledge the exact `canonScopeSha256`. An old service that rejects or ignores the contract cannot produce an accepted plan. Canon-bearing chunks preflight both author and worst-case reviewer payloads before any model call, including duplicated composed shot text, JSON-as-user-message escaping and a 16 KiB fixed-envelope reserve. The paired service source checks that reserve contract and separately retains its 128 KiB actual model-payload cap. Native H3 prompt grammar, actual reference wiring, existing frozen/retry packets and media acceptance are unchanged.

Actual service counterpart source was located read-only at sibling `proxmox-home/infra/rustfs/caption-gateway/{app.py,shot_planning.py,test_shot_planning.py,README.md}`, baseline `1ea697856b7171bc0ebac9b1681fa371fb194f5a`. The canonical ops checkout is preserved. The separate local worktree/branch `story-shot-canon-source` / `codex/story-shot-canon-source` contains source counterpart commit `5154dcdde1e56a821003057c92f4da6b2df721e8` (three files, 431 insertions / 10 deletions), with 30 offline service tests and independent review passing. No service deployment is authorized by that preparation. Its README labels shot routes source-only, so neither commit is a live version claim. Service tests inspect actual admitted Qwen author and critic messages, negative/unclear reviews, cross-scope rejection, Unicode hash parity, historical no-Bible payload bytes and the model-envelope reserve; a hash echo alone cannot prove canon consumption.

Root integration must pass `confirmedTreatment={storyState.confirmedTreatmentSnapshot}` to `MiniMaxDraftPanel`, alongside its existing story approval gate. The local adapter tests cover scoped data, client/server parity, stale bindings, service receipt rejection and historical no-Bible compatibility. Real authenticated app/Trigger/service execution and actual visual/motion acceptance remain separate gates.

The downstream app verification passes 98 affected tests / 647 assertions across eleven files, TypeScript, targeted ESLint and diff checks. Independent review identified partial Bible inventories dropping selected names, JSON escaping exceeding the carried-boundary context budget and the larger service model envelope; reference-derived subject names and worst-case JSON/model-envelope admission now have regressions using real builders and bounded input data. All gateway tests inject transport responses; they do not contact a model or establish deployed acceptance. The graph was refreshed after the source changes.

Required acceptance for that continuation:

- Import/append existing approved story without inventing missing character/world facts.
- Keep a single editable canon source and versioned model-specific prompt outputs.
- Supply current canon to story revision and shot planning through their existing authenticated saved-project paths; reject stale bindings.
- Reconfirm changed canon/story before generation; preserve existing edit, jobs and approval history until then.
- Preserve model grammar, reference wiring, positive prose separation and native H3 lint.
- Verify the real save/reload and prompt context in the UI before declaring application integration complete.

No new provider generation, production project writes, PR, merge or deployment occurred for this bible checkpoint.

The current execution proposal is [whole-song scene proofs](2026-11-09-love-me-tonight-scene-proofs.md): twelve contiguous scenes and three representative setting/action/transition moments per scene. Skills were assessed with explicit user/canon overrides; no generated images or scene-direction approvals are represented by this plan.
