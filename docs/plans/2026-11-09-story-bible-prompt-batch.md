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

The installed agent skills can supply canon to future prompt-writing work now. Local treatment author/reviewer injection is implemented above, but has not been released. Automatic downstream H3 shot-planner injection, integrated save/reload/browser acceptance and prompt-adapter acceptance remain incomplete. Do not claim deployed integration from this local source batch.

Required acceptance for that continuation:

- Import/append existing approved story without inventing missing character/world facts.
- Keep a single editable canon source and versioned model-specific prompt outputs.
- Supply current canon to story revision and shot planning through their existing authenticated saved-project paths; reject stale bindings.
- Reconfirm changed canon/story before generation; preserve existing edit, jobs and approval history until then.
- Preserve model grammar, reference wiring, positive prose separation and native H3 lint.
- Verify the real save/reload and prompt context in the UI before declaring application integration complete.

No new provider generation, production project writes, PR, merge or deployment occurred for this bible checkpoint.

The current execution proposal is [whole-song scene proofs](2026-11-09-love-me-tonight-scene-proofs.md): twelve contiguous scenes and three representative setting/action/transition moments per scene. Skills were assessed with explicit user/canon overrides; no generated images or scene-direction approvals are represented by this plan.
