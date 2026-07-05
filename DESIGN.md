# Stack Structure Studio Design Contract

This file captures the current UI language before further MVP finishing work. It is descriptive, not a redesign brief.

## Product posture

- The app is a cinematic, dark, browser-first music-video studio.
- The primary user task is not generic NLE editing; it is guided evidence review: song analysis, story intent, split/caption readiness, semantic matching, preview, and export.
- Screens should make machine decisions inspectable before they become edits.

## Visual system

- Canvas: near-black surfaces (`#050505` to `#0b0b0b`) with subtle hairline borders (`#141414` to `#252525`).
- Accent: burnt orange `#e05c00` for active stage labels, selected controls, cue focus, and semantic attention.
- Status colors:
  - Ready/healthy: dark green borders/backgrounds with text near `#79c779`.
  - Warning/error/blocked: dark red borders/backgrounds with text near `#d24b3f`.
  - Secondary data: gray text from `#555` through `#9a9a9a`.
- Shape: square editorial controls with `rounded-[2px]`; avoid large pill/chip language except for tiny status lights.
- Type: uppercase micro-labels with wide tracking for control labels; mono numerics for scores, timing, and diagnostics.
- Density: compact panels are intentional. Prefer adding visible evidence over adding whitespace.

## Interaction rules

- Guided workflow stages may be soft-gated, but actions that would produce invalid edits must be hard-gated.
- Every automated decision should show the input evidence: lyric/story prompt, caption/semantic meaning, timing, score, and media frame where possible.
- “Preview/export ready” must mean the assets are actually present and usable, not only that a config value exists.
- Keep browser-first latency visible: prefer incremental readiness and contact sheets over hidden background magic.

## Match UX rules

- Match is the highest-risk MVP seam. It must answer:
  1. What song/story slot is being filled?
  2. Which clip was selected?
  3. Why did it win?
  4. What visually similar or semantically relevant backups were considered?
  5. Where are weak matches or holes?
- Use first/middle/last frames for temporal evidence and small contact sheets for alternatives.
- Preserve semantic scores and reasons with the project data so the UI can explain a draft after restore.

## Implementation constraints

- Reuse existing component style and Tailwind utility patterns before introducing new abstractions.
- Do not add new UI dependencies for the local MVP.
- Prefer small pure model changes backed by tests, then render those facts in panels.

## Lane stack primitive

- The smart track stack is an evidence board, not a full NLE timeline. It must keep one live selected clip per story slot while showing alternates by footage role.
- Use compact rows for footage roles: performance/lip-sync, Camera A, Camera B, B-roll, generated fill, effects/texture, and unsorted review.
- Mute, solo, collapse, focus, and zoom controls are view-only. They must not mutate project state or imply export changes.
- The selected export-bound candidate uses the existing burnt-orange selected treatment. Muted lanes reduce opacity/grayscale; empty cells stay visible as dashed placeholders so the user understands missing coverage.
- Each block should expose source label, caption/search text, match score, lane confidence, and head/tail timing so transitions can be reasoned about without opening a heavy editor.
