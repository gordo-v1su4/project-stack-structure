# Story bible and prompt continuity batch

The user wants Joey's Story Bible Builder available alongside ONE SHOT, with the existing approved story reusable as canon for future model-specific prompts. Preserve the current film and keep local changes together for later review; do not open a PR or deploy without the user's explicit batch approval.

## Installed and prepared

- Canonical builder: Hermes vault, `10-Infrastructure/Agent Skills/skills/story-bible-builder/`.
- Original upstream SKILL SHA256: `c3f44e2d8e890da070fb1b41bd498cd9bfb71d3550048f1c74d4bea5e00f8145`.
- Installation repairs the archive's reference layout and adapts its name/appearance/output defaults to the user's exact-name and uploaded-reference rules. Original source remains intact under `source/SKILL.md`; installation provenance is in `INSTALLATION.json`.
- Tool links share the canonical copy; the vault installer registers the builder.
- `love-me-tonight-canon/SKILL.md` is a 142-line self-contained seed from the approved treatment revision59/R41 plus the user's explicit dark-club and continuity corrections. Missing biography, voice, movement, world history and thesis stay `[TBD]`.
- `love-me-tonight-canon/canon.json` is a normalized versioned local projection, pinned to that project's authored story and three named RAW reference authorities. It is not a modification of the live saved project.

## Local product foundation

The previous six-file uncommitted foundation was preserved before being carried onto the current approved base. Original worktree remains untouched.

The adapter validates bounded detached canon, provenance, exact names and project/story/reference bindings. It excludes proposed/private/unknown facts, separates positive context from review constraints, persists optional treatment canon and invalidates confirmation when canon changes. Treatments without a bible retain historical signature behavior.

## Remaining app work

The installed agent skills can supply canon to future prompt-writing work now. Automatic application injection is not complete. The deployed app has no story-bible editor/import action or automatic canon projection into treatment/shot planning yet. Those changes must be implemented and verified as part of the local batch before claiming the main story builder is integrated.

Required acceptance for that continuation:

- Import/append existing approved story without inventing missing character/world facts.
- Keep a single editable canon source and versioned model-specific prompt outputs.
- Supply current canon to story revision and shot planning through their existing authenticated saved-project paths; reject stale bindings.
- Reconfirm changed canon/story before generation; preserve existing edit, jobs and approval history until then.
- Preserve model grammar, reference wiring, positive prose separation and native H3 lint.
- Verify the real save/reload and prompt context in the UI before declaring application integration complete.

No new provider generation, production project writes, PR, merge or deployment occurred for this bible checkpoint.
