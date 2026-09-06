# Studio cleanup — Story → Match → Generate checklist

**Grilled:** 2026-09-06  
**Canon:** `CONTEXT.md` · [ADR-0001](../adr/0001-generate-join-coverage-gating.md) · [ADR-0002](../adr/0002-composition-reference-not-quality.md) · issue [#61](https://github.com/gordo-v1su4/project-stack-structure/issues/61)

Use this as the overall plan. Check items off as you go. **E2E is last** — only after B feels right on fixtures.

**Latest session handoff:** [2026-09-06-studio-ui-session.md](../handoffs/2026-09-06-studio-ui-session.md) (resume commands, draft state, tomorrow UX queue).

---

## Phase A — Docs & scrub

- [x] Sync `CONTEXT.md` (gating, orphans, story fidelity, composition-ref rules)
- [x] Add ADR-0001 (Generate → Join coverage gating)
- [x] Add ADR-0002 (composition reference ≠ quality authority)
- [x] Scrub stale tests/docs referencing deleted panels (`ShuffleTab`, `beatjoin`, `readout.ts`) — confirmed absent on disk; only intentional legacy tab migration in `projectPersistence`
- [x] Confirm `projectPersistence.normalizeLegacyTab` + `localStorage` tab sanitization (test: legacy `beatsplit`/`beatjoin` → `split`/`join`)

---

## Phase B — Gating, UX, manual Seedance (now)

### Coverage signals (#61)

- [x] Red / purple / yellow mean the same thing in sidebar, Generate metrics, and Join gate (`studioPipeline` + `buildStudioPipelineInput` use `blockingGapCount` only; short/weak optional)
- [x] Generate copy says **optional** for purple (short source) and yellow (weak match)
- [x] No false reds — short-source slots never increment blocking gap count (`editPlanCoverage`, `generateCoverage.test.ts`)

### Whole-shot replacement UX

- [x] `wholeShotReplacement` steps visible and ordered in Generate (select cut → storyboard → Video_1 → packet → import → approve)
- [x] Blockers surface at the step that failed (`blockersForWorkflowStep` on active checklist step)

### Manual Seedance MVP (no in-app paid submit required)

- [x] Packet is copy-ready: text + ordered image refs + `Video_1` timing note
- [x] Operator flow documented in UI: copy → run Seedance externally → import clip → approve for Join
- [ ] One purple slot walked through on Love Me Tonight fixtures *(manual QA — needs loaded project + external Seedance run)*

### Composition reference (ADR-0002)

- [x] Rename cut frame UI/copy: **composition reference (from cut)** — not “source frame / shot anchor”
- [x] Instructions forbid likeness/texture/upscale from the grab; sheets are quality authorities
- [x] Prompts reflect: who-where blocking + localized room position; env sheet = broad venue (`referenceAssets.ts`, `referenceAssets.test.ts`)

### Caption-context gate

- [x] Smart captions do not run until stem + Char 1 + Environment (`isCaptionContextReady` / `mediaUpload` defer + `StudioApp` resume effect)
- [x] Ingest lane UI matches pipeline `ingestReady` (captions lane waits with “Needs stem + Char 1 + environment”)

### Match

- [x] Ranking uses captions/semantics/timing only — not thumbnail sharpness (existing match logic; no sharpness scorer added)
- [x] Evidence UI does not imply “use this pixel data as final quality” (`MatchCards` composition-context disclaimer)

### Tests

- [x] `bun test` on `referenceAssets`, `studioPipeline`, `generateCoverage`, `mediaUploadCaptionGate`, `projectPersistence`
- [x] `blockingGapDuration` assertion in `generateCoverage.test.ts`
- [x] Legacy tab migration test in `projectPersistence.test.ts`
- [x] `bun run lint` + `tsc --noEmit` pass (full `bun run check` test step still needs `bun` on PATH for `scripts/run-bun-tests.sh` on Windows)

---

## Tomorrow — Local homelab (separate session)

Test in this order; same role split as ADR-0002.

1. [ ] **Qwen Image Edit 2511 still** — sheets + composition ref from cut; no grab-as-quality (`docs/local-generation.md`, racknerd5 runbooks)
2. [ ] **Still-first Seedance packet** — fresh 2K still → R2V on one fixture slot
3. [ ] **R2V direct** — only if (2) proves refs survive without intermediate still

- [ ] Do not expose local lane in Generate UI until (1) passes
- [ ] Environment sheets: note if broad sheets need redo for zone ambiguity

---

## Phase C — Hybrid e2e (after B)

**Gate:** manual fixture walkthrough green first.

- [ ] `bun run build` + `bun run start` with full env
- [ ] Fixtures: 21 videos + 6 reference sheets + stems (`docs/plans/2026-08-30-reference-driven-e2e-handoff.md`)
- [ ] `bun run e2e:media` through ingest → captions → story → match → **Generate classification**
- [ ] Stop before paid generation unless explicitly enabled
- [ ] Section-level preview (verse/chorus as one clip) — **deferred**, not a C blocker

---

## Trust checklist (all must pass before “loop works”)

- [ ] Story treatment cites **real caption content** on fixtures
- [ ] Match assignments musically + visually plausible
- [x] Generate red / purple / yellow correct; no false blocking reds (unit-tested; fixture walkthrough pending)
- [ ] One **manual Seedance** whole-shot replacement on a purple slot (import + approve)
- [ ] Qwen 2511 local still honors sheets + composition ref (tomorrow)
- [ ] Hybrid e2e through Generate (Phase C)

---

## Explicitly out of scope (this effort)

- Convex / project DB migration
- New paid provider integrations in app UI
- Section preview across acts (backlog in `CONTEXT.md`)
- Routing caption work to a second GPU
