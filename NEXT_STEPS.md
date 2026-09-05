# Next Steps

Actionable priorities for `project-stack-structure`. Canonical detail lives in [`docs/architecture/`](docs/architecture/) and [`docs/roadmap.md`](docs/roadmap.md).

---

## References by task

Use the references relevant to the requested work; this is a roadmap, not a prerequisite reading sequence for every edit.

1. [`README.md`](README.md) — product summary and services
2. [`docs/architecture/product-infrastructure.md`](docs/architecture/product-infrastructure.md) — how the stack fits together
3. [`docs/architecture/clip-audio-sync.md`](docs/architecture/clip-audio-sync.md) — clip-to-master alignment and lanes (planned)
4. [`docs/local-generation.md`](docs/local-generation.md) — SwarmUI / gap-fill generation wiring

Local comparative research (if you have it) lives outside git in `documents/comparative-research/` — attach in chat when needed; agents should not expect it in the repo.

---

## Now (stabilize the core edit loop)

1. **Harden Match + section preview** — musically correct rough cut from uploaded clips remains the primary milestone.
2. **Story + ingest visibility** — vocal stem, lyrics, scene captions, and readiness states green/orange/red across tabs.
3. **Lock contracts** — `MusicVideoProject`, timeline items, coverage slots, and project persistence (including new generation draft work from latest `main`).
4. **Benchmark web-first latency** — section preview swap timing; only pivot to desktop if evidence requires it.

---

## Next (upload-first enhancements)

5. **Clip audio sync (P0 spike → P1 ingest)** — align muxed clip audio to master waveform / vocal stem; store `masterStartSec` + confidence on upload. See [`clip-audio-sync.md`](docs/architecture/clip-audio-sync.md).
6. **Song-locked timeline + lanes** — performance / beauty / B-roll lanes; clips placed after sync; dimmed until user approves; vocal windows guide performance lane.
7. **Generate gap-fill** — wire coverage slots to SwarmUI (or API) for missing / weak / short slots only; no silent auto-insert into Join.
8. **Match respects placement** — when sync exists, rank and assign within lane + time window instead of guessing globally.

---

## Later (after core is proven)

9. **Multi-stage prompt pipeline** — Director Script format, validators, clipboard LLM handoff for gap slots (patterns only; no external repo code).
10. **Narrative filler suggestions** — “what fits here” between anchored clips, not whole-MV generation.
11. **Export polish** — GEN vs IMP badges, optional post-FX pass, pre-export coverage validator.
12. **Optional audio sync QA pass** — re-verify alignment before final export, not as first placement.

---

## Explicit non-goals (for now)

- Full Resolve-style NLE
- ComfyUI-as-the-product (SwarmUI/API as optional gap-fill backend only)
- Whole music video generation by default
- Committing third-party comparative research into this repo

---

## Suggested agent prompt

> Implement [specific outcome] within [scope]. Success means [observable acceptance criteria]. Use the relevant code and docs to resolve implementation details. Preserve musical alignment first, motion continuity second, and prepared preview states. Run the affected checks, inspect the result where applicable, and fix failures caused by the change. Continue through verification; ask only for a material missing decision or action outside the authorized scope. Stop when the acceptance criteria are met or explain a concrete blocker.

---

## Quick status check

| Area | Status |
| --- | --- |
| Essentia + waveform | Shipped |
| Scene detect + VL captions (server GPU) | Shipped |
| Semantic Match on uploaded footage | Shipped (hardening) |
| Generate tab UI (coverage + prompts) | Shipped (backend wiring in progress) |
| SwarmUI local generation | Documented; integrate with Generate |
| Clip audio sync | Planned — [`clip-audio-sync.md`](docs/architecture/clip-audio-sync.md) |
| Creative lanes (performance / beauty) | Planned |
| Comparative research folder | Local only — not in git |
