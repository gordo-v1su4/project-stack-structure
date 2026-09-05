# UI Refresh — one status system, one primary action, fewer clicks

Status: in progress on branch `ui-refresh` (2026-09-05).

## Problem

The studio proves the pipeline but presents it four times. On an empty project the
screen shows stage status in the sidebar dots, a horizontal stage strip, six Ingest
readiness cards, and a bottom dock "Next Step" — plus the draft-save message in two
places and two unrelated "Activity" surfaces. The orange primary button
(`ProcessActionBar`) is labeled "Confirm Match Set" / "Plan Generated Shots" / "Build
Join Timeline" but every one of those runs the same preview pass; it is hidden on
Ingest and Story where users look for it first. Micro-type at 7–9px with wide
uppercase tracking makes the dense operator console hard to scan.

Users also click things the system already knows the answer to: committing Split is
a separate stamp after choosing a mode; covered Story anchors still need a manual
pick; Match cue sliders and Effects/Export tuning sit in the way of the happy path.

## User outcome

Open the studio, see exactly where you are, what is done, what is next, and one
button that moves you forward. Every stage screen has the same shape. Nothing the
pipeline can decide by itself asks the user to decide it — but nothing enters the
timeline without the user seeing it.

## Scope

Shell and stage-panel UX only. Domain model, pipeline gating rules, persistence
formats, API routes, and Trigger tasks are unchanged.

### Shell

- **Stage rail** (left): the single stage-status surface. Each stage shows number,
  label, one-line status from `buildPipelineState`, and one state glyph
  (done / current / next / locked). Stage strip in `<main>`, sidebar legend, and
  sidebar "Session" stats are removed.
- **Header**: project name, save state (`Saved 09:12` / `Saving…` / `Unsaved`),
  Trigger work activity, project library, song label. No duplicated stage title.
- **Stage header** (top of every stage): step, title, one-sentence purpose, the
  blocked reason when locked, and the **primary action** derived by a pure
  `buildStageAction()`:
  - locked → "Open <prerequisite>"
  - stage has preview + segments → "Preview" (secondary) and "Continue →" (primary
    when ready)
  - ready → "Continue to <next>"
  - not ready → disabled with the pipeline's next-step reason
  Labels are honest: the button says what it does.
- **Preview dock** (bottom): the player only, collapsible / focusable. Live Readout,
  Ranking Preview, Tip, and Next Step columns are removed.
- **Status bar**: preview state · last activity message · save state.
- **Master song lane** stays persistent (product requirement) but collapses to a
  single row with the waveform once analysis exists.

### Automation (gates preserved)

| Change | Gate respected |
| --- | --- |
| Split auto-commits when the chosen mode has segments and Story is confirmed | Split still requires confirmed Story; user can change mode any time |
| Autosave flushes on stage change and on Continue | none — persistence only |
| Story: on treatment select, anchors with `coverage === "covered"` pre-select their top candidate | user still confirms the plan; caption-grounded scores only |
| Match cue sliders move under "Advanced" | defaults unchanged |
| Fast caption mode hidden unless `NEXT_PUBLIC_ENABLE_FAST_CAPTIONS=1` | Smart stays the default |
| Generate "Continue to Join" disabled with reason while true gaps remain | Join gating unchanged |

Not automated: generating treatments (creative input), approving generated
footage, Seedance submission, export.

### Visual system

Tailwind v4 `@theme` tokens replace scattered hex: `ink-0…ink-4` surfaces,
`line`/`line-2` borders, `accent`, `ok`, `warn`, `danger`, `fg-0…fg-4` text. Base
type moves from 7–9px micro-labels to 11–13px with restrained uppercase kickers.
Geist Sans/Mono from `layout.tsx` are used (the Inter override is removed). Shared
primitives live in `src/components/studio/ui.tsx` (`Button`, `Surface`, `StatusDot`,
`Kicker`). No new dependencies.

## Non-goals

- Renaming persisted `Tab` keys (`shuffle`, `ramp`, `compose`).
- Rewriting `GenerateTab` (1.9k lines) beyond the Join gate and header.
- Changing pipeline readiness rules, thresholds, or `studioPipeline` status strings.
- Deleting orphaned legacy panels (`ShuffleTab`, `BeatSplitTab`, …).

## Acceptance

- Empty project: exactly one stage-status surface (rail) and one next-step message
  (stage header). No "Live Readout", "Ranking Preview", "Tip" text in the DOM.
- Every stage renders `StageHeader` with a primary action whose label matches its
  effect; locked stages show the blocked reason and an "Open <stage>" button.
- Choosing a Split mode with segments makes Match available without an extra click.
- Selecting a treatment pre-fills covered anchors; the plan still needs Confirm.
- `bun run check` passes; existing panel markup tests still pass (strings preserved
  or tests updated deliberately).
- Browser walkthrough on `bun run dev`: Ingest → Story → Split → Match screens
  render without console errors.

## Verification

`bun run check`, `bun run build`, and a browser click-through of the shell on an
empty project plus a restored draft. Real-service E2E (`bun run e2e:media`) is not
required: no media or pipeline path changes.
