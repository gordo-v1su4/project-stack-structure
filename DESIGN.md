# Stack Structure Studio Design Contract

This file captures the current UI language before further MVP finishing work. It is descriptive, not a redesign brief.

## Product posture

- The app is a cinematic, dark, browser-first music-video studio.
- The primary user task is not generic NLE editing; it is guided evidence review: song analysis, story intent, split/caption readiness, semantic matching, preview, and export.
- Screens should make machine decisions inspectable before they become edits.

## Visual system

Tokens live in `src/app/globals.css` under `@theme` and are the only source of color. New UI uses the token utilities (`bg-ink-2`, `border-line`, `text-fg-2`, `text-accent`, …), not hex literals.

- Surfaces: `ink-0` … `ink-4`, darkest to lightest. The shell is `ink-1`; panels are `ink-2`; inset wells are `ink-0`/`ink-1`.
- Hairlines: `line`, `line-2`, `line-3`.
- Text ladder: `fg-0` (headings) → `fg-4` (placeholders). Body copy is `fg-2`; hints are `fg-3`.
- Accent: burnt orange `accent` (`#e05c00`) for the current stage, the primary action, selected controls, and semantic attention. `accent-hi` / `accent-lo` / `accent-tint` for hover, borders, and fills.
- Status tones are one closed set, `StatusTone` in `src/components/studio/ui.tsx`: `ready` (ok), `processing` (warn/amber, pulses), `failed` (danger), `waiting` (fg-3), `review` (purple). Every indicator in the app uses `StatusDot`/`TONE_*` from that file so a state means the same thing everywhere.
- Shape: `rounded-md` panels and controls; `rounded-sm` for inline tags. Tiny status lights are round.
- Type: Geist Sans for UI, Geist Mono for numbers, ids, timings, and file names. Sentence case for headings and buttons. `Kicker` is the only uppercase-tracked style and is reserved for section labels.
- Density: compact but breathable. Panels use 16px padding; evidence rows use 12px.

## Shell

- Left: `StudioSidebar` stage rail. Number glyph + label + one status line per stage; the current stage pulses. It is the only place stage progress is enumerated.
- Top: `StudioHeader` with project name, `SaveState` badge, song label, work activity, and the project library. No stage title here.
- Main: `StageHeader` first, then the audio lane (when the stage uses it), then the stage panel. `StageHeader` owns the stage title, one-sentence description, blocked reason, and the actions.
- Bottom: `PreviewDock` hugs the status bar. It is a one-line hint until a preview exists, then a 220px player with Focus/Dock and Hide.
- Footer: `StudioStatusBar` — preview state + one activity line.

## Interaction rules

- One primary action per stage, built by `buildStageHeaderModel` (`stageActions.ts`). Its label says what it does (“Continue to Match”, “Open Ingest”); disabled buttons carry the reason as a title and, for Continue, under the button.
- Preview is the secondary action on stages that can render one. It never advances the stage.
- Blocked stages render the header with the reason and “Open <prerequisite>” and nothing else.
- Guided workflow stages may be soft-gated, but actions that would produce invalid edits must be hard-gated.
- Automation over ceremony: Split commits itself while its stage is open; autosave flushes on every stage change and stage-level checkpoints; Ingest is a numbered checklist where each step's work sits under its heading.
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

- Build from the primitives in `src/components/studio/ui.tsx` (`Button`, `Surface`, `StatusDot`, `Kicker`, `Meta`, `ProgressBar`) before adding new ones. Legacy panels still carry hex literals; migrate them to tokens when touched, do not add new ones.
- Do not add new UI dependencies for the local MVP.
- Prefer small pure model changes backed by tests, then render those facts in panels.

## Lane stack primitive

- The smart track stack is an evidence board, not a full NLE timeline. It must keep one live selected clip per story slot while showing alternates by footage role.
- Use compact rows for footage roles: performance/lip-sync, Camera A, Camera B, B-roll, generated fill, effects/texture, and unsorted review.
- Mute, solo, collapse, focus, and zoom controls are view-only. They must not mutate project state or imply export changes.
- The selected export-bound candidate uses the existing burnt-orange selected treatment. Muted lanes reduce opacity/grayscale; empty cells stay visible as dashed placeholders so the user understands missing coverage.
- Each block should expose source label, caption/search text, match score, lane confidence, and head/tail timing so transitions can be reasoned about without opening a heavy editor.
