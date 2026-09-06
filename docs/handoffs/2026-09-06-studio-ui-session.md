# Session handoff — Studio UI walkthrough (2026-09-06)

**For:** next Cursor session on the same branch/workspace  
**Plan checklist:** [2026-09-06-studio-story-match-generate-checklist.md](../plans/2026-09-06-studio-story-match-generate-checklist.md)  
**Prior chat:** agent transcript `90fed4d8-f8dd-4e9f-9098-f5d4b8b4d544`

---

## Resume in 30 seconds

```bash
# Terminal 1 — dev server (Trigger env if needed)
bun run dev -- -p 3000

# Browser — auth + draft restore (hard reload after)
http://localhost:3000/api/dev/e2e-session
# then F5 on http://localhost:3000/
```

**Local draft:** `.tmp/studio-drafts/default.json`  
**Fixture:** Love Me Tonight — 5 videos, 34 scenes/captions, 6 refs, vocal stem + Deepgram transcript

**Re-seed story without Qwen** (if treatments cleared):

```bash
bun run scripts/seed-studio-story-draft.ts
```

---

## Pipeline state (last verified)

| Stage | Status |
|--------|--------|
| Ingest | 5 clips · 34/34 captions |
| Story | Faithful treatment confirmed · 9 edit slots |
| Split | Auto-commits on tab open · scene / rhythm modes |
| Match | 9/9 slots matched |
| Generate | 9 short · optional · **0 blocking gaps** |
| Join | 108 cuts · reviewable |

E2E run key (server draft): `studio-b5-20260906-044901` — report at `.tmp/e2e-validation/studio-b5-20260906-044901/report.json`

---

## What we did this session

### Phase A/B (earlier — checklist mostly done)

Coverage UX, caption-context gate, match composition-ref disclaimer, tests green on touched units. See checklist for checkboxes.

### UI / shell

- **TrackHeader** + **BeatSpine** persistent on all acts (song timeline)
- **Program monitor** only when preview/export active (not on Split/Match by default)
- **Inspector** inline Trigger **Production runs**
- **Ingest** checklist order, reference/caption UX, generic-name → recaption banner
- **Story** compact treatments; **CollapsibleSection** for advanced timing

### Code fixes + dev tools

| Change | File |
|--------|------|
| `storyAnchorsResolved` uses selected *or* confirmed treatment | `src/components/StudioApp.tsx` |
| Dev story seed (3 treatments + confirm faithful) | `scripts/seed-studio-story-draft.ts` |
| Cut map hover preview + clip playback in inspector | `src/components/studio/panels/SplitTab.tsx` |
| Equal-width footage tiles (readable S1–S5) | `src/components/studio/SourceVideoTimeline.tsx` |
| Beat spine labels “Edit plan · song time” | `src/components/studio/shell/BeatSpine.tsx` |
| Match readiness cards collapsed by default | `src/components/studio/panels/MatchTab.tsx` |

**Not committed** — all of the above is local working tree.

---

## UX mental model (user + agent must share)

Two timelines are stacked; they are **not** the same thing:

1. **Beat spine (top)** — **song time** (~4:06). Sections, matched edit slots, waveform. **Space = play song.**
2. **Split footage strip + cut map** — **source time** (concatenated uploads). Numbered blocks = **inventory** for Match, not final edit.

**Split** = build searchable footage windows (scene / rhythm / scene+rhythm).  
**Match** = map inventory onto song chunks (sliders, cue timeline, lane board).  
**Generate** = fill true gaps; purple short = optional review.

User direction: **cut map concept belongs on Match** (song-aligned, blanks allowed, shuffle/swap). Split stays inventory-only.

---

## Open UX / product queue (tomorrow)

Priority order from user feedback:

1. **Match-owned song-aligned cut map** — show music chunks + which footage windows could land; blanks where nothing fits; tie to density/blend sliders.
2. **Match interactivity** — shuffle / swap candidates on lane board (bounce clips between sections).
3. **Focus monitor** — dock collapsed by default; accordion, not full-column takeover.
4. **Right inspector** — move Story’s big section/lyrics/SRT table out of main column; keep lyrics timing compact in main.
5. **Recaption** — Diego/Valentina on refs → **Recaption all**; generic “a man/woman” in captions today.
6. **Manual Seedance** — one purple slot walkthrough (checklist Phase B unchecked item).
7. **Phase C e2e** — after Match UX feels right.

### Known confusion points (don’t re-litigate)

- Black gap middle = usually beat spine waveform or Focus-expanded monitor; individual split cuts didn’t play until hover/inspector video added.
- “7 clips” vs 5 files = often counting beat-spine **sections/slots**, not upload count. Footage strip now shows **N clips** in header.
- `storyAnchorsResolved` bug was fixed; if Story gate looks wrong, verify selected treatment anchors resolved.

---

## Auth / browser quirks

- Embedded browser needs **`/api/dev/e2e-session` then hard reload** — cookie alone doesn’t re-run draft restore.
- GitHub OAuth fails in Cursor browser; use e2e-session.
- `bun run check` on Windows may fail on `scripts/run-bun-tests.sh` PATH; use `bun test <file>` + `bun run lint` + `tsc`.

---

## Key files

| Area | Path |
|------|------|
| Shell layout | `src/components/StudioApp.tsx` |
| Split | `src/components/studio/panels/SplitTab.tsx` |
| Match | `src/components/studio/panels/MatchTab.tsx` |
| Beat spine | `src/components/studio/shell/BeatSpine.tsx` |
| Split logic | `src/components/studio/sourceTimeline.ts` |
| Pipeline gates | `src/components/studio/studioPipeline.ts` |
| Character naming protocol | `docs/protocols/higgsfield-nano-banana-reference-continuity.md` |
| Design principles | `DESIGN.md` |

---

## Suggested skills for next session

- **codebase-design** — Match cut-map + inspector layout (design-it-twice before big UI moves)
- **diagnosing-bugs** — if draft restore / auth / preview playback regresses
- **wizard** — only if scoping a multi-day Match redesign spec

---

## Explicitly deferred

- Convex / DB migration
- Section-level preview (verse as one clip) — backlog
- Local Qwen 2511 in Generate UI — homelab session per checklist “Tomorrow” section
- Paid in-app generation submit
