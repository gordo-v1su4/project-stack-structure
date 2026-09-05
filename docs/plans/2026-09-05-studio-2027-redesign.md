# Studio 2027 — a screening room, not a dashboard

Status: in progress on branch `studio-2027` (2026-09-05). Builds on the
`ui-refresh` shell (PR #64). Research brief: agent transcript
[Research 2026-27 pro creative-tool UI trends](f18b8903-1b49-42c5-bc58-35353de0c51f).

## Problem

After the refresh the studio is coherent but reads as a form-driven admin tool:
a left list, a header, stacked cards, a player parked at the bottom. Nothing on
screen says "this is where a music video is cut". The footage is never the hero,
the music is a widget rather than the spine, stages feel like tabs, and every
decision is a card with a button. Peers that people call best-in-class in 2026
(Frame.io V4, Runway, Descript, Suno Studio 2.0, Premiere's generative panel,
Linear) share a different shape: a central working surface, a persistent
timeline, a context-sensitive rail, keyboard-first control, spring motion, dark
LCH palettes tuned so media looks luminous, and AI that is scoped, labeled, and
revertible.

## Design thesis

1. **The cut is the hero.** A program monitor sits top-center on every act. When
   nothing is prepared it is still the hero — a cinematic empty state carrying the
   song title, BPM, duration, and the one thing to do next in editorial type.
2. **The music is the spine.** One beat-grid timeline (waveform, sections, beats,
   playhead) runs under the monitor on every act after Ingest. Cut slots ride on
   it; generated slots are labeled in-track; alternates hang under a slot as take
   lanes. It replaces the audio lane, the split preview strips, and the join
   filmstrip as separate widgets.
3. **Acts, not tabs.** The eight stages become acts on a 56px icon rail with a
   progress ring. Changing act changes what the inspector shows and which tools
   overlay the timeline; the monitor and spine persist. View transitions morph
   between acts instead of swapping pages.
4. **One inspector.** A 360px right rail is the only place controls live. It shows
   the act's purpose, the primary action, the blocked reason, and the evidence for
   whatever is selected (a slot's candidates, caption, score, timing). Existing
   panels mount here module by module; until a panel is re-cut, it mounts in the
   work surface under the spine unchanged.
5. **Keyboard is a first-class surface.** `⌘K` command palette for every action the
   header/inspector exposes; `Space`/`J`/`K`/`L` transport; `1–8` jump acts; `?`
   opens the shortcut sheet. Shortcuts print inline on buttons.
6. **Motion is state.** Spring curves as `linear()` tokens, interruptible;
   `@starting-style` for popovers and toasts; `prefers-reduced-motion` honored.
   No fade-only swaps, no cubic-bezier guesses.
7. **AI is scoped, labeled, revertible, priced up front.** Generated shots are
   tagged on the spine, previewed before spend with cost shown, approved before
   they enter the cut, and revertible from the slot. Nothing changes here in the
   domain model — the UI makes the existing gates visible.

## Visual system

- **Palette**: near-achromatic OKLCH ramp (`ink-0…ink-4` re-tuned in oklch with a
  faint warm cast so footage reads cooler and brighter), hairlines at
  `oklch(… / 0.08–0.16)`, one accent (`oklch(0.72 0.19 45)` — the existing orange,
  relit), semantic ok/warn/danger/review kept. Glass only on floating HUD over
  video (transport, slot labels): 1px gradient top edge, 2% noise, blur by
  hierarchy. Never as a page background.
- **Type**: Geist for UI, Geist Mono for data, **Instrument Serif** (italic accents)
  as the editorial display face for act titles, the monitor empty state, and
  section names on the spine. Sizes 11/12/13 UI, 18–44 display, `text-wrap:
  balance` on display copy.
- **Shape**: 6px radii on controls, 10px on the monitor and inspector cards; no
  full-bleed cards; hairline separators instead of boxes wherever a list reads
  without them.
- **Motion tokens**: `--ease-spring` (`linear(...)` overshoot 1.03),
  `--ease-out-soft`, durations 120/200/320ms. View transition names on monitor,
  spine, inspector, act title.
- **Iconography**: 16px stroke glyphs drawn inline (no icon dependency).

## Layout

```
┌──────┬───────────────────────────────────────────────┬──────────────┐
│ acts │  program monitor (16:9, ≤ 42vh, cinematic)     │  inspector   │
│ rail │───────────────────────────────────────────────│  act title   │
│      │  beat-grid spine: waveform · sections · beats  │  purpose     │
│ 56px │  · playhead · slots · take lanes · AI labels   │  primary ▶   │
│      │───────────────────────────────────────────────│  evidence /  │
│      │  work surface (act module; scrolls)            │  controls    │
├──────┴───────────────────────────────────────────────┴──────────────┤
│ transport ⏮ ⏯ ⏭ · 00:00.00 / 03:12 · 132 BPM   status · save · ⌘K    │
└─────────────────────────────────────────────────────────────────────┘
```

Ingest is the exception: no spine yet, the monitor is the drop zone
("Drop the song. Then the footage.") and the inspector is the checklist.

## Phases

**A — Foundation + shell (this branch, first PR). Landed.** OKLCH tokens, fonts,
motion tokens, `ActRail`, `ProgramMonitor` (wraps the existing player with the
empty state), `BeatSpine` (wraps `SolidWaveform`; the transport drives its
playhead), `Inspector` (project row + act title/status/actions; act modules mount
as children), `TransportBar` (Space drives the prepared cut when one is loaded,
otherwise the master song via `useSongTransport`), `CommandPalette` +
`ShortcutSheet` on native `<dialog>`, keyboard map, view transitions between
acts. Existing panels mount in the work surface untouched. The old
`StudioSidebar`, `StudioHeader`, `StageHeader`, `StudioAudioLane`,
`PreviewDock`, and `StudioStatusBar` are removed. Files live under
`src/components/studio/shell/`.

**A′ — Shell correction (after first review).** The first Phase A screenshot read
as three empty boxes. Fixed: the empty monitor is a contact sheet of scene
thumbnails (`MonitorEmptyState.frames`) and shrinks to ~26vh when nothing
plays; a blocked act renders a `GateCard` (reason in display type, the one
door that opens it, and the full pipeline with status) instead of a centered
sentence; the rail is 72px with act names, not `#01`; the inspector header is
the project name as a switcher plus save state and a quiet activity icon —
GitHub identity and run counts moved into the panels; the text ladder moved up
(fg-3 ≥ 4.5:1) and hairlines are 9%/14%/22%. `ProjectLibrary` and
`WorkActivity` panels were re-cut onto the token system without logic changes.

**B — Slots on the spine. Landed (first cut).** The spine renders the resolved
cut — `buildEditPlanPreviewSegments` with approved generated shots applied — as
thumbnail slots in song time (`shell/spineSlots.ts`: `buildSpineSlots`,
`describeSlot`, `neighborSlot`). Generated slots carry an `AI` tag. Selecting a
slot seeks the song transport and mounts `SlotInspector` in the inspector:
lyric under the cut, caption, score breakdown and reasons, other takes ("Use"
calls the same `selectStorySectionCandidate` Match uses), Play-from-here,
Generate, and Revert for a generated shot (sets `reviewStatus` back to
`pending`). Alternate takes also hang under the selected slot as a take lane on
the spine. `[` / `]` step cuts, `Esc` deselects. Not yet: Join on/off toggles on
slots (Join still works on the footage-time split, a different model), drag
trimming, and the WebGPU grid.

**C — Act modules.** Re-cut each panel into inspector modules: Story (treatment
picker → plan), Split (mode + cut density), Match (cue + candidate rail), Generate
(shot spec form, preview-before-spend with cost), Join, Effects (parameter strip
on the spine), Export (settings + render queue). One PR per act.

**D — Hero polish.** WebGPU waveform/beat grid with 2D fallback, scroll-driven
minimap, anchor-positioned slot tooltips, shortcut sheet, onboarding empty state.

## Non-goals

- Domain model, pipeline gates, persistence formats, API routes, Trigger tasks.
- Renaming persisted `Tab` keys.
- New runtime dependencies (fonts via `next/font/google` only).
- Light theme.

## Acceptance (Phase A)

- Every act renders the same shell: rail · monitor · spine (after Ingest) · work
  surface · inspector · transport. No stage title in the header; the act title is
  in the inspector and animates between acts.
- `⌘K` lists the current act's actions plus "Go to <act>" for all eight; `1–8`
  switch acts; `Space` toggles preview playback when a preview exists; `?` opens
  the shortcut sheet.
- The monitor's empty state shows song title / BPM / duration once analyzed and
  the pipeline's next-step line; it never shows a dashed placeholder box.
- All stage gating strings from `studioPipeline` still render; existing unit
  tests pass unchanged or are updated deliberately.
- `bun run check` and `bun run build` pass; screenshots of Ingest, Story, Split,
  Match at 1440×900 attached to the PR.
