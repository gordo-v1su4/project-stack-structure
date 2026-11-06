# ADR-0003: Four-step, master-first completion with MiniMax H3

**Status:** accepted (2026-11-06); live render and film acceptance remain outstanding
**Authority:** Robert's agreed [finish-music-video workflow](../../workflows/finish-music-video.md)

## Decision

- Present **Setup → Story → Draft → Finish** as the primary journey. Keep Split, Match, Join, and Effects as detailed tools with their existing persisted keys.
- Require an analyzed master song, creative brief, and named identity/environment references. Footage, separate vocal stems, and timed lyrics are optional. With no lyrics, plan against actual music-section timing; with no footage, record generation requirements rather than phantom captions or matches.
- Preserve suitable approved existing material. Use local **MiniMax H3 through SwarmUI and its managed backend** as the primary missing-video path. Manual Seedance handoff and still-first/Qwen image experiments remain optional alternatives.
- Bind durable jobs and candidate assets to the authenticated owner/project, current approved story/plan, target interval, actual reference versions, and generation configuration. Reattach after refresh; reconcile ambiguous submissions rather than blindly rerendering.
- Automatically select eligible ready candidates into a labeled draft without changing `pending` review status. Approve the exact reviewed candidate/trim snapshot together. Changes invalidate affected approval, and late completions cannot replace a newer selection.
- Permit incomplete whole-song review with visible holes; final export requires complete current approved coverage and durable playable output. Narrative/performance footage uses the master soundtrack; accurate generated lip-sync is deferred.

## Existing-film priority

Finish the existing Love Me Tonight film before starting a new creative project. Preserve its approved ten-beat Diego/Valentina story, master analysis, captions, references, and useful source placements. The acceptance film must be dynamic, high energy, narrative driven, and musically fast cut. Fast pacing permits purposeful 1–3s cuts; Balanced retains its 4s minimum. Neither mode permits fake coverage by replaying completed actions or the same source frames.

Use the existing public app and production Trigger project. A parallel local auth/worker setup, regenerated story, Nano Banana board, or Qwen still validation is not a prerequisite for completing this film.

## Relationship to prior decisions

This supersedes ADR-0001's mandatory Split visit and September provider-specific replacement guidance. Its distinction between incomplete review and complete export remains in force. ADR-0002's identity/environment quality authority and composition-only role for source frames remain in force; its still-first provider default is superseded.

Historical plans remain historical evidence rather than current product gates. No database migration, full NLE rewrite, new Trigger task ID, or platform upgrade is required by this decision.

## Verification

Static checks establish implementation evidence only. Acceptance separately requires a fresh public-app reference-conditioned H3 render, visual identity/action/continuity review, durable media reads, recovery and reload, exact draft approval, and a watched full-song exported MP4. Correlate project, plan, job, worker version, provider submission, candidate, snapshot, and final object. A zero-footage/master-only case must also exercise the same planning/generation/review path without lyric or caption prerequisites.
