# Completion interview notes

Updated 2026-11-06. Source: Robert's current completion/grilling session.

- Returning to the app after time away; it remains too complicated despite earlier simplification.
- Manually creating missing content, even outside an API, is the main completion hurdle.
- MiniMax video generation using character reference images should become the primary way to fill missing footage.
- Robert reports useful recent practice with reference-driven MiniMax output. This is product direction, not proof that this app's integration currently works.
- The app should carry the project from start to finish. Parallel agents are explicitly requested for the work.
- Keep good story ideas, logic, prompts, identity continuity, and musical alignment central to completion.
- Do not infer that MiniMax is also the chosen still-image provider; the request specifically identifies video.

## Confirmed decisions

Robert answered the first interview round:

1. Song + brief + character/location references must work with **zero uploaded footage**. Generate whatever footage is missing.
2. Agree on the story, then **generate and assemble a draft** for Robert to review and revise. Per-shot approval before draft assembly is not required.
3. **Local MiniMax H3 through SwarmUI** is the primary video engine.

Robert answered the second round:

4. Analyze the master song; a vocal stem or timed lyrics is an optional enhancement.
5. Four main steps: Setup → Story → Draft → Finish, with detailed tools available inside.
6. Narrative and performance footage cut to the master song satisfies the current scope; accurate generated singing/lip-sync can follow.

Robert explicitly requested a long-horizon goal, with an actual fully cut music video as its final product. Required creative direction: dynamic, storytelling-led, narrative-driven, high energy, fast cuts. Complete the workflow and app in between. A technical export or unfinished rough cut is not completion.

## Standing decision authority for this goal

Robert explicitly authorizes continued work while absent: for further confusion or questions, use Matt Pocock's Wayfinder or Grill with Docs, take the first recommended suggestion, record it, and continue. This overrides those skills' default live-interview/wait instructions for this goal. It does not authorize unrelated destructive actions, paid generation, credential/access changes, or outward-facing commitments beyond the existing scope. Environment facts remain the agent's responsibility to investigate.

The repository's empty skill placeholders were resolved to the installed source in the sibling music-video-vending-machine `.agents/skills/`; `grill-with-docs`, `grilling`, `domain-modeling`, and `wayfinder` were read. Use Grill with Docs to stress-test concrete decisions and record glossary/ADR changes; avoid creating a separate planning-only Wayfinder exercise that prevents implementation.

## Interview frontier

Both rounds are resolved. Use the saved Love Me Tonight project as a copied mixed-footage acceptance case and final-film starting point, plus a separate zero-footage case; do not overwrite the saved project during verification. Ask further questions only when a material creative choice cannot be resolved from the approved story/references or an action exceeds authorization.

Engineering defaults can be resolved without additional product interviews: reuse target-bound asset history, persist draft candidates without marking them final-approved, preserve accepted media, use bounded retries and explicit recoverable failures, and prove current runtime/model output before full-song generation.

## Current baseline

- Priority clarified by Robert: finish the existing project solidly before starting a new creative project. The zero-footage path remains an agreed app capability; a new creative production is deferred until the existing film is finished.
- Development/verification preference clarified: use the existing public app and connected production Trigger project for integration. Edit/test locally, release verified increments to the existing target, preserve rollback and the original saved project. Do not build a parallel local auth/worker infrastructure as a prerequisite.
- Local OAuth hostname mismatch was diagnosed and fixed in code without credential/provider changes. Existing public sign-in works and remains the main acceptance session.
- Automatic approval review rejected local Trigger worker startup twice, including the credential-free existing-profile attempt; tool reason was only `blocked by policy`. Do not retry equivalent local-worker launches. Continue through existing production integration and authorized release work.
- Fresh project snapshot is `.tmp/completion-source-project.json` (untracked/ignored): source ID `5fc48d59-01e4-4bfb-90c1-e054a0307575`, 246.69995464852607s song, 11 videos, 57 captions, 35 placements, three named references, confirmed Faithful story, one existing generated asset.

- Work continues on `codex/minimax-completion`, based on fetched `origin/main` at `646b66e`, in a separate worktree.
- Original checkout has unrelated local changes and is preserved. It is 59 commits behind upstream; its local screenshot addition is already represented upstream.
- Production browser restored `Assembly recovery · 2026-09-08`: Love Me Tonight, 246.7 seconds, 11 clips, 57 captions, confirmed story, and 21 unfilled timeline windows.
- Initial navigation to Generate showed the external Seedance handoff and manual import flow; this was replaced by the integrated MiniMax draft flow in the released completion branch.
- SwarmUI is running through its existing persistent task on port 7861. The production VM worker reached its managed backend through SwarmUI and verified CUDA on the RTX 5090; no raw backend provider was introduced.

## Release and live evidence, 2026-11-06

- Saved a recoverable public-app finishing copy: `75101b25-fea6-42b1-b2c6-85a9d1deb8eb`, **Love Me Tonight · Finishing revision · 2026-11-06**. Original story/project and all 11 sources remain preserved.
- Release `a810e1c` passed the full check (786 pass, 21 fixture-dependent skips, zero failures) and production build. The Next auth-helper tests run in an isolated process because their console patch otherwise breaks unrelated Bun audio tests.
- Deployed the app-only Trigger bundle `20261106.1`, deployment `g2zgqouw`, 17 existing task IDs, image digest `sha256:f777033074523219258757e1e1ca7a9d1f382045f0727409a26c4f80d6115d93`. The canonical VM100 checkout was preserved; an isolated SHA-pinned build worktree was used.
- Released the same web commit to the existing public app. Initial deployment `dpl_WbzvXaMpCkUeEaKH9ykux6QRX7yC`; configuration refresh `dpl_B9ykeN1bMWxWARiarnoYU1ZRMQh6`. Browser restored the finishing copy with Setup → Story → Draft → Finish and the real signed-in session.
- The main checkout at `C:/Users/Gordo/Documents/Github/project-stack-structure` remains the source for `.env` and `.env.local`; local commands explicitly load that configuration. `.env.example` is the blank inventory. BWS provides canonical values when needed. Only the three existing RustFS S3 variables were synchronized from exact BWS pointers into local/Vercel/Trigger configuration; no auth settings changed. RustFS endpoint is `s3.v1su4.dev`.
- Vercel CLI unexpectedly created an automation bypass during a staged HTTP check. It was immediately revoked without regeneration; API verification showed zero bypass entries, with deployment protection retained. Do not repeat `vercel curl` if it would create another persistent bypass.
- Public H3 job-list reads now return 200. First exact Diego pickup request (14.77–17.27; native 124 frames at 24 FPS) passed strict prompt lint, then failed before dispatch because a new reference HEAD check rejected the media gateway's normal 302 redirect. No inference or generated-video acceptance has occurred yet. Follow-up uses a conditional, server-owned direct RustFS reference read rather than following arbitrary redirects.
- The caption server's existing `--cache-ram 0`, full GPU offload, and idle-unload mechanisms were located in proxmox-home and explained to Robert. These are separate from the 5090 video worker. No caption/shared-platform service settings were changed.

See [the workflow spec](workflows/finish-music-video.md) for the completion contract and checklist.
